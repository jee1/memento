import { QualityMeasurementBatchJob } from '../jobs/quality-measurement-batch-job.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

export async function runQualityMeasurementBatch(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const startTime = new Date();
  const result: BatchJobResult = {
    jobType: 'quality_measurement_batch',
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

    if (!ctx.qualityMeasurementBatchJob.current) {
      ctx.qualityMeasurementBatchJob.current = new QualityMeasurementBatchJob({
        measurementType: 'batch',
        context: 'default',
        record: true,
        generateReport: true,
        reportFormat: 'markdown',
        timeout: ctx.config.jobTimeout
      });
    }

    const batchResult = await ctx.qualityMeasurementBatchJob.current.execute(ctx.db);

    result.endTime = new Date();
    result.duration = result.endTime.getTime() - startTime.getTime();
    result.success = batchResult.success;
    result.processed = batchResult.processed;
    result.errors = batchResult.errors;
    result.warnings = batchResult.warnings;
    result.details = batchResult.details;

    ctx.lastExecution.set('quality_measurement_batch', new Date());
    ctx.totalExecutions.set(
      'quality_measurement_batch',
      (ctx.totalExecutions.get('quality_measurement_batch') || 0) + 1
    );

    if (batchResult.success) {
      ctx.log('Quality measurement batch job completed', {
        duration: result.duration,
        processed: result.processed,
        overallStatus: batchResult.details.overallStatus,
        totalMetrics: batchResult.details.totalMetrics,
        passedMetrics: batchResult.details.passedMetrics,
        failedMetrics: batchResult.details.failedMetrics,
        warningMetrics: batchResult.details.warningMetrics
      });
    } else {
      ctx.log('Quality measurement batch job failed', {
        duration: result.duration,
        errors: result.errors
      }, 'error');
    }

    return result;
  } catch (error) {
    result.endTime = new Date();
    result.duration = result.endTime.getTime() - startTime.getTime();
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));

    ctx.log('Quality measurement batch job error', {
      duration: result.duration,
      error: error instanceof Error ? error.message : String(error)
    }, 'error');

    return result;
  }
}
