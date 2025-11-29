/**
 * 메모리 임베딩 저장 및 검색 서비스
 * 데이터베이스와 임베딩 서비스를 연동
 */

import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { vectorCompatibilityService } from '../../../services/vector-compatibility-service.js';
import type { EmbeddingProvider, EmbeddingResult } from '../../../types/embedding.types.js';
import { DatabaseUtils } from '../../../utils/database.js';
import type { MemoryType } from '../../../types/index.js';

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

export class MemoryEmbeddingService {
  private embeddingService: UnifiedEmbeddingService;
  private readonly defaultProvider: EmbeddingProvider = 'tfidf';
  private readonly createdByTag = 'memory_embedding_service';

  constructor() {
    this.embeddingService = new UnifiedEmbeddingService();
  }

  /**
   * sqlite-vec 확장 로드
   * init.ts와 동일한 방식으로 sqlite-vec 패키지의 getLoadablePath() 사용
   */
  private async loadVecExtension(db: any): Promise<void> {
    try {
      // sqlite-vec 패키지에서 올바른 경로 가져오기
      const { getLoadablePath } = await import('sqlite-vec');
      const extensionPath = getLoadablePath();
      db.loadExtension(extensionPath);
      // 성공 시 로그는 출력하지 않음 (너무 많은 로그 방지)
    } catch (error) {
      // 실패해도 치명적이지 않음 (TF-IDF fallback 사용)
      // 로그는 한 번만 출력하도록 조건부 처리
      if (!(global as any).__vecExtensionLoadWarningShown) {
        console.warn('⚠️ sqlite-vec 확장 로드 실패 (TF-IDF fallback 사용):', (error as Error).message);
        (global as any).__vecExtensionLoadWarningShown = true;
      }
    }
  }

