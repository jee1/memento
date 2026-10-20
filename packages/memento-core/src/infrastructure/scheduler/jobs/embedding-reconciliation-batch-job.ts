import type Database from 'better-sqlite3';
import type { MemoryType } from '../../../shared/types/memory.types.js';
import { hashMemoryContent } from '../../../shared/utils/memory-content-hash.js';
import { createEmptyBatchJobResult, finalizeBatchJobTiming } from '../batch-scheduler/batch-scheduler-internal-helpers.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { MemoryEmbeddingService } from '../../../domains/memory/services/memory-embedding-service.js';

interface ActiveMemoryRow {
  id: string;
  content: string;
  type: string;
}

interface EmbeddingRow {
  memory_id: string;
  embedding_provider: string;
  projection_type: string;
  content_hash: string | null;
}

type EmbeddingWriter = Pick<MemoryEmbeddingService, 'createAndStoreEmbedding'>;

function findCandidates(
  memories: ActiveMemoryRow[],
  embeddings: EmbeddingRow[],
  targetProvider: string
): ActiveMemoryRow[] {
  const rowsByMemory = new Map<string, EmbeddingRow[]>();
  for (const row of embeddings) {
    const rows = rowsByMemory.get(row.memory_id) ?? [];
    rows.push(row);
    rowsByMemory.set(row.memory_id, rows);
  }

  return memories.filter(memory => {
    const contentHash = hashMemoryContent(memory.content);
    const rows = rowsByMemory.get(memory.id) ?? [];
    const hasCurrentTargetNative = rows.some(
      row => row.projection_type === 'native'
        && row.embedding_provider === targetProvider
        && row.content_hash === contentHash
    );
    return !hasCurrentTargetNative || rows.some(row => row.content_hash !== contentHash);
  });
}

function scanCandidates(
  db: Database.Database,
  candidateLimit: number,
  targetProvider: string
): { candidates: ActiveMemoryRow[]; total: number } {
  const candidates: ActiveMemoryRow[] = [];
  let total = 0;
  let lastId = '';
  const pageSize = 500;

  for (;;) {
    const memories = db.prepare(
      `SELECT id, content, type FROM memory_item
       WHERE COALESCE(is_deleted, 0) = 0 AND deleted_at IS NULL AND id > ?
       ORDER BY id LIMIT ?`
    ).all(lastId, pageSize) as ActiveMemoryRow[];
    if (memories.length === 0) break;
    lastId = memories[memories.length - 1]!.id;

    const placeholders = memories.map(() => '?').join(', ');
    const embeddings = db.prepare(
      `SELECT memory_id, embedding_provider, projection_type, content_hash FROM memory_embedding
       WHERE memory_id IN (${placeholders})`
    ).all(...memories.map(memory => memory.id)) as EmbeddingRow[];
    const pageCandidates = findCandidates(memories, embeddings, targetProvider);
    total += pageCandidates.length;
    if (candidates.length < candidateLimit) {
      candidates.push(...pageCandidates.slice(0, candidateLimit - candidates.length));
    }
  }

  return { candidates, total };
}

export class EmbeddingReconciliationBatchJob {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddingService: EmbeddingWriter,
    private readonly targetProvider: string
  ) {}

  async run(batchSize = 1000): Promise<BatchJobResult> {
    const result = createEmptyBatchJobResult('embedding_reconciliation');

    try {
      const { candidates, total: candidateCount } = scanCandidates(this.db, batchSize, this.targetProvider);
      for (const memory of candidates.slice(0, batchSize)) {
        try {
          const embedding = await this.embeddingService.createAndStoreEmbedding(
            this.db,
            memory.id,
            memory.content,
            memory.type as MemoryType
          );
          if (embedding) {
            result.processed++;
          } else {
            result.errors.push(`Embedding creation returned no result for ${memory.id}`);
          }
        } catch (error) {
          result.errors.push(
            `Embedding creation failed for ${memory.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      const remaining = scanCandidates(this.db, 0, this.targetProvider).total;
      result.success = result.errors.length === 0 && remaining === 0;
      result.details = { candidates: candidateCount, remaining };
      if (remaining > 0 && result.errors.length === 0) {
        result.warnings.push(`${remaining} memories remain for the next reconciliation cycle`);
      }
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      finalizeBatchJobTiming(result);
    }

    return result;
  }
}
