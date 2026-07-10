import { logger } from '../../shared/utils/logger.js';
import type { FailureEvent } from '../../domains/monitoring/services/failure-detector.js';
import type { AsyncTaskQueue } from '../async-optimizer.js';
import type { ReflexionReflectionRecorder } from '../reflexion-reflection-recorder.js';

export interface ReflexionWorkerEventQueueStatus {
  processedCount: number;
  failedCount: number;
}

export interface ReflexionWorkerEventQueueDeps {
  eventQueue: AsyncTaskQueue;
  reflectionRecorder: ReflexionReflectionRecorder;
  status: ReflexionWorkerEventQueueStatus;
  maxRetries: number;
  retryDelays: number[];
  queueWarningThreshold: number;
  processFailureEvent: (event: FailureEvent) => Promise<void>;
}

/**
 * auto_reflect 내부 함수
 * 실패 정보를 바탕으로 Reflexion 데이터 생성 및 저장
 */
async function autoReflect(
  deps: ReflexionWorkerEventQueueDeps,
  event: FailureEvent
): Promise<void> {
  try {
    const recorded = await deps.reflectionRecorder.record(event);
    if (recorded) {
      deps.status.processedCount++;
    }
  } catch (error) {
    deps.status.failedCount++;
    logger.error('auto_reflect 실행 실패', {
      error: error instanceof Error ? error.message : String(error),
      event_id: event.id
    });
    throw error;
  }
}

/**
 * 실패 이벤트를 큐에 추가 (큐 크기 제한 포함)
 * FailureDetector의 queueFailureEvent를 대체하는 메서드
 * AsyncTaskQueue가 자동으로 큐 크기 제한을 처리함
 */
export async function queueFailureEvent(
  deps: ReflexionWorkerEventQueueDeps,
  event: FailureEvent
): Promise<boolean> {
  try {
    // 큐에 추가 (processFailureEvent를 핸들러로 사용)
    // AsyncTaskQueue의 addTask에서 자동으로 큐 크기 제한 처리
    const taskId = deps.eventQueue.addTask({
      id: event.id,
      type: 'failure_event',
      data: {
        event,
        handler: (evt: FailureEvent) => deps.processFailureEvent(evt)
      },
      priority: event.priority,
      maxRetries: deps.maxRetries,
      timeout: 30000 // 30초 타임아웃
    });

    if (taskId === false) {
      logger.warn('실패 이벤트 큐 추가 실패 (중복 또는 큐 가득참)', {
        event_id: event.id,
        tool: event.tool_name
      });
      return false;
    }

    // 큐 적체 경고 확인
    checkQueueBacklog(deps);

    logger.debug('실패 이벤트 큐에 추가됨', {
      event_id: event.id,
      tool: event.tool_name,
      priority: event.priority,
      queue_size: deps.eventQueue.getStats().pending
    });

    return true;
  } catch (error) {
    logger.error('실패 이벤트 큐 추가 중 오류 발생', {
      error: error instanceof Error ? error.message : String(error),
      event_id: event.id
    });
    return false;
  }
}

/**
 * 실패 이벤트 처리 (재시도 및 백오프 포함)
 */
export async function processFailureEvent(
  deps: ReflexionWorkerEventQueueDeps,
  event: FailureEvent
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < deps.maxRetries; attempt++) {
    try {
      await autoReflect(deps, event);
      return; // 성공
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < deps.maxRetries - 1) {
        const delay = deps.retryDelays[attempt] || deps.retryDelays[deps.retryDelays.length - 1];
        logger.warn('Reflexion 기록 실패, 재시도 예정', {
          attempt: attempt + 1,
          max_retries: deps.maxRetries,
          delay_ms: delay,
          event_id: event.id
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // 모든 재시도 실패
  logger.error('Reflexion 기록 최종 실패', {
    event_id: event.id,
    error: lastError?.message,
    retry_count: deps.maxRetries
  });
  throw lastError || new Error('Reflexion 기록 실패');
}

/**
 * 큐 적체 경고 확인
 */
export function checkQueueBacklog(deps: ReflexionWorkerEventQueueDeps): void {
  const queueStats = deps.eventQueue.getStats();
  if (queueStats.pending > deps.queueWarningThreshold) {
    logger.warn('ReflexionWorker 큐 적체 경고', {
      queue_size: queueStats.pending,
      threshold: deps.queueWarningThreshold
    });
  }
}
