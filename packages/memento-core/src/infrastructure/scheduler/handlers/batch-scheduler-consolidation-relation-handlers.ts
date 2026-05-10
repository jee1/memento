import { tripleExtractionLogger } from '../../logging/triple-extraction-logger.js';
import type { BatchJobResult } from '../batch-scheduler-types.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

export async function runConsolidationScoreIncremental(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const startTime = new Date();
  const result: BatchJobResult = {
    jobType: 'consolidation_score_incremental',
    startTime,
    endTime: new Date(),
    duration: 0,
    success: false,
    processed: 0,
    errors: [],
    warnings: []
  };

  try {
    if (!ctx.db) {
      throw new Error('Database not initialized');
    }

    if (!ctx.consolidationScoreWorker) {
      throw new Error('ConsolidationScoreWorker not initialized');
    }

    ctx.log('Starting consolidation score incremental recalculation');

    const recalculationResult = await ctx.consolidationScoreWorker.runIncrementalRecalculation(ctx.db);

    result.success = recalculationResult.success;
    result.processed = recalculationResult.processed;
    result.details = recalculationResult;

    if (recalculationResult.errors.length > 0) {
      result.errors.push(...recalculationResult.errors);
    }
    if (recalculationResult.warnings.length > 0) {
      result.warnings.push(...recalculationResult.warnings);
    }

    ctx.log('Consolidation score incremental recalculation completed', {
      processed: recalculationResult.processed,
      updated: recalculationResult.updated,
      skipped: recalculationResult.skipped,
      errors: recalculationResult.errors.length
    });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    ctx.log('Consolidation score incremental recalculation failed:', error, 'error');
  } finally {
    result.endTime = new Date();
    result.duration = result.endTime.getTime() - result.startTime.getTime();
  }

  return result;
}

export async function runWeeklyRelationValidation(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const startTime = new Date();
  const result: BatchJobResult = {
    jobType: 'weekly_relation_validation',
    startTime,
    endTime: new Date(),
    duration: 0,
    success: false,
    processed: 0,
    errors: [],
    warnings: []
  };

  try {
    ctx.log('Starting weekly relation validation...');

    const timeout = ctx.config.weeklyRelationValidationTimeout ?? ctx.config.jobTimeout;
    const executorResult = await ctx.relationValidatorExecutor.execute([], timeout);

    result.success = executorResult.success;
    result.endTime = new Date();
    result.duration = executorResult.duration;
    result.processed = 1;

    if (executorResult.error) {
      result.errors.push(executorResult.error);
    }

    if (executorResult.success) {
      ctx.log('Weekly relation validation completed successfully', {
        duration: result.duration,
        stdout: executorResult.stdout.substring(0, 500)
      });
    } else {
      ctx.log('Weekly relation validation failed', {
        error: executorResult.error,
        duration: result.duration,
        stderr: executorResult.stderr.substring(0, 500)
      }, 'error');
    }
  } catch (error) {
    result.endTime = new Date();
    result.duration = result.endTime.getTime() - startTime.getTime();
    result.errors.push(error instanceof Error ? error.message : String(error));

    ctx.log('Weekly relation validation failed', {
      error: error instanceof Error ? error.message : String(error),
      duration: result.duration
    }, 'error');
  }

  return result;
}

export async function runConsolidationScoreFullSweep(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const startTime = new Date();
  const result: BatchJobResult = {
    jobType: 'consolidation_score_full_sweep',
    startTime,
    endTime: new Date(),
    duration: 0,
    success: false,
    processed: 0,
    errors: [],
    warnings: []
  };

  try {
    if (!ctx.db) {
      throw new Error('Database not initialized');
    }

    if (!ctx.consolidationScoreWorker) {
      throw new Error('ConsolidationScoreWorker not initialized');
    }

    ctx.log('Starting consolidation score full sweep recalculation');

    const recalculationResult = await ctx.consolidationScoreWorker.runFullSweep(ctx.db);

    result.success = recalculationResult.success;
    result.processed = recalculationResult.processed;
    result.details = recalculationResult;

    if (recalculationResult.errors.length > 0) {
      result.errors.push(...recalculationResult.errors);
    }
    if (recalculationResult.warnings.length > 0) {
      result.warnings.push(...recalculationResult.warnings);
    }

    ctx.log('Consolidation score full sweep recalculation completed', {
      processed: recalculationResult.processed,
      updated: recalculationResult.updated,
      skipped: recalculationResult.skipped,
      errors: recalculationResult.errors.length,
      duration: recalculationResult.duration
    });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    ctx.log('Consolidation score full sweep recalculation failed:', error, 'error');
  } finally {
    result.endTime = new Date();
    result.duration = result.endTime.getTime() - result.startTime.getTime();
  }

  return result;
}

export async function runLogRotation(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const startTime = new Date();
  const errors: string[] = [];
  const warnings: string[] = [];
  let deletedCount = 0;

  try {
    ctx.log('Starting log rotation...', { jobType: 'log_rotation' });

    deletedCount = await tripleExtractionLogger.deleteOldLogs(30);

    ctx.log('Log rotation completed', {
      jobType: 'log_rotation',
      deletedFiles: deletedCount
    });

    if (deletedCount > 0) {
      ctx.log(`Deleted ${deletedCount} old log file(s)`, {
        jobType: 'log_rotation',
        retentionDays: 30
      });
    }

    const endTime = new Date();
    return {
      jobType: 'log_rotation',
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      success: true,
      processed: deletedCount,
      errors,
      warnings
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(errorMessage);

    ctx.log('Log rotation failed', {
      jobType: 'log_rotation',
      error: errorMessage
    }, 'error');

    const endTime = new Date();
    return {
      jobType: 'log_rotation',
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      success: false,
      processed: deletedCount,
      errors,
      warnings
    };
  }
}
