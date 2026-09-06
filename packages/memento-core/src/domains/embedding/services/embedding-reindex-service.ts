import type Database from 'better-sqlite3';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import type { MemoryType } from '../../../shared/types/memory.types.js';
import { getEmbeddingModelFilter } from '../../../shared/config/embedding-models.js';
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
  /**
   * #889: provider는 맞지만 현재 모델이 아닌 임베딩 수. 벡터 검색이 이 행들을
   * 제외하므로(모델이 섞이면 코사인 유사도가 무의미) 재색인이 끝날 때까지 0이 아니다.
   * 모델을 거르지 않는 provider(openai·gemini 등)는 항상 0이다.
   */
  modelDriftCount: number;
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

export interface ReindexByIdsResult {
  provider: EmbeddingProvider;
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
export function normalizeProvider(provider: EmbeddingProvider): EmbeddingProvider {
  return provider === 'lightweight' ? 'tfidf' : provider;
}

/** #713 vec 계약의 단일 원본(VectorCompatibilityService)에서 provider별 native 차원을 가져온다. */
export function expectedDimensions(provider: EmbeddingProvider): number {
  return vectorCompatibilityService.getNativeDimensions(provider);
}

/** SQLite IN절 파라미터 상한(기본 999) 회피용 기본 청크 크기 */
export const ID_CHUNK_SIZE = 500;

/**
 * #728: ID 목록을 청크로 나눠 `IN (...)` 조회를 반복하고 결과를 이어붙인다.
 * `introspection-healing-service.ts`와 이 파일의 `reindexByIds`가 공유하는 패턴.
 */
export function chunkedIn<T>(
  ids: string[],
  size: number,
  query: (chunk: string[], placeholders: string) => T[],
): T[] {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    results.push(...query(chunk, chunk.map(() => '?').join(',')));
  }
  return results;
}

export class EmbeddingReindexService {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddingService: ReindexEmbeddingService,
  ) {}

  diagnose(options: Pick<EmbeddingReindexOptions, 'provider' | 'ownerId'>): EmbeddingHealthDiagnostics {
    const provider = normalizeProvider(options.provider);
    const modelFilter = getEmbeddingModelFilter(provider);
    const ownerClause = options.ownerId ? ' AND mi.owner_id = ?' : '';
    const row = this.db.prepare(`
      SELECT
        COUNT(DISTINCT mi.id) AS memory_count,
        COUNT(DISTINCT me.memory_id) AS provider_embedding_count,
        COUNT(DISTINCT CASE WHEN me.memory_id IS NULL THEN mi.id END) AS missing_embedding_count,
        COUNT(DISTINCT CASE WHEN me.memory_id IS NOT NULL AND me.dim != ? THEN mi.id END) AS dimension_mismatch_count,
        COUNT(DISTINCT CASE WHEN other.memory_id IS NOT NULL THEN mi.id END) AS provider_drift_count,
        COUNT(DISTINCT CASE WHEN me.memory_id IS NOT NULL
          AND ? IS NOT NULL AND COALESCE(me.model, '') != ? THEN mi.id END) AS model_drift_count
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
    `).get(
      expectedDimensions(provider),
      modelFilter,
      modelFilter ?? '',
      provider,
      provider,
      ...(options.ownerId ? [options.ownerId] : []),
    ) as {
      memory_count: number; provider_embedding_count: number; missing_embedding_count: number;
      dimension_mismatch_count: number; provider_drift_count: number; model_drift_count: number;
    };

    return {
      provider,
      expectedDimensions: expectedDimensions(provider),
      memoryCount: row.memory_count,
      providerEmbeddingCount: row.provider_embedding_count,
      missingEmbeddingCount: row.missing_embedding_count,
      dimensionMismatchCount: row.dimension_mismatch_count,
      providerDriftCount: row.provider_drift_count,
      modelDriftCount: row.model_drift_count,
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

    const { storedCount, failedCount } = await this.embedAndStore(candidates, provider);
    return { provider, candidateCount, dryRun: false, processedCount: candidateCount, storedCount, failedCount };
  }

  /**
   * #728: 스캔으로 이미 좁혀진 소수 ID만 재임베딩한다. `reindex()`는 provider의 전체
   * 메모리를 훑지만, introspection heal 대상은 이미 결정된 ID 목록이라 그럴 필요가 없다.
   */
  async reindexByIds(
    ids: string[],
    options: { provider: EmbeddingProvider; dryRun?: boolean },
  ): Promise<ReindexByIdsResult> {
    const provider = normalizeProvider(options.provider);
    if (ids.length === 0) {
      return { provider, dryRun: !!options.dryRun, processedCount: 0, storedCount: 0, failedCount: 0 };
    }
    if (!this.embeddingService.isAvailable()) {
      throw new Error('embedding service is unavailable');
    }

    const memories = chunkedIn(ids, ID_CHUNK_SIZE, (chunk, placeholders) => this.db.prepare(`
      SELECT id, content, type FROM memory_item
      WHERE id IN (${placeholders}) AND COALESCE(is_deleted, 0) = 0
    `).all(...chunk) as MemoryRow[]);

    if (options.dryRun) {
      return { provider, dryRun: true, processedCount: memories.length, storedCount: 0, failedCount: 0 };
    }

    const { storedCount, failedCount } = await this.embedAndStore(memories, provider);
    return { provider, dryRun: false, processedCount: memories.length, storedCount, failedCount };
  }

  /**
   * #728: `backfillSemanticRelationEndpoints`·`reindexByIds`가 공유하는
   * "임베딩 생성 → provider/차원 검증 → native 저장 검증" 루프.
   */
  private async embedAndStore(
    memories: MemoryRow[],
    provider: EmbeddingProvider,
  ): Promise<{ storedCount: number; failedCount: number }> {
    const expected = expectedDimensions(provider);
    let storedCount = 0;
    let failedCount = 0;

    for (const memory of memories) {
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
        // MEDIUM(#722 review): 반환된 벡터 길이만으로는 "native" 저장을 보장하지 못한다.
        // MemoryEmbeddingService가 source-dimension mismatch로 zero_pad/average_pool 등
        // non-native projection을 DB에 저장하고도 target-length 벡터를 반환할 수 있어,
        // #713 vec 계약(projection_type='native')과 어긋나는 성공 판정이 발생한다.
        if (!this.hasNativeEmbeddingRow(memory.id, provider, expected)) {
          failedCount++;
          continue;
        }
        storedCount++;
      } catch {
        failedCount++;
      }
    }

    return { storedCount, failedCount };
  }

  /**
   * #722 MEDIUM: `memory_embedding`에 canonical provider + `projection_type='native'` +
   * 기대 차원(dimensions) 행이 실제로 존재하는지 확인한다. #713 vec 계약과 동일한 조건이며,
   * 이 조건을 만족해야만 vec 트리거·후보 필터에서 "임베딩 있음"으로 인정된다.
   */
  private hasNativeEmbeddingRow(memoryId: string, provider: EmbeddingProvider, dimensions: number): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM memory_embedding
      WHERE memory_id = ? AND embedding_provider = ? AND projection_type = 'native' AND dimensions = ?
    `).get(memoryId, provider, dimensions);
    return row !== undefined;
  }
}
