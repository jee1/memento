import { mementoConfig } from '../../../shared/config/index.js';
import { MemoryEmbeddingService } from '../../../domains/memory/services/memory-embedding-service.js';
import { EmbeddingReconciliationBatchJob } from '../jobs/embedding-reconciliation-batch-job.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

const embeddingService = new MemoryEmbeddingService();

function resolveTargetProvider(): string {
  const provider = mementoConfig.embeddingProvider.toLowerCase();
  return provider === 'lightweight' ? 'tfidf' : provider;
}

export async function runEmbeddingReconciliation(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  if (!ctx.db) {
    const now = new Date();
    return {
      jobType: 'embedding_reconciliation',
      startTime: now,
      endTime: now,
      duration: 0,
      success: false,
      processed: 0,
      errors: ['Database is not available'],
      warnings: [],
    };
  }

  return new EmbeddingReconciliationBatchJob(ctx.db, embeddingService, resolveTargetProvider()).run(ctx.config.maxBatchSize);
}
