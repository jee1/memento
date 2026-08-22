/**
 * Triple 추출 배치 작업
 *
 * 미처리 또는 실패한 Episodic Memory에 대해 Triple 추출을 수행하는 배치 작업입니다.
 */

import Database from 'better-sqlite3';
import { ensureMemoryItemTripleExtractionColumns } from '../../database/sqlite/ensure-memory-item-triple-extraction-columns.js';
import { TripleExtractionService } from '../../../domains/relation/services/triple-extraction/triple-extraction-service.js';
import { SemanticMemoryUpdateService } from '../../../domains/memory/semantic/semantic-memory-update-service.js';
import { logger } from '../../../shared/utils/logger.js';
import { createRelationGraph } from '../../relation-graph-factory.js';
import type {
  ResolvedTripleExtractionBatchJobConfig,
  TripleExtractionBatchJobConfig,
  TripleExtractionBatchResult
} from './triple-extraction-batch-job/triple-extraction-batch-job.types.js';
export type {
  TripleExtractionBatchJobConfig,
  TripleExtractionBatchResult
} from './triple-extraction-batch-job/triple-extraction-batch-job.types.js';
import { getTripleExtractionTargetMemories } from './triple-extraction-batch-job/triple-extraction-batch-job-retry.js';
import {
  processTripleExtractionChunk,
  splitTripleExtractionIntoChunks
} from './triple-extraction-batch-job/triple-extraction-batch-job-chunk.js';

/**
 * Triple 추출 배치 작업 클래스
 */
export class TripleExtractionBatchJob {
  private config: ResolvedTripleExtractionBatchJobConfig;
  private tripleExtractionService: TripleExtractionService;
  private semanticMemoryUpdateService: SemanticMemoryUpdateService | null = null;

  constructor(
    config?: TripleExtractionBatchJobConfig,
    dependencies?: {
      tripleExtractionService?: TripleExtractionService;
      semanticMemoryUpdateService?: SemanticMemoryUpdateService;
    }
  ) {
    this.config = {
      batchSize: config?.batchSize ?? 10,
      timeout: config?.timeout ?? 30000,
      maxRetries: config?.maxRetries ?? 3,
      retryBackoffDays: config?.retryBackoffDays ?? [1, 2, 4],
      chunkSize: config?.chunkSize ?? 5,
      chunkDelayMs: config?.chunkDelayMs ?? 100,
      parallelism: config?.parallelism ?? 1,
      ...config
    };

    this.tripleExtractionService = dependencies?.tripleExtractionService ?? new TripleExtractionService();
    this.semanticMemoryUpdateService = dependencies?.semanticMemoryUpdateService ?? null;
  }

