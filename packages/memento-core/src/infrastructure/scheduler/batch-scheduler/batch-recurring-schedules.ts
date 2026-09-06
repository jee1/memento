import type { BatchJobConfig, BatchJobResult } from './batch-scheduler-types.js';
import type { BatchJobExecutionCoordinator } from './batch-job-execution-coordinator.js';

export interface BatchRecurringScheduleContext {
  readonly config: BatchJobConfig;
  readonly consolidationScoreEnabled: boolean;
  readonly hasConsolidationScoreWorker: boolean;
  readonly hasSleepConsolidation: boolean;
  readonly hasTelemetryCleanup: boolean;
  readonly hasForgettingEventCleanup: boolean;
  readonly hasJobRunCleanup: boolean;
  readonly hasAnchorManager: boolean;
  scheduleJob: (name: string, interval: number, job: () => Promise<void>, priority: number) => void;
  readonly lastExecution: Map<string, Date>;
  readonly intervals: Map<string, ReturnType<typeof setInterval>>;
  readonly jobExecutionCoordinator: BatchJobExecutionCoordinator;
  log: (message: string, data?: unknown, level?: 'info' | 'warn' | 'error') => void;
  runMemoryCleanup: () => Promise<BatchJobResult>;
  runMonitoring: () => Promise<BatchJobResult>;
  runHealthCheck: () => Promise<BatchJobResult>;
  runConsolidationScoreIncremental: () => Promise<BatchJobResult>;
  runConsolidationScoreFullSweep: () => Promise<BatchJobResult>;
  runWeeklyRelationValidation: () => Promise<BatchJobResult>;
  runLogRotation: () => Promise<BatchJobResult>;
  runTripleExtractionBatch: () => Promise<BatchJobResult>;
  runQualityMeasurementBatch: () => Promise<BatchJobResult>;
  runMetaMemoryIntrospection: () => Promise<BatchJobResult>;
  runMemoryReviewCandidatesJob: () => Promise<BatchJobResult>;
  runSleepConsolidationBatch: () => Promise<BatchJobResult>;
  runTelemetryCleanupBatch: () => Promise<void>;
  runForgettingEventCleanupBatch: () => Promise<void>;
  runJobRunCleanupBatch: () => Promise<void>;
  runAnchorAutoRefresh: () => Promise<BatchJobResult>;
}

export function scheduleCleanupJob(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob('cleanup', ctx.config.cleanupInterval, async () => { await ctx.runMemoryCleanup(); }, 1);
}

export function scheduleMonitoringJob(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob('monitoring', ctx.config.monitoringInterval, async () => { await ctx.runMonitoring(); }, 2);
}

export function scheduleHealthcheckJob(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob('healthcheck', ctx.config.healthCheckInterval, async () => { await ctx.runHealthCheck(); }, 3);
}

export function scheduleCoreMaintenanceJobs(ctx: BatchRecurringScheduleContext): void {
  scheduleCleanupJob(ctx);
  scheduleMonitoringJob(ctx);
  scheduleHealthcheckJob(ctx);
}

export function scheduleConsolidationScoreFullSweep(ctx: BatchRecurringScheduleContext): void {
  const checkAndRun = () => {
    const now = new Date();
    const currentHour = now.getHours();
    if (currentHour === ctx.config.consolidationScoreFullSweepHour) {
      const lastExecution = ctx.lastExecution.get('consolidation_score_full_sweep');
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (!lastExecution || lastExecution < today) {
        ctx.jobExecutionCoordinator.addJobToQueue(
          'consolidation_score_full_sweep',
          async () => { await ctx.runConsolidationScoreFullSweep(); },
          4,
          0
        );
      }
    }
  };
  const checkInterval = 60 * 60 * 1000;
  const intervalId = setInterval(checkAndRun, checkInterval);
  ctx.intervals.set('consolidation_score_full_sweep', intervalId);
  checkAndRun();
}

export function scheduleWeeklyRelationValidation(ctx: BatchRecurringScheduleContext): void {
  const checkAndRun = () => {
    const now = new Date();
    const currentDayOfWeek = now.getDay();
    const currentHour = now.getHours();
    if (
      currentDayOfWeek === ctx.config.relationValidationDayOfWeek &&
      currentHour === ctx.config.relationValidationHour
    ) {
      const lastExecution = ctx.lastExecution.get('weekly_relation_validation');
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (!lastExecution || lastExecution < today) {
        ctx.jobExecutionCoordinator.addJobToQueue(
          'weekly_relation_validation',
          async () => { await ctx.runWeeklyRelationValidation(); },
          5,
          0
        );
      }
    }
  };
  const checkInterval = 60 * 60 * 1000;
  const intervalId = setInterval(checkAndRun, checkInterval);
  ctx.intervals.set('weekly_relation_validation', intervalId);
  checkAndRun();
}

export function scheduleConsolidationRelationAndLogJobs(ctx: BatchRecurringScheduleContext): void {
  if (ctx.consolidationScoreEnabled && ctx.hasConsolidationScoreWorker) {
    ctx.scheduleJob(
      'consolidation_score_incremental',
      ctx.config.consolidationScoreIncrementalInterval,
      async () => { await ctx.runConsolidationScoreIncremental(); },
      4
    );
    scheduleConsolidationScoreFullSweep(ctx);
  }
  scheduleWeeklyRelationValidation(ctx);
  ctx.scheduleJob(
    'log_rotation',
    ctx.config.logRotationInterval,
    async () => { await ctx.runLogRotation(); },
    5
  );
}

