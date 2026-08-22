/**
 * Telemetry raw events retention cleanup (FR-012)
 */

import { randomUUID } from 'crypto';
import type { TelemetryRepository } from '../../../domains/telemetry/repositories/telemetry-repository.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import { resolveValidatedNumber } from '../../../shared/config/environment.js';
import { logger } from '../../../shared/utils/logger.js';

export interface TelemetryCleanupBatchJobDeps {
  repository: TelemetryRepository;
}

export class TelemetryCleanupBatchJob {
  constructor(private readonly deps: TelemetryCleanupBatchJobDeps) {}

  async execute(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'telemetry_cleanup_batch',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: [],
      details: undefined
    };

    try {
      const retentionDays = resolveValidatedNumber(
        'TELEMETRY_RETENTION_DAYS',
        90,
        n => n >= 1,
        '최솟값 1'
      );
      const deleted = this.deps.repository.deleteExpiredEvents(retentionDays);
      result.success = true;
      result.processed = deleted;
      result.details = { retentionDays, deleted };
      logger.info('telemetry_cleanup_batch completed', { retentionDays, deleted });
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
      logger.warn('telemetry_cleanup_batch failed', {
        error: e instanceof Error ? e.message : String(e)
      });
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
      try {
        this.deps.repository.insertEventSync({
          eventType: 'telemetry.cleanup.performed',
          requestId: randomUUID(),
          ownerId: null,
          latencyMs: result.duration,
          outcome: result.success ? 'success' : 'failure',
          extraData: {
            deleted: result.processed,
            retention_days:
              typeof result.details === 'object' &&
              result.details !== null &&
              'retentionDays' in result.details
                ? (result.details as { retentionDays: number }).retentionDays
                : undefined,
            error_count: result.errors.length
          }
        });
      } catch (e) {
        logger.warn('telemetry.cleanup.performed insert failed', {
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }

    return result;
  }
}
