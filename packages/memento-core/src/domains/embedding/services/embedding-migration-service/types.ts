import type { EmbeddingProvider, ProjectionType } from '../../../../shared/types/embedding.types.js';

export interface RawEmbeddingRow {
  memory_id: string;
  embedding: Buffer;
  model: string | null;
  embedding_provider: EmbeddingProvider;
  projection_type: ProjectionType;
  dim: number;
  dimensions: number;
  created_at: string;
}

export interface ExistingEmbeddingRow {
  embedding: Buffer;
  dim: number;
  model: string | null;
  dimensions: number;
  precision: number;
  normalized: number;
  version: number;
  created_by: string | null;
  created_at: string | null;
}

export const DEFAULT_BATCH_SIZE = 500;
export const DEFAULT_CREATED_BY = 'embedding_migration_service';