  /**
   * 메모리에 임베딩 생성 및 저장
   */
  async createAndStoreEmbedding(
    db: any,
    memoryId: string,
    content: string,
    type: MemoryType
  ): Promise<EmbeddingResult | null> {
    if (!this.embeddingService.isAvailable()) {
      console.warn('⚠️ 임베딩 서비스가 사용 불가능합니다. 임베딩을 건너뜁니다.');
      return null;
    }

    try {
      // sqlite-vec 확장 로드 (비동기)
      await this.loadVecExtension(db);
      
      // 임베딩 생성
      const embeddingResult = await this.embeddingService.generateEmbedding(content);
      if (!embeddingResult) {
        return null;
      }

      const embeddingVector = Array.isArray(embeddingResult.embedding) ? embeddingResult.embedding : [];
      if (embeddingVector.length === 0) {
        console.warn(`⚠️ 임베딩 결과가 비어 있어 저장을 건너뜁니다. memoryId=${memoryId}`);
        return null;
      }

      const provider = this.normalizeProvider(
        embeddingResult.provider || this.embeddingService.getCurrentProviderName()
      );

      const compatibility = vectorCompatibilityService.assessProviderCompatibility(
        embeddingVector,
        provider
      );

      const blockingIssues = compatibility.issues.filter(
        issue => issue.severity === 'error' && issue.code !== 'dimension_mismatch'
      );

      if (blockingIssues.length > 0) {
        console.error('❌ 임베딩 벡터 검증 실패:', blockingIssues.map(issue => issue.message));
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
          console.warn(`⚠️ ${dimensionIssue.message}`);
        }
        console.log(
          `🔄 벡터 차원 조정: ${sourceDimensions} → ${storedDimensions} (${projectionType})`
        );
      }

      compatibility.issues
        .filter(issue => issue.severity === 'warning')
        .forEach(issue => console.warn(`⚠️ 임베딩 경고: ${issue.message}`));

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

      console.log(`✅ 임베딩 저장 완료: ${memoryId} (${storedDimensions}차원, ${provider})`);
      return {
        ...embeddingResult,
        provider,
        embedding: storedVector
      };

    } catch (error) {
      console.error(`❌ 임베딩 저장 실패 (${memoryId}):`, error);
      return null;
    }
  }

  /**
   * 제공자별 vec0 테이블명 반환
   */
  private getVectorTableName(provider: string): string {
    switch (provider) {
      case 'tfidf':
        return 'memory_item_vec_tfidf';
      case 'minilm':
        return 'memory_item_vec_minilm';
      case 'openai':
        return 'memory_item_vec_openai';
      case 'gemini':
        return 'memory_item_vec_gemini';
      default:
        return 'memory_item_vec_tfidf'; // 기본값
    }
  }

  /**
   * 벡터 유사도 검색
   */
  async searchBySimilarity(
    db: any,
    query: string,
    filters?: {
      type?: MemoryType[];
      limit?: number;
      threshold?: number;
    }
  ): Promise<VectorSearchResult[]> {
    if (!this.embeddingService.isAvailable()) {
      console.warn('⚠️ 임베딩 서비스가 사용 불가능합니다.');
      return [];
    }

    try {
      // 레거시 데이터에 대해 메타데이터 보정
      await this.ensureMetadataDefaults(db);

      // 쿼리 임베딩 생성
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      if (!queryEmbedding) {
        return [];
      }

      // 제공자별 테이블에서 검색
      const provider = this.normalizeProvider(queryEmbedding.provider);
      const tableName = this.getVectorTableName(provider);
      
      // vec0 테이블에서 유사도 검색
      const similarities = await DatabaseUtils.all(db, `
        SELECT 
          m.id,
          m.content,
          m.type,
          m.importance,
          m.created_at,
          m.last_accessed,
          m.pinned,
          m.tags,
          v.distance as similarity,
          (1 - v.distance) as score
        FROM memory_item m
        JOIN memory_embedding me ON m.id = me.memory_id
        JOIN ${tableName} v ON me.id = v.rowid
        WHERE me.embedding_provider = ?
        ${filters?.type ? `AND m.type IN (${filters.type.map(() => '?').join(',')})` : ''}
        ORDER BY v.distance ASC
        LIMIT ?
      `, [
        provider,
        ...(filters?.type || []),
        filters?.limit || 10
      ]);

      // 결과를 VectorSearchResult 형태로 변환
      const results: VectorSearchResult[] = similarities.map((row: any) => ({
        id: row.id,
        content: row.content,
        type: row.type,
        importance: row.importance,
        created_at: row.created_at,
        last_accessed: row.last_accessed,
        pinned: Boolean(row.pinned),
        tags: this.safeParseTags(row.tags),
        similarity: row.similarity,
        score: row.score,
      }));

      return results;

    } catch (error) {
      console.error('❌ 벡터 검색 실패:', error);
      return [];
    }
  }


  /**
   * 임베딩 삭제
   */
  async deleteEmbedding(db: any, memoryId: string): Promise<void> {
    try {
      // memory_embedding 테이블에서 삭제 (트리거가 자동으로 vec0 테이블에서도 삭제)
      await DatabaseUtils.run(db, 'DELETE FROM memory_embedding WHERE memory_id = ?', [memoryId]);
      console.log(`✅ 임베딩 삭제 완료: ${memoryId}`);
    } catch (error) {
      console.error(`❌ 임베딩 삭제 실패 (${memoryId}):`, error);
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
      console.warn('⚠️ 태그 JSON 파싱 실패, 빈 배열로 대체합니다.', error);
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
  async getEmbeddingStats(db: any): Promise<{
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

      const stat = stats[0];
      
      return {
        totalEmbeddings: stat.total_embeddings || 0,
        averageDimensions: stat.avg_dimensions || 0,
        model: this.embeddingService.getModelInfo().model,
        providerStats: providerStats.map((row: any) => ({
          provider: this.normalizeProvider(row.provider),
          count: row.count,
          dimensions: Math.round(row.dimensions || 0),
        })),
      };
    } catch (error) {
      console.error('❌ 임베딩 통계 조회 실패:', error);
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

  private async ensureMetadataDefaults(db: any): Promise<void> {
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
      console.warn('⚠️ 임베딩 메타데이터 보정 실패:', error);
    }
  }
}
