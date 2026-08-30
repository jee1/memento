/**
 * 메모리 임베딩 저장 및 검색 서비스
 * 데이터베이스와 임베딩 서비스를 연동
 */

import type Database from 'better-sqlite3';
import type {
  EmbeddingProvider,
  EmbeddingResult,
  VectorCompatibilityAssessment,
  VectorCompatibilityIssue
} from '../../../shared/types/embedding.types.js';
import type { MemoryType } from '../../../shared/types/memory.types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { cosineDistanceToSimilarity } from '../../../shared/utils/vector-similarity.js';
import { getVectorTableName as getValidatedVectorTableName } from '../../../shared/utils/sql-security-validator.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { vectorCompatibilityService } from '../../embedding/services/vector-compatibility-service.js';

export interface MemoryEmbedding {
  memory_id: string;
  embedding: number[];
  embedding_provider?: string;
  dimensions?: number;
  created_by?: string;
  created_at: string;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned: boolean;
  tags?: string[];
  similarity: number;
  project_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
}

/** searchBySimilarity 결과: 쿼리 임베딩에 실제 사용된 provider 진단용 */
/** Row shape from vec similarity JOIN query */
interface SimilaritySearchRow {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed: string | null;
  pinned: number | boolean;
  tags: string | null;
  distance: number;
  project_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
}

/** Row shape from provider stats GROUP BY query */
interface EmbeddingProviderStatRow {
  provider: string;
  count: number;
  dimensions: number | null;
}

export interface SearchBySimilarityOutcome {
  results: VectorSearchResult[];
  query_embedding_providers?: EmbeddingProvider[];
}

type GlobalWithVecWarning = typeof globalThis & { __vecExtensionLoadWarningShown?: boolean };

export class MemoryEmbeddingService {
  private embeddingService: UnifiedEmbeddingService;
  private readonly defaultProvider: EmbeddingProvider = 'tfidf';
  private readonly createdByTag = 'memory_embedding_service';

  constructor() {
    this.embeddingService = new UnifiedEmbeddingService();
  }

  /**
   * 마지막으로 사용된 임베딩 제공자 이름 반환 (진단용)
   * recall/memory_injection에서 TF-IDF fallback 감지에 사용됨
   */
  getCurrentProviderName(): EmbeddingProvider | null {
    return this.embeddingService.getCurrentProviderName();
  }

  /**
   * HybridSearchEngine 쿼리 임베딩과 동일한 UnifiedEmbeddingService 인스턴스.
   * 별도 UnifiedEmbeddingService를 쓰면 VEC 경로에서 getCurrentProviderName()이 실제 쿼리 임베딩과 불일치함.
   */
  getUnifiedEmbeddingService(): UnifiedEmbeddingService {
    return this.embeddingService;
  }

  private writeEmbeddingStderr(level: 'warn' | 'error' | 'info', message: string): void {
    const prefix =
      level === 'warn' ? '[WARN] ' : level === 'error' ? '[ERROR] ' : '[INFO] ';
    process.stderr.write(`${prefix}${message}\n`);
  }

  private getBlockingCompatibilityIssues(
    compatibility: VectorCompatibilityAssessment
  ): VectorCompatibilityIssue[] {
    return compatibility.issues.filter(
      (issue) => issue.severity === 'error' && issue.code !== 'dimension_mismatch'
    );
  }

  private emitCompatibilityDiagnosticsForCreate(
    compatibility: VectorCompatibilityAssessment
  ): void {
    const projection = compatibility.projection;
    if (compatibility.needsProjection) {
      const dimensionIssue = compatibility.issues.find((issue) => issue.code === 'dimension_mismatch');
      if (dimensionIssue) {
        this.writeEmbeddingStderr('warn', dimensionIssue.message);
      }
      this.writeEmbeddingStderr(
        'info',
        `벡터 차원 조정: ${projection.sourceDimensions} → ${projection.targetDimensions} (${projection.projectionType})`
      );
    }
    compatibility.issues
      .filter((issue) => issue.severity === 'warning')
      .forEach((issue) => this.writeEmbeddingStderr('warn', `임베딩 경고: ${issue.message}`));
  }