  async execute(db: Database.Database): Promise<TripleExtractionBatchResult> {
    const startTime = new Date();
    const timeoutDeadline = startTime.getTime() + this.config.timeout;
    const result: TripleExtractionBatchResult = {
      jobType: 'triple_extraction_batch',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: [],
      details: {
        processed: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        semanticMemoriesCreated: 0,
        semanticMemoriesUpdated: 0,
        retryCounts: new Map()
      }
    };

    try {
      ensureMemoryItemTripleExtractionColumns(db);

      logger.info('Starting triple extraction batch job', {
        batchSize: this.config.batchSize,
        timeout: `${this.config.timeout}ms`,
        parallelism: 1,
        chunkSize: this.config.chunkSize,
        chunkDelayMs: this.config.chunkDelayMs,
        maxRetries: this.config.maxRetries,
        retryBackoffDays: this.config.retryBackoffDays
      });

      if (!this.semanticMemoryUpdateService) {
        this.semanticMemoryUpdateService = new SemanticMemoryUpdateService(db, createRelationGraph(db));
      }

      const targetMemories = await getTripleExtractionTargetMemories(db, this.config.batchSize, this.config);

      logger.info('Found target memories for triple extraction', {
        count: targetMemories.length,
        batchSize: this.config.batchSize,
        chunkSize: this.config.chunkSize,
        estimatedChunks: Math.ceil(targetMemories.length / this.config.chunkSize),
        estimatedDuration: targetMemories.length > 0
          ? `${Math.ceil((targetMemories.length * 3) / 60)} minutes (estimated)`
          : '0 minutes'
      });

      const chunks = splitTripleExtractionIntoChunks(targetMemories, this.config.chunkSize);

      logger.debug('Split memories into chunks for WAL-safe processing', {
        totalMemories: targetMemories.length,
        chunkCount: chunks.length,
        chunkSize: this.config.chunkSize
      });

      const chunkDeps = {
        config: this.config,
        tripleExtractionService: this.tripleExtractionService,
        semanticMemoryUpdateService: this.semanticMemoryUpdateService
      };

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const currentTime = Date.now();
        if (currentTime >= timeoutDeadline) {
          const elapsed = currentTime - startTime.getTime();
          result.warnings.push(`Batch job timeout after ${elapsed}ms (limit: ${this.config.timeout}ms)`);
          result.timeoutOccurred = true;
          logger.warn('Triple extraction batch job timeout', {
            elapsed,
            timeout: this.config.timeout,
            processed: result.details.processed,
            remainingChunks: chunks.length - chunkIndex
          });
          break;
        }

        const chunk = chunks[chunkIndex];
        if (!chunk) {
          continue;
        }

        try {
          const chunkResult = await processTripleExtractionChunk(
            chunkDeps,
            db,
            chunk,
            result,
            timeoutDeadline
          );

          result.details.processed += chunkResult.processed;
          result.details.success += chunkResult.success;
          result.details.failed += chunkResult.failed;
          result.details.skipped += chunkResult.skipped;
          result.details.semanticMemoriesCreated += chunkResult.semanticMemoriesCreated;
          result.details.semanticMemoriesUpdated += chunkResult.semanticMemoriesUpdated;

          for (const [memoryId, retryCount] of chunkResult.retryCounts) {
            result.details.retryCounts.set(memoryId, retryCount);
          }

          result.errors.push(...chunkResult.errors);

          logger.debug('Chunk processed', {
            chunkIndex: chunkIndex + 1,
            totalChunks: chunks.length,
            chunkSize: chunk?.length ?? 0,
            processed: chunkResult.processed,
            success: chunkResult.success,
            failed: chunkResult.failed,
            skipped: chunkResult.skipped,
            semanticMemoriesCreated: chunkResult.semanticMemoriesCreated,
            semanticMemoriesUpdated: chunkResult.semanticMemoriesUpdated,
            progress: `${((chunkIndex + 1) / chunks.length * 100).toFixed(1)}%`
          });

          if (chunkIndex < chunks.length - 1 && this.config.chunkDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.config.chunkDelayMs));
          }
        } catch (error) {
          const errorMessage = `Failed to process chunk ${chunkIndex + 1}/${chunks.length}: ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMessage);
          logger.error('Error processing chunk in batch job', {
            chunkIndex: chunkIndex + 1,
            totalChunks: chunks.length,
            error: error instanceof Error ? error.message : String(error)
          });

          result.details.failed += chunk?.length ?? 0;
          result.details.processed += chunk?.length ?? 0;
        }
      }

      result.success = result.details.processed > 0;
      result.processed = result.details.processed;

      const duration = result.endTime.getTime() - result.startTime.getTime();
      const durationSeconds = (duration / 1000).toFixed(2);
      const avgProcessingTime = result.details.processed > 0
        ? (duration / result.details.processed).toFixed(0)
        : '0';
      const successRate = result.details.processed > 0
        ? ((result.details.success / result.details.processed) * 100).toFixed(1)
        : '0.0';

      logger.info('Triple extraction batch job completed', {
        processed: result.details.processed,
        success: result.details.success,
        failed: result.details.failed,
        skipped: result.details.skipped,
        semanticMemoriesCreated: result.details.semanticMemoriesCreated,
        semanticMemoriesUpdated: result.details.semanticMemoriesUpdated,
        totalSemanticMemories: result.details.semanticMemoriesCreated + result.details.semanticMemoriesUpdated,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        errors: result.errors.length > 0 ? result.errors.slice(0, 5) : [],
        warnings: result.warnings.length > 0 ? result.warnings.slice(0, 5) : [],
        duration: `${durationSeconds}s`,
        durationMs: duration,
        avgProcessingTimeMs: avgProcessingTime,
        successRate: `${successRate}%`,
        retryCounts: result.details.retryCounts.size > 0
          ? Array.from(result.details.retryCounts.values()).reduce((sum, count) => sum + count, 0)
          : 0,
        uniqueRetriedMemories: result.details.retryCounts.size,
        totalChunks: chunks.length,
        chunkSize: this.config.chunkSize,
        jobStatus: result.success ? 'success' : 'partial_failure',
        timeoutOccurred: result.warnings.some(w => w.includes('timeout'))
      });

      logger.debug('Triple extraction batch job performance metrics', {
        throughput: result.details.processed > 0
          ? `${(result.details.processed / (duration / 1000)).toFixed(2)} memories/sec`
          : '0 memories/sec',
        semanticMemoryCreationRate: result.details.semanticMemoriesCreated > 0
          ? `${(result.details.semanticMemoriesCreated / (duration / 1000)).toFixed(2)} semantic memories/sec`
          : '0 semantic memories/sec',
        chunkProcessingStats: {
          totalChunks: chunks.length,
          avgChunkSize: chunks.length > 0
            ? (targetMemories.length / chunks.length).toFixed(1)
            : '0',
          chunkDelayMs: this.config.chunkDelayMs
        },
        retryDistribution: result.details.retryCounts.size > 0
          ? Array.from(result.details.retryCounts.values()).reduce((acc, count) => {
            acc[count] = (acc[count] || 0) + 1;
            return acc;
          }, {} as Record<number, number>)
          : {}
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMessage);

      const duration = result.endTime.getTime() - result.startTime.getTime();
      logger.error('Triple extraction batch job failed', {
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
        processed: result.details.processed,
        success: result.details.success,
        failed: result.details.failed,
        duration: `${(duration / 1000).toFixed(2)}s`,
        errors: result.errors,
        warnings: result.warnings
      });
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }
}
