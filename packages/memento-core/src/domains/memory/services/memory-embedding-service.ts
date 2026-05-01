/**
 * 메모리 임베딩 저장 및 검색 서비스
 * 데이터베이스와 임베딩 서비스를 연동
 */

import type Database from 'better-sqlite3';
import type { EmbeddingProvider,EmbeddingResult } from '../../../shared/types/embedding.types.js';
import type { MemoryType } from '../../../shared/types/index.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
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
  score: number;
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
  similarity: number;
  score: number;
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
        process.stderr.write(`⚠️ sqlite-vec 확장 로드 실패 (TF-IDF fallback 사용): ${maskedError.message}\n`);
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
    type: MemoryType,
    preferredProvider?: EmbeddingProvider
  ): Promise<EmbeddingResult | null> {
    if (!this.embeddingService.isAvailable()) {
      process.stderr.write('⚠️ 임베딩 서비스가 사용 불가능합니다. 임베딩을 건너뜁니다.\n');
      return null;
    }

    try {
      // sqlite-vec 확장 로드 (비동기)
      await this.loadVecExtension(db);
      
      // 임베딩 생성
      const embeddingResult = await this.embeddingService.generateEmbedding(content, preferredProvider);
      if (!embeddingResult) {
        return null;
      }

      const embeddingVector = Array.isArray(embeddingResult.embedding) ? embeddingResult.embedding : [];
      if (embeddingVector.length === 0) {
        process.stderr.write(`⚠️ 임베딩 결과가 비어 있어 저장을 건너뜁니다. memoryId=${memoryId}\n`);
        return null;
      }

      const provider = this.normalizeProvider(
        embeddingResult.provider ?? this.embeddingService.getCurrentProviderName() ?? undefined
      );

      const compatibility = vectorCompatibilityService.assessProviderCompatibility(
        embeddingVector,
        provider
      );

      const blockingIssues = compatibility.issues.filter(
        issue => issue.severity === 'error' && issue.code !== 'dimension_mismatch'
      );

      if (blockingIssues.length > 0) {
        const errorMessages = blockingIssues.map(issue => issue.message).join(', ');
        process.stderr.write(`❌ 임베딩 벡터 검증 실패: ${errorMessages}\n`);
        return null;
      }

      const projection = compatibility.projection;
      const storedVector = projection.vector;
      const serializedEmbedding = JSON.stringify(storedVector);
      const sourceDimensions = projection.sourceDimensions;
      const storedDimensions = projection.targetDimensions;
      const projectionType = projection.projectionType;
      const normalized = projection.normalized ? 1 : 0;

      if (compatibility.needsProjection) {
        const dimensionIssue = compatibility.issues.find(
          issue => issue.code === 'dimension_mismatch'
        );
        if (dimensionIssue) {
          process.stderr.write(`⚠️ ${dimensionIssue.message}\n`);
        }
        process.stderr.write(`🔄 벡터 차원 조정: ${sourceDimensions} → ${storedDimensions} (${projectionType})\n`);
      }

      compatibility.issues
        .filter(issue => issue.severity === 'warning')
        .forEach(issue => process.stderr.write(`⚠️ 임베딩 경고: ${issue.message}\n`));

      // metadata 보정 (기존 레거시 행 대비)
      await this.ensureMetadataDefaults(db);

      // memory_embedding 테이블에 저장 (트리거가 자동으로 vec0 테이블에 저장)
      await DatabaseUtils.run(db, `
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
      `, [
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
      ]);

      // 로그는 디버그 모드에서만 출력 (MCP 프로토콜 준수)
      return {
        ...embeddingResult,
        provider,
        embedding: storedVector
      };

    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      process.stderr.write(`❌ 임베딩 저장 실패 (${memoryId}): ${maskedError.message}\n`);
      return null;
    }
  }

  /**
   * 제공자별 vec0 테이블명 반환
   * SQL Injection 방지를 위해 화이트리스트 기반 검증을 수행합니다.
   */
  private getVectorTableName(provider: string): string {
    return getValidatedVectorTableName(provider);
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
    }
  ): Promise<SearchBySimilarityOutcome> {
    if (!this.embeddingService.isAvailable()) {
      process.stderr.write('⚠️ 임베딩 서비스가 사용 불가능합니다.\n');
      return { results: [] };
    }

    /** vec SQL 등 후속 단계 실패 시에도 쿼리 임베딩 provider 진단을 잃지 않도록 캡처 */
    let queryEmbeddingProviders: EmbeddingProvider[] | undefined;

    try {
      // 레거시 데이터에 대해 메타데이터 보정
      await this.ensureMetadataDefaults(db);

      // 쿼리 임베딩 생성
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      if (!queryEmbedding) {
        return { results: [] };
      }

      // 제공자별 테이블에서 검색
      const provider = this.normalizeProvider(queryEmbedding.provider);
      queryEmbeddingProviders = [provider];
      const tableName = this.getVectorTableName(provider);
      // SQL Injection 방지: 화이트리스트 검증은 getVectorTableName()에서 수행됨
      
      // vec0 테이블에서 유사도 검색
      // 템플릿 리터럴 대신 문자열 연결 사용
      const typeFilter = filters?.type 
        ? 'AND m.type IN (' + filters.type.map(() => '?').join(',') + ')' 
        : '';
      const sqlQuery = 
        'SELECT ' +
        '  m.id, ' +
        '  m.content, ' +
        '  m.type, ' +
        '  m.importance, ' +
        '  m.created_at, ' +
        '  m.last_accessed, ' +
        '  m.pinned, ' +
        '  m.tags, ' +
        '  v.distance as similarity, ' +
        '  (1 - v.distance) as score ' +
        'FROM memory_item m ' +
        'JOIN memory_embedding me ON m.id = me.memory_id ' +
        'JOIN ' + tableName + ' v ON me.id = v.rowid ' +
        'WHERE me.embedding_provider = ? ' +
        typeFilter + ' ' +
        'ORDER BY v.distance ASC ' +
        'LIMIT ?';
      
      const similarities = await DatabaseUtils.all(db, sqlQuery, [
        provider,
        ...(filters?.type || []),
        filters?.limit || 10
      ]);

      // 결과를 VectorSearchResult 형태로 변환
      const results: VectorSearchResult[] = (similarities as SimilaritySearchRow[]).map((row) => ({
        id: row.id,
        content: row.content,
        type: row.type,
        importance: row.importance,
        created_at: row.created_at,
        last_accessed: row.last_accessed ?? undefined,
        pinned: Boolean(row.pinned),
        tags: this.safeParseTags(row.tags),
        similarity: row.similarity,
        score: row.score,
      }));

      return {
        results,
        query_embedding_providers: [provider],
      };

    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      process.stderr.write(`❌ 벡터 검색 실패: ${maskedError.message}\n`);
      return {
        results: [],
        ...(queryEmbeddingProviders !== undefined
          ? { query_embedding_providers: queryEmbeddingProviders }
          : {}),
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
      process.stderr.write(`❌ 임베딩 삭제 실패 (${memoryId}): ${maskedError.message}\n`);
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
      process.stderr.write(`⚠️ 태그 JSON 파싱 실패, 빈 배열로 대체합니다. ${maskedError.message}\n`);
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
      await this.ensureMetadataDefaults(db);

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
      process.stderr.write(`❌ 임베딩 통계 조회 실패: ${maskedError.message}\n`);
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
        return normalized as EmbeddingProvider;
      default:
        return this.defaultProvider;
    }
  }

  private async ensureMetadataDefaults(db: Database.Database): Promise<void> {
    try {
      await DatabaseUtils.run(db, `
        UPDATE memory_embedding
        SET embedding_provider = COALESCE(
          NULLIF(embedding_provider, ''),
          CASE
            WHEN model IN ('lightweight-hybrid', 'tfidf') THEN 'tfidf'
            WHEN model LIKE '%minilm%' THEN 'minilm'
            WHEN model LIKE '%openai%' THEN 'openai'
            WHEN model LIKE '%gemini%' THEN 'gemini'
            ELSE ?
          END
        ),
        projection_type = COALESCE(NULLIF(projection_type, ''), 'native'),
        precision = COALESCE(precision, 32),
        normalized = COALESCE(normalized, 0),
        version = COALESCE(version, 1),
        dim = CASE
          WHEN dim IS NULL OR dim = 0 THEN json_array_length(embedding)
          ELSE dim
        END,
        dimensions = CASE
          WHEN dimensions IS NULL OR dimensions = 0 THEN json_array_length(embedding)
          ELSE dimensions
        END,
        created_by = COALESCE(created_by, 'legacy')
        WHERE embedding_provider IS NULL
           OR embedding_provider = ''
           OR dimensions IS NULL
           OR dimensions = 0
           OR projection_type IS NULL
           OR projection_type = ''
           OR precision IS NULL
           OR precision = 0
           OR normalized IS NULL
           OR version IS NULL
           OR version = 0
           OR created_by IS NULL
      `, [this.defaultProvider]);
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      process.stderr.write(`⚠️ 임베딩 메타데이터 보정 실패: ${maskedError.message}\n`);
    }
  }
}