  private async insertMemoryEmbeddingForCreate(
    db: Database.Database,
    memoryId: string,
    provider: EmbeddingProvider,
    embeddingResult: EmbeddingResult,
    compatibility: VectorCompatibilityAssessment
  ): Promise<void> {
    const projection = compatibility.projection;
    const storedVector = projection.vector;
    const serializedEmbedding = JSON.stringify(storedVector);
    const sourceDimensions = projection.sourceDimensions;
    const storedDimensions = projection.targetDimensions;
    const projectionType = projection.projectionType;
    const normalized = projection.normalized ? 1 : 0;

    await DatabaseUtils.run(
      db,
      `
        INSERT OR REPLACE INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        memoryId,
        provider,
        projectionType,
        serializedEmbedding,
        sourceDimensions,
        embeddingResult.model,
        storedDimensions,
        32,
        normalized,
        1,
        this.createdByTag
      ]
    );
  }

  private buildVecSimilarityQuery(
    provider: EmbeddingProvider,
    tableName: string,
    queryVector: number[],
    filters?: {
      type?: MemoryType[];
      limit?: number;
      threshold?: number;
      project_id?: string;
      owner_id?: string | string[];
      process_id?: string | string[];
      session_id?: string | string[];
    }
  ): { sql: string; params: unknown[] } {
    const typeFilter = filters?.type?.length
      ? 'AND m.type IN (' + filters.type.map(() => '?').join(',') + ')'
      : '';
    const projectClause =
      typeof filters?.project_id === 'string' && filters.project_id.length > 0
        ? 'AND m.project_id = ?'
        : '';
    let ownerClause = '';
    const ownerParams: unknown[] = [];
    const o = filters?.owner_id;
    if (typeof o === 'string' && o.length > 0) {
      ownerClause = 'AND m.owner_id = ?';
      ownerParams.push(o);
    } else if (Array.isArray(o) && o.length > 0) {
      ownerClause = 'AND m.owner_id IN (' + o.map(() => '?').join(',') + ')';
      ownerParams.push(...o);
    }
    const buildScopeClause = (
      column: 'process_id' | 'session_id',
      value: string | string[] | undefined,
    ): { clause: string; params: unknown[] } => {
      if (typeof value === 'string' && value.length > 0) {
        return { clause: `AND m.${column} = ?`, params: [value] };
      }
      if (Array.isArray(value) && value.length > 0) {
        return {
          clause: `AND m.${column} IN (${value.map(() => '?').join(',')})`,
          params: value,
        };
      }
      return { clause: '', params: [] };
    };
    const processScope = buildScopeClause('process_id', filters?.process_id);
    const sessionScope = buildScopeClause('session_id', filters?.session_id);
    const projectParams: unknown[] =
      typeof filters?.project_id === 'string' && filters.project_id.length > 0 ? [filters.project_id] : [];
    const filterParams: unknown[] = [
      ...(filters?.type || []),
      ...projectParams,
      ...ownerParams,
      ...processScope.params,
      ...sessionScope.params,
    ];
    const hasScopedCandidates = filterParams.length > 0;
    const scopedFilters = [typeFilter, projectClause, ownerClause, processScope.clause, sessionScope.clause]
      .filter(Boolean)
      .join(' ')
      .replaceAll('m.', 'scoped_m.');
    const scopedCandidateSql = hasScopedCandidates
      ? ' AND rowid IN (' +
        'SELECT scoped_me.id FROM memory_embedding scoped_me ' +
        'JOIN memory_item scoped_m ON scoped_m.id = scoped_me.memory_id ' +
        'WHERE scoped_me.embedding_provider = ? ' +
        'AND (COALESCE(scoped_m.is_deleted, 0) = 0) ' +
        scopedFilters +
        ') '
      : '';
    const limit = filters?.limit || 10;
    const sql =
      'SELECT ' +
      '  m.id, ' +
      '  m.content, ' +
      '  m.type, ' +
      '  m.importance, ' +
      '  m.created_at, ' +
      '  m.last_accessed, ' +
      '  m.pinned, ' +
      '  m.tags, ' +
      '  m.project_id, ' +
      '  m.owner_id, ' +
      '  m.process_id, ' +
      '  m.session_id, ' +
      '  v.distance as distance ' +
      'FROM (' +
      '  SELECT rowid, distance ' +
      `  FROM ${tableName} ` +
      '  WHERE embedding MATCH ? ' +
      '  AND k = ? ' +
      scopedCandidateSql +
      '  ORDER BY distance ASC' +
      ') v ' +
      'JOIN memory_embedding me ON me.id = v.rowid ' +
      'JOIN memory_item m ON m.id = me.memory_id ' +
      'WHERE me.embedding_provider = ? ' +
      'AND (COALESCE(m.is_deleted, 0) = 0) ' +
      typeFilter +
      projectClause +
      ' ' +
      ownerClause +
      ' ' +
      processScope.clause +
      ' ' +
      sessionScope.clause +
      ' ' +
      'ORDER BY v.distance ASC ' +
      'LIMIT ?';

    return {
      sql,
      params: [
        JSON.stringify(queryVector),
        limit,
        ...(hasScopedCandidates ? [provider, ...filterParams] : []),
        provider,
        ...filterParams,
        limit,
      ],
    };
  }

  private mapSimilaritySearchRows(rows: SimilaritySearchRow[]): VectorSearchResult[] {
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      type: row.type,
      importance: row.importance,
      created_at: row.created_at,
      last_accessed: row.last_accessed ?? undefined,
      pinned: Boolean(row.pinned),
      tags: this.safeParseTags(row.tags),
      similarity: cosineDistanceToSimilarity(row.distance),
      ...(row.project_id !== undefined ? { project_id: row.project_id } : {}),
      ...(row.owner_id !== undefined ? { owner_id: row.owner_id } : {}),
      ...(row.process_id !== undefined ? { process_id: row.process_id } : {}),
      ...(row.session_id !== undefined ? { session_id: row.session_id } : {}),
    }));
  }

  /**
   * sqlite-vec 확장 로드
   * init.ts와 동일한 방식으로 sqlite-vec 패키지의 getLoadablePath() 사용
   */
  private async loadVecExtension(db: Database.Database): Promise<void> {
    try {
      // sqlite-vec 패키지에서 올바른 경로 가져오기
      const { getLoadablePath } = await import('sqlite-vec');
      const extensionPath = getLoadablePath();
      db.loadExtension(extensionPath);
      // 성공 시 로그는 출력하지 않음 (너무 많은 로그 방지)
    } catch (error) {
      // 실패해도 치명적이지 않음 (TF-IDF fallback 사용)
      // 로그는 한 번만 출력하도록 조건부 처리
      const g = globalThis as GlobalWithVecWarning;
      if (!g.__vecExtensionLoadWarningShown) {
        const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
        this.writeEmbeddingStderr(
          'warn',
          `sqlite-vec 확장 로드 실패 (TF-IDF fallback 사용): ${maskedError.message}`
        );
        g.__vecExtensionLoadWarningShown = true;
      }
    }
  }

  /**
   * 메모리에 임베딩 생성 및 저장
   */
  async createAndStoreEmbedding(
    db: Database.Database,
    memoryId: string,
    content: string,
    _type: MemoryType,
    preferredProvider?: EmbeddingProvider
  ): Promise<EmbeddingResult | null> {
    if (!this.embeddingService.isAvailable()) {
      this.writeEmbeddingStderr('warn', '임베딩 서비스가 사용 불가능합니다. 임베딩을 건너뜁니다.');
      return null;
    }

    try {
      await this.loadVecExtension(db);

      const embeddingResult = await this.embeddingService.generateEmbedding(content, preferredProvider);
      if (!embeddingResult) {
        return null;
      }

      const embeddingVector = Array.isArray(embeddingResult.embedding) ? embeddingResult.embedding : [];
      if (embeddingVector.length === 0) {
        this.writeEmbeddingStderr('warn', `임베딩 결과가 비어 있어 저장을 건너뜁니다. memoryId=${memoryId}`);
        return null;
      }

      const provider = this.normalizeProvider(
        embeddingResult.provider ?? this.embeddingService.getCurrentProviderName() ?? undefined
      );

      const compatibility = vectorCompatibilityService.assessProviderCompatibility(embeddingVector, provider);
      const blockingIssues = this.getBlockingCompatibilityIssues(compatibility);

      if (blockingIssues.length > 0) {
        const errorMessages = blockingIssues.map((issue) => issue.message).join(', ');
        this.writeEmbeddingStderr('error', `임베딩 벡터 검증 실패: ${errorMessages}`);
        return null;
      }

      this.emitCompatibilityDiagnosticsForCreate(compatibility);

      // #753: metadata table-wide repair는 migrate/bootstrap 1회 — hot path에서 호출하지 않음
      await this.insertMemoryEmbeddingForCreate(db, memoryId, provider, embeddingResult, compatibility);

      return {
        ...embeddingResult,
        provider,
        embedding: compatibility.projection.vector
      };
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      this.writeEmbeddingStderr('error', `임베딩 저장 실패 (${memoryId}): ${maskedError.message}`);
      return null;
    }
  }

  /**
   * 벡터 유사도 검색
   */
  async searchBySimilarity(
    db: Database.Database,
    query: string,
    filters?: {
      type?: MemoryType[];
      limit?: number;
      threshold?: number;
      project_id?: string;
      owner_id?: string | string[];
      process_id?: string | string[];
      session_id?: string | string[];
    }
  ): Promise<SearchBySimilarityOutcome> {
    if (!this.embeddingService.isAvailable()) {
      this.writeEmbeddingStderr('warn', '임베딩 서비스가 사용 불가능합니다.');
      return { results: [] };
    }

    /** vec SQL 등 후속 단계 실패 시에도 쿼리 임베딩 provider 진단을 잃지 않도록 캡처 */
    let queryEmbeddingProviders: EmbeddingProvider[] | undefined;

    try {
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      if (!queryEmbedding) {
        return { results: [] };
      }

      const provider = this.normalizeProvider(queryEmbedding.provider);
      queryEmbeddingProviders = [provider];
      const tableName = getValidatedVectorTableName(provider);
      const { sql, params } = this.buildVecSimilarityQuery(
        provider,
        tableName,
        queryEmbedding.embedding,
        filters,
      );
      const similarities = await DatabaseUtils.all(db, sql, params);

      return {
        results: this.mapSimilaritySearchRows(similarities as SimilaritySearchRow[]),
        query_embedding_providers: [provider]
      };
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      this.writeEmbeddingStderr('error', `벡터 검색 실패: ${maskedError.message}`);
      return {
        results: [],
        ...(queryEmbeddingProviders !== undefined
          ? { query_embedding_providers: queryEmbeddingProviders }
          : {})
      };
    }
  }


  /**
   * 임베딩 삭제
   */
  async deleteEmbedding(db: Database.Database, memoryId: string): Promise<void> {
    try {
      // memory_embedding 테이블에서 삭제 (트리거가 자동으로 vec0 테이블에서도 삭제)
      await DatabaseUtils.run(db, 'DELETE FROM memory_embedding WHERE memory_id = ?', [memoryId]);
      // 로그는 디버그 모드에서만 출력 (MCP 프로토콜 준수)
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      this.writeEmbeddingStderr('error', `임베딩 삭제 실패 (${memoryId}): ${maskedError.message}`);
    }
  }

  private safeParseTags(rawTags: string | null | undefined): string[] {
    if (!rawTags) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawTags);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      this.writeEmbeddingStderr('warn', `태그 JSON 파싱 실패, 빈 배열로 대체합니다. ${maskedError.message}`);
      return [];
    }
  }

  /**
   * 임베딩 서비스 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    return this.embeddingService.isAvailable();
  }

  /**
   * 임베딩 통계 정보
   */
  async getEmbeddingStats(db: Database.Database): Promise<{
    totalEmbeddings: number;
    averageDimensions: number;
    model: string;
    providerStats: Array<{
      provider: string;
      count: number;
      dimensions: number;
    }>;
  }> {
    try {
      // 전체 통계
      const stats = await DatabaseUtils.all(db, `
        SELECT 
          COUNT(*) as total_embeddings,
          AVG(dimensions) as avg_dimensions
        FROM memory_embedding
      `);

      // 제공자별 통계
      const providerStats = await DatabaseUtils.all(db, `
        SELECT 
          embedding_provider as provider,
          COUNT(*) as count,
          AVG(dimensions) as dimensions
        FROM memory_embedding
        GROUP BY embedding_provider
        ORDER BY count DESC
      `);

      const stat = stats[0] as
        | { total_embeddings?: number; avg_dimensions?: number }
        | undefined;

      return {
        totalEmbeddings: stat?.total_embeddings ?? 0,
        averageDimensions: stat?.avg_dimensions ?? 0,
        model: this.embeddingService.getModelInfo().model,
        providerStats: (providerStats as EmbeddingProviderStatRow[]).map((row) => ({
          provider: this.normalizeProvider(row.provider),
          count: row.count,
          dimensions: Math.round(row.dimensions || 0),
        })),
      };
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      this.writeEmbeddingStderr('error', `임베딩 통계 조회 실패: ${maskedError.message}`);
      return {
        totalEmbeddings: 0,
        averageDimensions: 0,
        model: 'unknown',
        providerStats: [],
      };
    }
  }

  private normalizeProvider(provider?: string | null): EmbeddingProvider {
    const normalized = (provider || '').toLowerCase();
    switch (normalized) {
      case 'tfidf':
      case 'minilm':
      case 'openai':
      case 'gemini':
      case 'mock':
        return normalized as EmbeddingProvider;
      default:
        return this.defaultProvider;
    }
  }
}
