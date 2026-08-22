import type { MemoryCleanupResult } from '../../../domains/forgetting/services/forgetting-policy-service.js';
import type { PerformanceAlert } from '../../../domains/monitoring/services/performance-monitor.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import {
  assertSchedulerDbOpen,
  createEmptyBatchJobResult,
  finalizeBatchJobTiming
} from '../batch-scheduler/batch-scheduler-internal-helpers.js';
import { collectBatchSchedulerDatabaseStats } from '../batch-scheduler/batch-scheduler-database-stats.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

function countMonitoringAlertBuckets(alerts: PerformanceAlert[]): {
  count: number;
  critical: number;
  warning: number;
} {
  return {
    count: alerts.length,
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning: alerts.filter(a => a.severity === 'warning').length
  };
}

export async function runMemoryCleanup(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const result = createEmptyBatchJobResult('memory_cleanup');

  try {
    assertSchedulerDbOpen(ctx.db);

    ctx.log('Starting memory cleanup job');

    const cleanupResult: MemoryCleanupResult = await ctx.forgettingService.executeMemoryCleanup(ctx.db);

    result.success = true;
    result.processed = cleanupResult.totalProcessed;
    result.details = cleanupResult;

    if (cleanupResult.softDeleted.length > 0) {
      result.warnings.push(`${cleanupResult.softDeleted.length} memories soft deleted`);
    }
    if (cleanupResult.hardDeleted.length > 0) {
      result.warnings.push(`${cleanupResult.hardDeleted.length} memories hard deleted`);
    }

    ctx.log('Memory cleanup completed', {
      processed: cleanupResult.totalProcessed,
      softDeleted: cleanupResult.softDeleted.length,
      hardDeleted: cleanupResult.hardDeleted.length,
      reviewed: cleanupResult.reviewed.length
    });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    ctx.log('Memory cleanup failed:', error, 'error');
  } finally {
    finalizeBatchJobTiming(result);
  }

  return result;
}

export async function runMonitoring(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const result = createEmptyBatchJobResult('monitoring');

  try {
    assertSchedulerDbOpen(ctx.db);

    const metrics = await ctx.performanceMonitor.collectMetrics({ tick: true });
    const stats = collectBatchSchedulerDatabaseStats(ctx.db, (msg, err) => ctx.log(msg, err, 'warn'));
    const alerts = ctx.performanceMonitor.getActiveAlerts();

    result.success = true;
    result.processed = 1;
    result.details = {
      metrics,
      stats,
      alerts: countMonitoringAlertBuckets(alerts)
    };

    if (alerts.length > 0) {
      result.warnings.push(`${alerts.length} active alerts`);
    }

    ctx.log('Monitoring completed', {
      metrics: {
        memoryUsage: `${((metrics.memory.heapUsed / metrics.memory.heapTotal) * 100).toFixed(1)}%`,
        dbSize: `${(metrics.database.size / (1024 * 1024)).toFixed(1)}MB`,
        queryTime: `${metrics.database.queryTime}ms`
      },
      alerts: alerts.length
    });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    ctx.log('Monitoring failed:', error, 'error');
  } finally {
    finalizeBatchJobTiming(result);
  }

  return result;
}

export async function runHealthCheck(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const startTime = new Date();
  const result: BatchJobResult = {
    jobType: 'healthcheck',
    startTime,
    endTime: new Date(),
    duration: 0,
    success: false,
    processed: 0,
    errors: [],
    warnings: []
  };

  try {
    const healthResult = await ctx.healthChecker.check(
      ctx.db,
      ctx.jobQueue.runningCount,
      ctx.jobQueue.size,
      ctx.config.maxConcurrentJobs
    );

    result.success = healthResult.isHealthy;
    result.processed = 1;
    result.warnings = healthResult.warnings;
    result.errors = healthResult.errors;
    result.details = {
      memoryUsage: healthResult.memoryUsage,
      runningJobs: healthResult.runningJobs,
      queueSize: healthResult.queueSize,
      uptime: healthResult.uptime
    };
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    ctx.log('Health check failed:', error, 'error');
  } finally {
    result.endTime = new Date();
    result.duration = result.endTime.getTime() - result.startTime.getTime();
  }

  return result;
}
