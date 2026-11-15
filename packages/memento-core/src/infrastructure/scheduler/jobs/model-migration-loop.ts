import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { EmbeddingReconciliationDetails } from './embedding-reconciliation-batch-job.js';

export type ModelMigrationStop = 'done' | 'no_progress' | 'failure_limit' | 'stopped' | 'run_failed';

export interface ModelMigrationSummary {
  runs: number;
  processed: number;
  remaining: number | null;
  stoppedBy: ModelMigrationStop;
}

/**
 * 모델 이주 반복 (#1729). embedding_reconciliation 실행(1,000건, 실행당 시간 예산)을 주기 대기 없이 잇달아 돌려
 * 후보가 0 이 되면 멈춘다. 연속 실패 상한에 닿거나 한 실행이 아무것도 처리하지 못하면 멈추고, 남은 기억은 정기 실행이 본다.
 */
export async function runModelMigrationLoop(deps: {
  runOnce: () => Promise<BatchJobResult>;
  shouldContinue: () => boolean;
}): Promise<ModelMigrationSummary> {
  let runs = 0;
  let processed = 0;
  let remaining: number | null = null;

  for (;;) {
    if (!deps.shouldContinue()) return { runs, processed, remaining, stoppedBy: 'stopped' };
    const result = await deps.runOnce();
    runs++;
    processed += result.processed;
    const details = result.details as Partial<EmbeddingReconciliationDetails> | undefined;
    if (typeof details?.remaining !== 'number') return { runs, processed, remaining, stoppedBy: 'run_failed' };
    remaining = details.remaining;
    if (remaining === 0) return { runs, processed, remaining, stoppedBy: 'done' };
    if (details.failureLimitReached) return { runs, processed, remaining, stoppedBy: 'failure_limit' };
    if (result.processed === 0) return { runs, processed, remaining, stoppedBy: 'no_progress' };
  }
}
