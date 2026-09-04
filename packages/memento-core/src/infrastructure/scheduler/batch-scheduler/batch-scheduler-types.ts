/**
 * BatchScheduler 공개 설정·결과 타입 (순환 의존 방지용 분리).
 */

export interface BatchJobConfig {
  cleanupInterval: number;
  monitoringInterval: number;
  healthCheckInterval: number;
  walCheckpointInterval: number;
  lockMonitorInterval: number;
  reflexionCleanupInterval: number;
  reflexionHealthCheckInterval: number;
  consolidationScoreIncrementalInterval: number;
  consolidationScoreFullSweepInterval: number;
  consolidationScoreFullSweepHour: number;
  relationValidationInterval: number;
  relationValidationDayOfWeek: number;
  relationValidationHour: number;
  logRotationInterval: number;
  tripleExtractionInterval: number;
  tripleExtractionHour?: number;
  tripleExtractionBatchSize: number;
  tripleExtractionTimeout: number;
  qualityMeasurementInterval: number;
  qualityMeasurementHour?: number;
  metaMemoryIntrospectionInterval: number;
  sleepConsolidationInterval: number;
  telemetryCleanupInterval: number;
  /** Issue #810: memory_forgetting_event audit log retention */
  forgettingEventCleanupInterval: number;
  /** Issue #243: refresh memory_review_candidate pending rows from selection */
  memoryReviewCandidatesInterval: number;
  /**
   * When false, do not register the periodic `memory_review_candidates` interval (GitHub #299).
   * Manual/HTTP `runJob('memory_review_candidates')` and `/admin/batch/run` still work.
   */
  memoryReviewCandidatesSchedulerEnabled: boolean;
  /** Interval (ms) for the periodic anchor auto-refresh batch job. */
  anchorAutoRefreshInterval: number;
  /** When false, skip registering the anchor auto-refresh periodic schedule. */
  anchorAutoRefreshEnabled: boolean;

  maxBatchSize: number;
  enableLogging: boolean;
  enableNotifications: boolean;
  enableMetrics: boolean;

  maxConcurrentJobs: number;
  jobTimeout: number;
  retryAttempts: number;
  retryDelay: number;
  weeklyRelationValidationTimeout?: number;
  /** Per-memory remember() triple extraction queue jobs (Issue #475) */
  tripleExtractionJobTimeout?: number;
}

export interface BatchJobResult {
  jobType: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  success: boolean;
  processed: number;
  errors: string[];
  warnings: string[];
  /** 작업별 메타데이터(구조는 jobType마다 다름; 소비 시 좁힘) */
  details?: unknown;
  retryCount?: number;
}

export interface SchedulerStatus {
  isRunning: boolean;
  activeJobs: string[];
  lastExecution: Map<string, Date>;
  totalExecutions: Map<string, number>;
  errorCount: Map<string, number>;
  uptime: number;
  config: BatchJobConfig;
}
