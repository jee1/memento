/**
 * Narrow context passed into batch scheduler handler modules (issue #224).
 * Handlers must not import `batch-scheduler.ts` to avoid circular references.
 */

import type Database from 'better-sqlite3';
import type { BatchJobConfig, BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { ForgettingPolicyService } from '../../../domains/forgetting/services/forgetting-policy-service.js';
import type { JobQueue } from '../job-queue.js';
import type { HealthChecker } from '../health-checker.js';
import type { FileLogger } from '../file-logger.js';
import type { RelationValidatorExecutor } from '../relation-validator-executor.js';
import type { ConsolidationScoreWorker } from '../../../workers/consolidation-score-worker.js';
import type { IntrospectionScanCache } from '../../../domains/memory/introspection/introspection-scan-cache.js';
import type { TripleExtractionBatchJob } from '../jobs/triple-extraction-batch-job.js';
import type { QualityMeasurementBatchJob } from '../jobs/quality-measurement-batch-job.js';
import type { SleepConsolidationBatchJob } from '../jobs/sleep-consolidation-batch-job.js';
import type { TelemetryCleanupBatchJob } from '../jobs/telemetry-cleanup-batch-job.js';
import type { ForgettingEventCleanupBatchJob } from '../jobs/forgetting-event-cleanup-batch-job.js';
import type { SleepConsolidationService } from '../../../domains/consolidation/services/sleep-consolidation-service.js';
import type { TelemetryRepository } from '../../../domains/telemetry/repositories/telemetry-repository.js';
import type { PerformanceMonitor } from '../../../domains/monitoring/services/performance-monitor.js';
import type { AnchorManager } from '../../../domains/anchor/services/anchor/anchor-manager.js';

/** Matches `BatchScheduler.log` (third arg defaults to info). */
export type BatchSchedulerLogMethod = (
  message: string,
  data?: unknown,
  level?: 'info' | 'warn' | 'error'
) => void;

export interface MutableJobRef<T> {
  get current(): T | null;
  set current(value: T | null);
}

export interface BatchSchedulerRunContext {
  readonly db: Database.Database | null;
  readonly config: BatchJobConfig;
  readonly forgettingService: ForgettingPolicyService;
  readonly performanceMonitor: PerformanceMonitor;
  readonly healthChecker: HealthChecker;
  readonly jobQueue: JobQueue;
  readonly fileLogger: FileLogger;
  readonly relationValidatorExecutor: RelationValidatorExecutor;
  readonly consolidationScoreWorker: ConsolidationScoreWorker | null;
  readonly introspectionScanCache: IntrospectionScanCache | null;
  readonly sleepConsolidationService: SleepConsolidationService | null;
  readonly telemetryCleanupRepository: TelemetryRepository | null;
  readonly tripleExtractionBatchJob: MutableJobRef<TripleExtractionBatchJob>;
  readonly qualityMeasurementBatchJob: MutableJobRef<QualityMeasurementBatchJob>;
  readonly sleepConsolidationBatchJob: MutableJobRef<SleepConsolidationBatchJob>;
  readonly telemetryCleanupBatchJob: MutableJobRef<TelemetryCleanupBatchJob>;
  readonly forgettingEventCleanupBatchJob: MutableJobRef<ForgettingEventCleanupBatchJob>;
  readonly lastExecution: Map<string, Date>;
  readonly totalExecutions: Map<string, number>;
  readonly anchorManager: AnchorManager | null;
  log: BatchSchedulerLogMethod;
  emitMemoryReviewCandidatesRunRecord: (result: BatchJobResult) => Promise<void>;
}
