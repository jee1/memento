/* Merges BatchJobConfig defaults with env-backed resolve helpers. */

import { resolveBoolean, resolveValidatedNumber } from '../../../shared/config/environment.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { DAY_MS } from '../../../shared/utils/date.js';
import type { BatchJobConfig } from './batch-scheduler-types.js';

export function mergeBatchSchedulerJobConfig(overrides?: Partial<BatchJobConfig>): BatchJobConfig {
  return {
    cleanupInterval: resolveValidatedNumber(
      'FORGETTING_CLEANUP_INTERVAL_MS',
      DAY_MS,
      n => n >= 60_000,
      '최솟값 60000'
    ),
    monitoringInterval: resolveValidatedNumber('BATCH_MONITORING_INTERVAL_MS', 300_000, n => n >= 10_000, '최솟값 10000'),
    healthCheckInterval: resolveValidatedNumber('BATCH_HEALTH_CHECK_INTERVAL_MS', 300_000, n => n >= 10_000, '최솟값 10000'),
    walCheckpointInterval: mementoConfig.walCheckpointIntervalMs,
    lockMonitorInterval: mementoConfig.lockMonitorIntervalMs,
    reflexionCleanupInterval: 60 * 1000,
    reflexionHealthCheckInterval: 30 * 1000,
    consolidationScoreIncrementalInterval: 60 * 60 * 1000,  // 1시간
    consolidationScoreFullSweepInterval: DAY_MS, // 24시간
    consolidationScoreFullSweepHour: 3,  // 새벽 3시
    relationValidationInterval: 7 * DAY_MS, // 7일
    relationValidationDayOfWeek: 0,     // 일요일
    relationValidationHour: 2,          // 새벽 2시
    logRotationInterval: DAY_MS, // 24시간 (매일)
    tripleExtractionInterval: 60 * 60 * 1000, // 1시간
    tripleExtractionHour: undefined,   // 시간 지정 안 함 (간격 기반 실행)
    tripleExtractionBatchSize: 10,     // 배치 크기 10개
    tripleExtractionTimeout: 30 * 1000, // 30초
    qualityMeasurementInterval: DAY_MS, // 24시간 (일일)
    qualityMeasurementHour: undefined, // 시간 지정 안 함 (간격 기반 실행)
    metaMemoryIntrospectionInterval: 6 * 60 * 60 * 1000, // 6시간, Issue 21
    sleepConsolidationInterval: resolveValidatedNumber(
      'SLEEP_CONSOLIDATION_INTERVAL_MS',
      60 * 60 * 1000,
      n => n >= 60_000,
      '최솟값 60000'
    ),
    telemetryCleanupInterval: resolveValidatedNumber(
      'TELEMETRY_CLEANUP_INTERVAL_MS',
      DAY_MS,
      n => n >= 60_000,
      '최솟값 60000'
    ),
    forgettingEventCleanupInterval: resolveValidatedNumber(
      'FORGETTING_EVENT_CLEANUP_INTERVAL_MS',
      DAY_MS,
      n => n >= 60_000,
      '최솟값 60000'
    ),
    jobRunCleanupInterval: resolveValidatedNumber(
      'JOB_RUN_CLEANUP_INTERVAL_MS',
      DAY_MS,
      n => n >= 60_000,
      '최솟값 60000'
    ),
    memoryReviewCandidatesInterval: resolveValidatedNumber(
      'MEMORY_REVIEW_CANDIDATES_INTERVAL_MS',
      DAY_MS,
      n => n >= 60_000,
      '최솟값 60000'
    ),
    memoryReviewCandidatesSchedulerEnabled: resolveBoolean('MEMORY_REVIEW_CANDIDATES_SCHEDULER_ENABLED', {
      defaultValue: true
    }),
    anchorAutoRefreshInterval: resolveValidatedNumber(
      'ANCHOR_AUTO_REFRESH_INTERVAL_MS',
      6 * 60 * 60 * 1000,
      n => n >= 60_000,
      '최솟값 60000'
    ),
    anchorAutoRefreshEnabled: resolveBoolean('ANCHOR_AUTO_REFRESH_ENABLED', {
      defaultValue: true
    }),
    maxBatchSize: 1000,
    enableLogging: true,
    enableNotifications: false,
    enableMetrics: true,
    maxConcurrentJobs: 3,
    jobTimeout: 5 * 60 * 1000,          // 5분
    retryAttempts: 3,
    retryDelay: 1000,                   // 1초
    weeklyRelationValidationTimeout: resolveValidatedNumber(
      'WEEKLY_RELATION_VALIDATION_TIMEOUT_MS',
      30 * 60 * 1000,
      n => n >= 60_000,
      '최솟값 60000'
    ),
    tripleExtractionJobTimeout: resolveValidatedNumber(
      'TRIPLE_EXTRACTION_JOB_TIMEOUT_MS',
      30 * 60 * 1000,
      n => n >= 60_000,
      '최솟값 60000'
    ),
    ...overrides
  };
}