export function scheduleTripleExtractionBatch(ctx: BatchRecurringScheduleContext): void {
  if (ctx.config.tripleExtractionHour !== undefined) {
    const checkAndRun = () => {
      const now = new Date();
      const currentHour = now.getHours();
      if (currentHour === ctx.config.tripleExtractionHour) {
        const lastExecution = ctx.lastExecution.get('triple_extraction_batch');
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (!lastExecution || lastExecution < today) {
          ctx.jobExecutionCoordinator.addJobToQueue(
            'triple_extraction_batch',
            async () => { await ctx.runTripleExtractionBatch(); },
            6,
            0
          );
        }
      }
    };
    const checkInterval = 60 * 60 * 1000;
    const intervalId = setInterval(checkAndRun, checkInterval);
    ctx.intervals.set('triple_extraction_batch', intervalId);
    checkAndRun();
  } else {
    ctx.scheduleJob(
      'triple_extraction_batch',
      ctx.config.tripleExtractionInterval,
      async () => { await ctx.runTripleExtractionBatch(); },
      6
    );
  }
}

export function scheduleQualityMeasurement(ctx: BatchRecurringScheduleContext): void {
  if (ctx.config.qualityMeasurementHour !== undefined) {
    const checkAndRun = () => {
      const now = new Date();
      const currentHour = now.getHours();
      if (currentHour === ctx.config.qualityMeasurementHour) {
        const lastExecution = ctx.lastExecution.get('quality_measurement_batch');
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (!lastExecution || lastExecution < today) {
          ctx.jobExecutionCoordinator.addJobToQueue(
            'quality_measurement_batch',
            async () => { await ctx.runQualityMeasurementBatch(); },
            7,
            0
          );
        }
      }
    };
    const checkInterval = 60 * 60 * 1000;
    const intervalId = setInterval(checkAndRun, checkInterval);
    ctx.intervals.set('quality_measurement_batch', intervalId);
    checkAndRun();
  } else {
    ctx.scheduleJob(
      'quality_measurement_batch',
      ctx.config.qualityMeasurementInterval,
      async () => { await ctx.runQualityMeasurementBatch(); },
      7
    );
  }
}

export function scheduleAugmentationAndTelemetryJobs(ctx: BatchRecurringScheduleContext): void {
  scheduleTripleExtractionBatch(ctx);
  scheduleQualityMeasurement(ctx);
  if (ctx.hasSleepConsolidation) {
    scheduleSleepConsolidation(ctx);
  }
  if (ctx.hasTelemetryCleanup) {
    scheduleTelemetryCleanup(ctx);
  }
  if (ctx.hasForgettingEventCleanup) {
    scheduleForgettingEventCleanup(ctx);
  }
  if (ctx.hasJobRunCleanup) {
    scheduleJobRunCleanup(ctx);
  }
}

export function scheduleMemoryReviewCandidatesInterval(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob(
    'memory_review_candidates',
    ctx.config.memoryReviewCandidatesInterval,
    async () => {
      const r = await ctx.runMemoryReviewCandidatesJob();
      if (!r.success) {
        throw new Error(r.errors.join('; ') || 'memory_review_candidates batch failed');
      }
    },
    8
  );
}

export function scheduleMetaMemoryAndReviewJobs(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob(
    'meta_memory_introspection',
    ctx.config.metaMemoryIntrospectionInterval,
    async () => { await ctx.runMetaMemoryIntrospection(); },
    6
  );
  if (ctx.config.memoryReviewCandidatesSchedulerEnabled) {
    scheduleMemoryReviewCandidatesInterval(ctx);
  } else {
    ctx.log('memory_review_candidates periodic schedule disabled (MEMORY_REVIEW_CANDIDATES_SCHEDULER_ENABLED=false)', {
      level: 'info'
    });
  }
}

export function scheduleSleepConsolidation(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob(
    'sleep_consolidation_batch',
    ctx.config.sleepConsolidationInterval,
    async () => {
      await ctx.runSleepConsolidationBatch();
    },
    8
  );
}

export function scheduleTelemetryCleanup(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob(
    'telemetry_cleanup_batch',
    ctx.config.telemetryCleanupInterval,
    async () => {
      await ctx.runTelemetryCleanupBatch();
    },
    9
  );
}

export function scheduleForgettingEventCleanup(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob(
    'forgetting_event_cleanup_batch',
    ctx.config.forgettingEventCleanupInterval,
    async () => {
      await ctx.runForgettingEventCleanupBatch();
    },
    9
  );
}

export function scheduleJobRunCleanup(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob(
    'job_run_cleanup_batch',
    ctx.config.jobRunCleanupInterval,
    async () => {
      await ctx.runJobRunCleanupBatch();
    },
    9
  );
}

export function scheduleAnchorAutoRefresh(ctx: BatchRecurringScheduleContext): void {
  ctx.scheduleJob(
    'anchor_auto_refresh',
    ctx.config.anchorAutoRefreshInterval,
    async () => { await ctx.runAnchorAutoRefresh(); },
    9
  );
}

export function registerAllRecurringJobs(ctx: BatchRecurringScheduleContext): void {
  scheduleCoreMaintenanceJobs(ctx);
  scheduleConsolidationRelationAndLogJobs(ctx);
  scheduleAugmentationAndTelemetryJobs(ctx);
  scheduleMetaMemoryAndReviewJobs(ctx);
  if (ctx.config.anchorAutoRefreshEnabled && ctx.hasAnchorManager) {
    scheduleAnchorAutoRefresh(ctx);
  } else {
    ctx.log('anchor_auto_refresh schedule disabled (ANCHOR_AUTO_REFRESH_ENABLED=false or anchorManager not available)', {
      level: 'info'
    });
  }
}
