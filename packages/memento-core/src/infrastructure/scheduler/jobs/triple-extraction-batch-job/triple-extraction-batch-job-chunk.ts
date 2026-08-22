import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import type { TripleExtractionService } from '../../../../domains/relation/services/triple-extraction/triple-extraction-service.js';
import type { SemanticMemoryUpdateService } from '../../../../domains/memory/semantic/semantic-memory-update-service.js';
import { logger } from '../../../../shared/utils/logger.js';
import type {
  ResolvedTripleExtractionBatchJobConfig,
  TripleExtractionBatchResult,
  TripleExtractionChunkResult,
  TripleExtractionTargetMemory
} from './triple-extraction-batch-job.types.js';
import { getErrorCode } from './triple-extraction-batch-job.types.js';
import {
  getTripleExtractionRetryCount,
  shouldRetryTripleExtraction
} from './triple-extraction-batch-job-retry.js';
import {
  calculateTripleExtractionAverageConfidence,
  updateTripleExtractionMemoryStatus
} from './triple-extraction-batch-job-memory-status.js';

/**
 * 메모리 배열을 청크로 분할
 */
export function splitTripleExtractionIntoChunks<T>(memories: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < memories.length; i += chunkSize) {
    chunks.push(memories.slice(i, i + chunkSize));
  }
  return chunks;
}

export interface ProcessTripleExtractionChunkDeps {
  config: ResolvedTripleExtractionBatchJobConfig;
  tripleExtractionService: TripleExtractionService;
  semanticMemoryUpdateService: SemanticMemoryUpdateService;
}

/**
 * 청크 단위 처리
 */
export async function processTripleExtractionChunk(
  deps: ProcessTripleExtractionChunkDeps,
  db: Database.Database,
  chunk: TripleExtractionTargetMemory[],
  overallResult: TripleExtractionBatchResult,
  timeoutDeadline: number
): Promise<TripleExtractionChunkResult> {
  const chunkResult: TripleExtractionChunkResult = {
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    semanticMemoriesCreated: 0,
    semanticMemoriesUpdated: 0,
    retryCounts: new Map<string, number>(),
    errors: []
  };

  for (const memory of chunk) {
    if (Date.now() >= timeoutDeadline) {
      overallResult.timeoutOccurred = true;
      logger.warn('Chunk processing timeout, stopping chunk processing', {
        chunkSize: chunk.length,
        processedInChunk: chunkResult.processed
      });
      break;
    }

    try {
      const shouldRetry = shouldRetryTripleExtraction(memory, deps.config);
      if (!shouldRetry) {
        chunkResult.skipped++;
        logger.debug('Skipping memory due to retry policy', {
          memory_id: memory.id,
          retry_count: getTripleExtractionRetryCount(memory)
        });
        continue;
      }

      const extractionResult = await deps.tripleExtractionService.extractTriples(memory.content);

      if (extractionResult.triples.length > 0) {
        await DatabaseUtils.runTransaction(db, async () => {
          const updateResult = await deps.semanticMemoryUpdateService.updateSemanticMemory(
            extractionResult,
            {
              episodicMemoryId: memory.id,
              episodicImportance: memory.importance ?? 0.5
            }
          );

          const confidenceAvg = await calculateTripleExtractionAverageConfidence(db, memory.id);

          const successMetadata: Record<string, unknown> = {
            triple_count: extractionResult.triples.length,
            extracted_at: new Date().toISOString()
          };

          if (confidenceAvg !== null) {
            successMetadata.confidence_avg = confidenceAvg;
          }

          await updateTripleExtractionMemoryStatus(
            db,
            memory.id,
            'success',
            successMetadata
          );

          chunkResult.success++;
          chunkResult.semanticMemoriesCreated += updateResult.created;
          chunkResult.semanticMemoriesUpdated += updateResult.updated;
        });
      } else {
        const failureReason = extractionResult.extractionInfo.failureReason || 'no_triple';
        const currentRetryCount = getTripleExtractionRetryCount(memory);
        const newRetryCount = currentRetryCount + 1;

        await DatabaseUtils.runTransaction(db, async () => {
          if (newRetryCount >= deps.config.maxRetries) {
            await updateTripleExtractionMemoryStatus(
              db,
              memory.id,
              'abandoned',
              {
                failureReason,
                retry_count: newRetryCount,
                last_attempt: new Date().toISOString(),
                abandoned_at: new Date().toISOString()
              }
            );

            logger.info('Triple extraction abandoned after max retries', {
              memory_id: memory.id,
              retry_count: newRetryCount,
              max_retries: deps.config.maxRetries,
              failure_reason: failureReason
            });
          } else {
            const backoffDays = deps.config.retryBackoffDays[newRetryCount - 1] ||
              deps.config.retryBackoffDays[deps.config.retryBackoffDays.length - 1];

            await updateTripleExtractionMemoryStatus(
              db,
              memory.id,
              'failed',
              {
                failureReason,
                retry_count: newRetryCount,
                last_attempt: new Date().toISOString(),
                next_retry_after_days: backoffDays
              }
            );

            logger.debug('Triple extraction failed, will retry after backoff', {
              memory_id: memory.id,
              retry_count: newRetryCount,
              backoff_days: backoffDays,
              failure_reason: failureReason
            });
          }
        });

        chunkResult.failed++;
        chunkResult.retryCounts.set(memory.id, newRetryCount);
      }

      chunkResult.processed++;
    } catch (error) {
      const errorMessage = `Failed to process memory ${memory.id}: ${error instanceof Error ? error.message : String(error)}`;
      chunkResult.errors.push(errorMessage);
      chunkResult.failed++;
      chunkResult.processed++;

      logger.error('Error processing episodic memory in batch job', {
        memory_id: memory.id,
        error: error instanceof Error ? error.message : String(error),
        error_code: getErrorCode(error)
      });
    }
  }

  return chunkResult;
}
