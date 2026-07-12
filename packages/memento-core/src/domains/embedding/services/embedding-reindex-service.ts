import type Database from 'better-sqlite3';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import type { MemoryType } from '../../../shared/types/index.js';
import { VECTOR_SEARCH } from '../../../shared/config/constants.js';

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

function expectedDimensions(provider: EmbeddingProvider): number {
  if (provider === 'mock') return VECTOR_SEARCH.DEFAULT_DIMENSIONS;
  return VECTOR_SEARCH.PROVIDER_DIMENSIONS[provider];
}

export class EmbeddingReindexService {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddingService: ReindexEmbeddingService,
  ) {}

  diagnose(options: Pick<EmbeddingReindexOptions, 'provider' | 'ownerId'>): EmbeddingHealthDiagnostics {
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
    `).get(expectedDimensions(options.provider), options.provider, options.provider, ...(options.ownerId ? [options.ownerId] : [])) as {
      memory_count: number; provider_embedding_count: number; missing_embedding_count: number;
      dimension_mismatch_count: number; provider_drift_count: number;
    };

    return {
      provider: options.provider,
      expectedDimensions: expectedDimensions(options.provider),
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

    const diagnostics = this.diagnose(options);
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
            options.provider,
          );
          if (!result || result.provider !== options.provider || result.embedding.length !== diagnostics.expectedDimensions) {
            failedCount++;
            continue;
          }
          storedCount++;
        } catch {
          failedCount++;
        }
      }
    }

    return { ...this.diagnose(options), dryRun: false, processedCount: memories.length, storedCount, failedCount };
  }
}
