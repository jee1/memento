import type Database from 'better-sqlite3';
import type { MemoryType } from '../../../shared/types/memory.types.js';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import { hashMemoryContent } from '../../../shared/utils/memory-content-hash.js';
import { getEmbeddingModelFilter } from '../../../shared/config/embedding-models.js';
import { createEmptyBatchJobResult, finalizeBatchJobTiming } from '../batch-scheduler/batch-scheduler-internal-helpers.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { MemoryEmbeddingService } from '../../../domains/embedding/services/memory-embedding-service.js';

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
  model: string | null;
}

/** 잡 제한 시간(5분) 안에 끝나도록 새 후보를 그만 잡는 시점. 제한 시간 초과는 작업을 멈추지 않고 재시도와 겹친다 (#1729). */
const RECONCILIATION_TIME_BUDGET_MS = 4 * 60_000;
/** 연속 실패가 이만큼이면 실행을 멈춘다. 실패한 기억은 다음 실행이 다시 본다 (#1729). */
export const RECONCILIATION_CONSECUTIVE_FAILURE_LIMIT = 20;

export interface EmbeddingReconciliationDetails {
  candidates: number;
  remaining: number;
  /** 시간 예산이 다 되어 후보를 남기고 멈췄다. */
  budgetExhausted: boolean;
  failureLimitReached: boolean;
}

export interface EmbeddingReconciliationRunOptions {
  timeBudgetMs?: number;
  now?: () => number;
}

type EmbeddingWriter = Pick<MemoryEmbeddingService, 'createAndStoreEmbedding'>;

function findCandidates(
  memories: ActiveMemoryRow[],
  embeddings: EmbeddingRow[],
  targetProvider: string
): ActiveMemoryRow[] {
  // 로컬 임베딩 모델이 바뀌면 같은 제공자의 native 나 창 행이 옛 모델로 남는다. 그 기억도 다시 만든다 (#1729).
  const currentModel = getEmbeddingModelFilter(targetProvider);
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
        && (currentModel === null || row.model === currentModel)
    );
    const hasModelDrift = currentModel !== null && rows.some(
      row => row.embedding_provider === targetProvider && row.model !== currentModel
    );
    return !hasCurrentTargetNative || hasModelDrift || rows.some(row => row.content_hash !== contentHash);
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
      `SELECT memory_id, embedding_provider, projection_type, content_hash, model FROM memory_embedding
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

/** Sleep consolidation 을 건너뛰는 모델 드리프트 비율(활성 기억 대비). 이주 중 옛 벡터로 군집을 만들지 않는다 (#1729). */
export const MODEL_DRIFT_CONSOLIDATION_LIMIT = 0.01;

/**
 * native 나 창 행의 모델이 지금 모델과 다른 활성 기억 수. 임베딩이 아예 없는 기억은 세지 않는다.
 * 모델을 고정하지 않는 제공자(openai, gemini, tfidf)는 0 이다.
 */
export function countModelDrift(
  db: Database.Database,
  targetProvider: string
): { drifted: number; active: number } {
  const currentModel = getEmbeddingModelFilter(targetProvider);
  const active = (db.prepare(
    `SELECT COUNT(*) AS n FROM memory_item WHERE COALESCE(is_deleted, 0) = 0 AND deleted_at IS NULL`
  ).get() as { n: number }).n;
  if (currentModel === null) return { drifted: 0, active };
  const drifted = (db.prepare(
    `SELECT COUNT(DISTINCT me.memory_id) AS n
     FROM memory_embedding me JOIN memory_item mi ON mi.id = me.memory_id
     WHERE COALESCE(mi.is_deleted, 0) = 0 AND mi.deleted_at IS NULL
       AND me.embedding_provider = ? AND COALESCE(me.model, '') <> ?`
  ).get(targetProvider, currentModel) as { n: number }).n;
  return { drifted, active };
}

export class EmbeddingReconciliationBatchJob {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddingService: EmbeddingWriter,
    private readonly targetProvider: EmbeddingProvider
  ) {}

  async run(batchSize = 1000, options: EmbeddingReconciliationRunOptions = {}): Promise<BatchJobResult> {
    const result = createEmptyBatchJobResult('embedding_reconciliation');
    const now = options.now ?? Date.now;
    const deadline = now() + (options.timeBudgetMs ?? RECONCILIATION_TIME_BUDGET_MS);
    let budgetExhausted = false;
    let failureLimitReached = false;
    let consecutiveFailures = 0;

    try {
      const { candidates, total: candidateCount } = scanCandidates(this.db, batchSize, this.targetProvider);
      for (const memory of candidates.slice(0, batchSize)) {
        if (now() >= deadline) {
          budgetExhausted = true;
          break;
        }
        const errorsBefore = result.errors.length;
        try {
          const embedding = await this.embeddingService.createAndStoreEmbedding(
            this.db,
            memory.id,
            memory.content,
            memory.type as MemoryType,
            this.targetProvider
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
        consecutiveFailures = result.errors.length > errorsBefore ? consecutiveFailures + 1 : 0;
        if (consecutiveFailures >= RECONCILIATION_CONSECUTIVE_FAILURE_LIMIT) {
          failureLimitReached = true;
          result.errors.push(`Stopped after ${consecutiveFailures} consecutive embedding failures`);
          break;
        }
      }

      const remaining = scanCandidates(this.db, 0, this.targetProvider).total;
      result.success = result.errors.length === 0 && remaining === 0;
      const details: EmbeddingReconciliationDetails = {
        candidates: candidateCount,
        remaining,
        budgetExhausted,
        failureLimitReached,
      };
      result.details = details;
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
