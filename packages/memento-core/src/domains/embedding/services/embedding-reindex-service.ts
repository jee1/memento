import type Database from 'better-sqlite3';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import type { MemoryType } from '../../../shared/types/index.js';
import { vectorCompatibilityService } from './vector-compatibility-service.js';

export interface EmbeddingReindexOptions {
  provider: EmbeddingProvider;
  ownerId?: string;
  batchSize?: number;
  dryRun?: boolean;
}

export interface EmbeddingHealthDiagnostics {
  provider: EmbeddingProvider;
  expectedDimensions: number;
  memoryCount: number;
  providerEmbeddingCount: number;
  missingEmbeddingCount: number;
  dimensionMismatchCount: number;
  providerDriftCount: number;
}

export interface EmbeddingReindexResult extends EmbeddingHealthDiagnostics {
  dryRun: boolean;
  processedCount: number;
  storedCount: number;
  failedCount: number;
}

export interface SemanticEndpointBackfillOptions {
  provider: EmbeddingProvider;
  /** 제한적 backfill: 한 번에 처리할 최대 후보 수 (기본 200, 최대 1000) */
  limit?: number;
  dryRun?: boolean;
}

export interface SemanticEndpointBackfillResult {
  provider: EmbeddingProvider;
  candidateCount: number;
  dryRun: boolean;
  processedCount: number;
  storedCount: number;
  failedCount: number;
}

type MemoryRow = { id: string; content: string; type: MemoryType };

type ReindexEmbeddingService = {
  isAvailable(): boolean;
  createAndStoreEmbedding(
    db: Database.Database,
    memoryId: string,
    content: string,
    type: MemoryType,
    preferredProvider?: EmbeddingProvider,
  ): Promise<{ embedding: number[]; provider?: EmbeddingProvider } | null>;
};

/**
 * #722: `lightweight`는 vec 테이블이 없는 입력 별칭이며, embedding-provider-factory가
 * 서비스 생성 시 `tfidf`로 정규화한다. 이 정규화 없이는 `lightweight` 요청의
 * expectedDimensions(384)가 실제로 저장되는 tfidf(512) 결과와 어긋난다.
 */
function normalizeProvider(provider: EmbeddingProvider): EmbeddingProvider {
  return provider === 'lightweight' ? 'tfidf' : provider;
}

/** #713 vec 계약의 단일 원본(VectorCompatibilityService)에서 provider별 native 차원을 가져온다. */
function expectedDimensions(provider: EmbeddingProvider): number {
  return vectorCompatibilityService.getNativeDimensions(provider);
}

