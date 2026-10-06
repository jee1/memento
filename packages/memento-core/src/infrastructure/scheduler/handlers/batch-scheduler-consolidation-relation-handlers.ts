import { rotateLogs } from '../../logging/log-rotation.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

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
