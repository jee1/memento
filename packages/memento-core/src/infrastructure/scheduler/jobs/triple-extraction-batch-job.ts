/**
 * Triple 추출 배치 작업
 *
 * 미처리 또는 실패한 Episodic Memory에 대해 Triple 추출을 수행하는 배치 작업입니다.
 *
 * #805 T017: execute()는 매 호출마다 독립적인 policy/clock/candidate snapshot/result
 * accumulator/DB-bound semantic service를 사용한다 (겹쳐 실행되는 execute 간 공유 없음).
 * source 단위 상태 전이(성공/실패/재시도/abandon)는 공유 conversion coordinator
 * (`convertEpisodicSource`, #805 T013)에 위임하고, 이 클래스는 policy 해석·candidate 조회·
 * timeout/fatal 경계·result 집계만 담당한다.
 */

import Database from 'better-sqlite3';
import { ensureMemoryItemTripleExtractionColumns } from '../../database/sqlite/ensure-memory-item-triple-extraction-columns.js';
import { TripleExtractionService } from '../../../domains/relation/services/triple-extraction/triple-extraction-service.js';
import { SemanticMemoryUpdateService } from '../../../domains/memory/semantic/semantic-memory-update-service.js';
import { convertEpisodicSource } from '../../../domains/memory/semantic/episodic-semantic-conversion.js';
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
import { getErrorCode } from './triple-extraction-batch-job/triple-extraction-batch-job.types.js';
import {
  resolveTripleExtractionBatchPolicy,
  selectTripleExtractionCandidates
} from './triple-extraction-batch-job/triple-extraction-batch-job-retry.js';
import { splitTripleExtractionIntoChunks } from './triple-extraction-batch-job/triple-extraction-batch-job-chunk.js';

function createEmptyResult(startTime: Date): TripleExtractionBatchResult {
  return {
    jobType: 'triple_extraction_batch',
    startTime,
    endTime: new Date(startTime.getTime()),
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
      retryCounts: new Map<string, number>()
    }
  };
}

function reconcileResult(result: TripleExtractionBatchResult, fatal: boolean): void {
  result.details.processed = result.details.success + result.details.failed + result.details.skipped;
  result.processed = result.details.processed;
  result.endTime = new Date();
  result.duration = result.endTime.getTime() - result.startTime.getTime();
  if (fatal) {
    result.success = false;
  }
}

/**
 * Triple 추출 배치 작업 클래스
 */
export class TripleExtractionBatchJob {
  private readonly rawConfig: TripleExtractionBatchJobConfig | undefined;
  private readonly tripleExtractionService: Pick<TripleExtractionService, 'extractTriples'>;
  private readonly injectedSemanticMemoryUpdateService: SemanticMemoryUpdateService | undefined;

  constructor(
    config?: TripleExtractionBatchJobConfig,
    dependencies?: {
      tripleExtractionService?: TripleExtractionService;
      semanticMemoryUpdateService?: SemanticMemoryUpdateService;
    }
  ) {
    this.rawConfig = config;
    this.tripleExtractionService = dependencies?.tripleExtractionService ?? new TripleExtractionService();
    this.injectedSemanticMemoryUpdateService = dependencies?.semanticMemoryUpdateService;
  }

  async execute(db: Database.Database): Promise<TripleExtractionBatchResult> {
    const startTime = new Date();
    const result = createEmptyResult(startTime);

    let policy: ResolvedTripleExtractionBatchJobConfig;
    try {
      policy = resolveTripleExtractionBatchPolicy(this.rawConfig);
    } catch (error) {
      result.errors.push(
        `Invalid triple extraction batch policy: ${error instanceof Error ? error.message : String(error)}`
      );
      reconcileResult(result, true);
      return result;
    }

    const timeoutDeadline = startTime.getTime() + policy.timeout;
    let fatal = false;

    try {
      ensureMemoryItemTripleExtractionColumns(db);

      const semanticMemoryUpdateService =
        this.injectedSemanticMemoryUpdateService ?? new SemanticMemoryUpdateService(db, createRelationGraph(db));

      logger.info('Starting triple extraction batch job', {
        batchSize: policy.batchSize,
        timeout: `${policy.timeout}ms`,
        parallelism: policy.parallelism,
        chunkSize: policy.chunkSize,
        chunkDelayMs: policy.chunkDelayMs,
        maxRetries: policy.maxRetries,
        retryBackoffDays: policy.retryBackoffDays
      });

      const candidates = selectTripleExtractionCandidates(db, policy, startTime);
      const chunks = splitTripleExtractionIntoChunks(candidates, policy.chunkSize);

      logger.info('Found target memories for triple extraction', {
        count: candidates.length,
        batchSize: policy.batchSize,
        chunkSize: policy.chunkSize,
        totalChunks: chunks.length
      });

      chunkLoop:
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        if (!chunk) {
          continue;
        }

        for (const source of chunk) {
          if (Date.now() >= timeoutDeadline) {
            result.timeoutOccurred = true;
            result.warnings.push(
              `Batch job timeout after ${Date.now() - startTime.getTime()}ms (limit: ${policy.timeout}ms)`
            );
            logger.warn('Triple extraction batch job timeout before starting source', {
              processed: result.details.processed
            });
            break chunkLoop;
          }

          try {
            const outcome = await convertEpisodicSource(
              { db, tripleExtractionService: this.tripleExtractionService, semanticMemoryUpdateService },
              {
                sourceId: source.id,
                skipConverted: true,
                maxRetries: policy.maxRetries,
                retryBackoffDays: policy.retryBackoffDays,
                now: () => new Date()
              }
            );

            if (outcome.kind === 'success') {
              result.details.success++;
              result.details.semanticMemoriesCreated += outcome.update.created;
              result.details.semanticMemoriesUpdated += outcome.update.updated;
            } else if (outcome.kind === 'failed') {
              result.details.failed++;
              if (outcome.retryCount !== undefined) {
                result.details.retryCounts.set(source.id, outcome.retryCount);
              }
            } else {
              result.details.skipped++;
            }
          } catch (error) {
            // source-isolatable failure: never synthesize an outcome, continue to the next source.
            logger.warn('Triple extraction source-isolated failure; continuing batch', {
              memory_id: source.id,
              error: error instanceof Error ? error.message : String(error),
              error_code: getErrorCode(error)
            });
          }
        }

        if (chunkIndex < chunks.length - 1 && policy.chunkDelayMs > 0) {
          const remainingBudget = timeoutDeadline - Date.now();
          if (remainingBudget <= 0) {
            result.timeoutOccurred = true;
            result.warnings.push(
              `Batch job timeout before inter-chunk delay (limit: ${policy.timeout}ms)`
            );
            logger.warn('Triple extraction batch job timeout before inter-chunk delay', {
              processed: result.details.processed
            });
            break;
          }

          const cappedDelay = Math.min(policy.chunkDelayMs, remainingBudget);
          await new Promise(resolve => setTimeout(resolve, cappedDelay));
        }
      }

      result.success = result.details.success + result.details.failed + result.details.skipped > 0;
    } catch (error) {
      fatal = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Triple extraction batch job failed: ${errorMessage}`);
      logger.error('Triple extraction batch job failed', {
        error: errorMessage,
        processed: result.details.processed
      });
    } finally {
      reconcileResult(result, fatal);
    }

    return result;
  }
}