export class EmbeddingReindexService {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddingService: ReindexEmbeddingService,
  ) {}

  diagnose(options: Pick<EmbeddingReindexOptions, 'provider' | 'ownerId'>): EmbeddingHealthDiagnostics {
    const provider = normalizeProvider(options.provider);
    const ownerClause = options.ownerId ? ' AND mi.owner_id = ?' : '';
    const row = this.db.prepare(`
      SELECT
        COUNT(DISTINCT mi.id) AS memory_count,
        COUNT(DISTINCT me.memory_id) AS provider_embedding_count,
        COUNT(DISTINCT CASE WHEN me.memory_id IS NULL THEN mi.id END) AS missing_embedding_count,
        COUNT(DISTINCT CASE WHEN me.memory_id IS NOT NULL AND me.dim != ? THEN mi.id END) AS dimension_mismatch_count,
        COUNT(DISTINCT CASE WHEN other.memory_id IS NOT NULL THEN mi.id END) AS provider_drift_count
      FROM memory_item mi
      LEFT JOIN memory_embedding me
        ON me.memory_id = mi.id
        AND me.embedding_provider = ?
        AND me.projection_type = 'native'
      LEFT JOIN memory_embedding other
        ON other.memory_id = mi.id
        AND other.embedding_provider != ?
        AND other.projection_type = 'native'
      WHERE COALESCE(mi.is_deleted, 0) = 0${ownerClause}
    `).get(expectedDimensions(provider), provider, provider, ...(options.ownerId ? [options.ownerId] : [])) as {
      memory_count: number; provider_embedding_count: number; missing_embedding_count: number;
      dimension_mismatch_count: number; provider_drift_count: number;
    };

    return {
      provider,
      expectedDimensions: expectedDimensions(provider),
      memoryCount: row.memory_count,
      providerEmbeddingCount: row.provider_embedding_count,
      missingEmbeddingCount: row.missing_embedding_count,
      dimensionMismatchCount: row.dimension_mismatch_count,
      providerDriftCount: row.provider_drift_count,
    };
  }

  async reindex(options: EmbeddingReindexOptions): Promise<EmbeddingReindexResult> {
    const batchSize = options.batchSize ?? 100;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new Error('batchSize must be an integer between 1 and 1000');
    }
    if (!this.embeddingService.isAvailable()) {
      throw new Error('embedding service is unavailable');
    }

    const provider = normalizeProvider(options.provider);
    const diagnostics = this.diagnose({ ...options, provider });
    const ownerClause = options.ownerId ? ' AND owner_id = ?' : '';
    const memories = this.db.prepare(`
      SELECT id, content, type FROM memory_item
      WHERE COALESCE(is_deleted, 0) = 0${ownerClause}
      ORDER BY id
    `).all(...(options.ownerId ? [options.ownerId] : [])) as MemoryRow[];

    if (options.dryRun) {
      return { ...diagnostics, dryRun: true, processedCount: memories.length, storedCount: 0, failedCount: 0 };
    }

    let storedCount = 0;
    let failedCount = 0;

    for (let start = 0; start < memories.length; start += batchSize) {
      for (const memory of memories.slice(start, start + batchSize)) {
        try {
          const result = await this.embeddingService.createAndStoreEmbedding(
            this.db,
            memory.id,
            memory.content,
            memory.type,
            provider,
          );
          if (!result || result.provider !== provider || result.embedding.length !== diagnostics.expectedDimensions) {
            failedCount++;
            continue;
          }
          storedCount++;
        } catch {
          failedCount++;
        }
      }
    }

    return { ...this.diagnose({ ...options, provider }), dryRun: false, processedCount: memories.length, storedCount, failedCount };
  }

  /**
   * #710: memory_relation의 endpoint(source 또는 target)인 semantic 메모리 중
   * 임베딩이 없는 항목을 찾는다. Triple → semantic 경로로 생성된 관계 이웃이
   * n-hop/벡터 확장에서 소외되는 문제(#707)를 겨냥한 제한적 backfill 대상 조회.
   *
   * #713 vec 계약(`embedding_provider` + `dimensions`(예상 차원) + `projection_type='native'`)과
   * 동일한 조건으로 "임베딩 있음"을 판정한다. non-native projection이거나 예상 차원과 다른
   * 행만 있는 경우는 vec 인덱스에 적재되지 않으므로 여전히 backfill 대상으로 남겨야 한다.
   */
  findSemanticRelationEndpointsMissingEmbedding(
    provider: EmbeddingProvider,
    limit: number,
  ): MemoryRow[] {
    const normalized = normalizeProvider(provider);
    return this.db.prepare(`
      SELECT DISTINCT mi.id, mi.content, mi.type
      FROM memory_item mi
      WHERE mi.type = 'semantic'
        AND COALESCE(mi.is_deleted, 0) = 0
        AND NOT EXISTS (
          SELECT 1 FROM memory_embedding me
          WHERE me.memory_id = mi.id
            AND me.embedding_provider = ?
            AND me.projection_type = 'native'
            AND me.dimensions = ?
        )
        AND EXISTS (
          SELECT 1 FROM memory_relation mr
          WHERE mr.source_id = mi.id OR mr.target_id = mi.id
        )
      ORDER BY mi.id
      LIMIT ?
    `).all(normalized, expectedDimensions(normalized), limit) as MemoryRow[];
  }

  /**
   * #710: 제한된 개수만큼 semantic relation-endpoint 임베딩을 채워 넣는다.
   * 전체 재색인(reindex)과 달리 memory_relation에 연결된 semantic 메모리로 범위를 좁혀
   * 재색인을 반복하지 않고도 n-hop 확장에 필요한 최소 임베딩을 확보한다.
   */
  async backfillSemanticRelationEndpoints(
    options: SemanticEndpointBackfillOptions,
  ): Promise<SemanticEndpointBackfillResult> {
    const limit = options.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('limit must be an integer between 1 and 1000');
    }
    if (!this.embeddingService.isAvailable()) {
      throw new Error('embedding service is unavailable');
    }

    const provider = normalizeProvider(options.provider);
    const candidates = this.findSemanticRelationEndpointsMissingEmbedding(provider, limit);
    const candidateCount = candidates.length;

    if (options.dryRun) {
      return { provider, candidateCount, dryRun: true, processedCount: candidateCount, storedCount: 0, failedCount: 0 };
    }

    let storedCount = 0;
    let failedCount = 0;
    const expected = expectedDimensions(provider);

    for (const memory of candidates) {
      try {
        const result = await this.embeddingService.createAndStoreEmbedding(
          this.db,
          memory.id,
          memory.content,
          memory.type,
          provider,
        );
        if (!result || result.provider !== provider || result.embedding.length !== expected) {
          failedCount++;
          continue;
        }
        storedCount++;
      } catch {
        failedCount++;
      }
    }

    return { provider, candidateCount, dryRun: false, processedCount: candidateCount, storedCount, failedCount };
  }
}
