/**
 * Telemetry raw events retention cleanup (FR-012)
 */

import { randomUUID } from 'crypto';
import type { TelemetryRepository } from '../../../domains/telemetry/repositories/telemetry-repository.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import { resolveValidatedNumber } from '../../../shared/config/environment.js';
import { logger } from '../../../shared/utils/logger.js';

/** 사용 집계 보관 기간. 상수이고 설정 키는 없다 (#1768). */
export const USAGE_COUNT_RETENTION_DAYS = 365;

interface TelemetryCleanupBatchJobDeps {
  repository: TelemetryRepository;
}

export class TelemetryCleanupBatchJob {
  constructor(private readonly deps: TelemetryCleanupBatchJobDeps) {}

  /**
   * 사용 집계(#1768) 보관 정리. 기존 90일 텔레메트리 정리와 따로 try/catch 한다:
   * 집계 표가 없다고 해서(마이그레이션 전, 되돌린 뒤) 기존 정리가 실패로 기록되면 안 된다.
   */
  private cleanUsageCounts(result: BatchJobResult): void {
    try {
      const deleted = this.deps.repository.deleteExpiredUsageCounts(USAGE_COUNT_RETENTION_DAYS);
      result.details = { ...(result.details as object), usageCountsDeleted: deleted };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // 집계 정리 실패는 기존 정리를 실패로 만들지 않되, 작업 결과의 warnings 로 보이게 한다.
      result.warnings.push(`usage_daily_count cleanup failed: ${message}`);
      logger.warn('usage_daily_count cleanup failed', { error: message });
    }
  }

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
      // 이벤트 정리가 실패해도 사용 집계 보관 정리는 건너뛰지 않는다.
      this.cleanUsageCounts(result);
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
