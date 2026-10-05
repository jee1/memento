import { rotateLogs } from '../../logging/log-rotation.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

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

    const isTimeout = Boolean(
      executorResult.error?.toLowerCase().includes('timeout')
    );

    if (executorResult.error) {
      result.errors.push(executorResult.error);
      if (isTimeout) {
        result.warnings.push(executorResult.error);
      }
    }

    if (executorResult.success) {
      ctx.log('Weekly relation validation completed successfully', {
        duration: result.duration,
        stdout: executorResult.stdout.substring(0, 500)
      });
    } else {
      ctx.log(
        isTimeout ? 'Weekly relation validation timeout' : 'Weekly relation validation failed',
        {
          error: executorResult.error,
          duration: result.duration,
          stderr: executorResult.stderr.substring(0, 500)
        },
        isTimeout ? 'warn' : 'error'
      );
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

export async function runLogRotation(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const startTime = new Date();
  const errors: string[] = [];
  const warnings: string[] = [];
  let deletedCount = 0;

  try {
    ctx.log('Starting log rotation...', { jobType: 'log_rotation' });

    const report = await rotateLogs();
    deletedCount = report.deletedCount;
    warnings.push(...report.warnings);

    const details = {
      migrationKeepCount: report.policies.migrationKeepCount,
      dockerDiagnosticsMaxBytes: report.policies.dockerDiagnosticsMaxBytes,
      families: report.families.map(f => ({
        family: f.family,
        deletedCount: f.deletedCount,
        reclaimedBytes: f.reclaimedBytes,
        ...(f.skippedMissingRoot ? { skippedMissingRoot: true } : {}),
      })),
      reclaimedBytes: report.reclaimedBytes,
    };

    ctx.log('Log rotation completed', {
      jobType: 'log_rotation',
      deletedFiles: deletedCount,
      reclaimedBytes: report.reclaimedBytes,
    });

    if (deletedCount > 0) {
      ctx.log(`Deleted ${deletedCount} old log file(s)`, {
        jobType: 'log_rotation',
        migrationKeepCount: report.policies.migrationKeepCount,
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
      warnings,
      details,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push('log_rotation orchestration failed');

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
