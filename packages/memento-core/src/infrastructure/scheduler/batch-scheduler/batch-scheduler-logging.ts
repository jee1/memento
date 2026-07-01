import { mcpLogger } from '../../../server/mcp-logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { logger } from '../../../shared/utils/logger.js';
import type { FileLogger } from '../file-logger.js';
import type { JobQueue } from '../job-queue.js';

export interface BatchSchedulerLoggingDeps {
  enableLogging: boolean;
  startTime: Date | null;
  jobQueue: JobQueue;
  fileLogger: FileLogger;
}

/**
 * 배치 스케줄러 로깅
 * data 객체에 level 속성이 있으면 이를 우선적으로 사용하여 호출부의 편의성을 높임
 */
export function logBatchSchedulerMessage(
  deps: BatchSchedulerLoggingDeps,
  message: string,
  data?: unknown,
  level: 'info' | 'warn' | 'error' = 'info'
): void {
  if (!deps.enableLogging) return;

  let safeData: Record<string, unknown>;
  let actualLevel: 'info' | 'warn' | 'error' = level;

  if (data instanceof Error) {
    safeData = {
      message: data.message,
      name: data.name,
      stack: data.stack
    };
  } else if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    safeData = { ...data };

    if ('level' in safeData && typeof safeData.level === 'string') {
      const dataLevel = safeData.level.toLowerCase();
      if (dataLevel === 'debug' || dataLevel === 'info' || dataLevel === 'warn' || dataLevel === 'error') {
        actualLevel = dataLevel === 'debug' ? 'info' : dataLevel as 'info' | 'warn' | 'error';
      }
      delete safeData.level;
    }
  } else {
    safeData = {};
  }

  const batchContext = {
    ...safeData,
    uptime: deps.startTime ? Date.now() - deps.startTime.getTime() : 0,
    activeJobs: deps.jobQueue.runningCount,
    queueSize: deps.jobQueue.size
  };

  mcpLogger.logBatch(actualLevel, message, batchContext);

  if (actualLevel === 'warn') {
    deps.fileLogger.logWarn(
      message,
      batchContext,
      {
        uptime: batchContext.uptime,
        activeJobs: batchContext.activeJobs,
        queueSize: batchContext.queueSize
      }
    ).catch((error) => {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('File logging failed', { error: maskedError.message, errorName: maskedError.name });
    });
  } else if (actualLevel === 'error') {
    deps.fileLogger.logError(
      message,
      batchContext,
      {
        uptime: batchContext.uptime,
        activeJobs: batchContext.activeJobs,
        queueSize: batchContext.queueSize
      }
    ).catch((error) => {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('File logging failed', { error: maskedError.message, errorName: maskedError.name });
    });
  }
}
