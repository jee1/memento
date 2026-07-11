import { logger } from '../../shared/utils/logger.js';
import type { AsyncTaskQueue } from '../async-optimizer.js';

export interface ReflexionWorkerHealthDeps {
  getStatus: () => { isRunning: boolean; restartCount: number };
  incrementRestartCount: () => void;
  setIsRunning: (running: boolean) => void;
  getEventQueue: () => AsyncTaskQueue;
  checkQueueBacklog: () => void;
  getLastHealthCheck: () => number;
  setLastHealthCheck: (timestamp: number) => void;
  getHealthCheckInterval: () => ReturnType<typeof setInterval> | null;
  setHealthCheckInterval: (interval: ReturnType<typeof setInterval> | null) => void;
  maxRestartAttempts: number;
}

/**
 * 헬스체크 시작
 */
export function startHealthCheck(deps: ReflexionWorkerHealthDeps): void {
  // 30초마다 헬스체크
  deps.setHealthCheckInterval(setInterval(() => {
    performHealthCheck(deps);
  }, 30 * 1000));
}

/**
 * 헬스체크 수행
 */
export function performHealthCheck(deps: ReflexionWorkerHealthDeps): void {
  try {
    const now = Date.now();

    // 큐 적체 확인
    deps.checkQueueBacklog();

    // Worker 상태 확인
    const status = deps.getStatus();
    const eventQueue = deps.getEventQueue();
    if (!eventQueue.isRunning() && status.isRunning) {
      logger.warn('ReflexionWorker 큐가 중지됨, 재시작 시도', {
        queue_running: eventQueue.isRunning(),
        worker_running: status.isRunning
      });
      void attemptRestart(deps);
    }

    deps.setLastHealthCheck(now);
  } catch (error) {
    logger.error('헬스체크 실패', {
      error: error instanceof Error ? error.message : String(error)
    });
    // 헬스체크 실패 시 재시작 시도
    void attemptRestart(deps);
  }
}

/**
 * Worker 재시작 시도
 */
export async function attemptRestart(deps: ReflexionWorkerHealthDeps): Promise<void> {
  const status = deps.getStatus();
  if (status.restartCount >= deps.maxRestartAttempts) {
    logger.error('ReflexionWorker 최대 재시작 횟수 초과', {
      restart_count: status.restartCount,
      max_attempts: deps.maxRestartAttempts
    });
    deps.setIsRunning(false);
    return;
  }

  deps.incrementRestartCount();
  const restartCount = deps.getStatus().restartCount;
  logger.warn('ReflexionWorker 재시작 시도', {
    attempt: restartCount,
    max_attempts: deps.maxRestartAttempts
  });

  try {
    const eventQueue = deps.getEventQueue();
    // 현재 상태 정리
    await eventQueue.stop();

    // 재시작
    await eventQueue.start();

    logger.info('ReflexionWorker 재시작 성공', {
      restart_count: restartCount
    });
  } catch (error) {
    logger.error('ReflexionWorker 재시작 실패', {
      error: error instanceof Error ? error.message : String(error),
      restart_count: restartCount
    });

    // 재시작 실패 시 일정 시간 후 재시도
    setTimeout(() => {
      void attemptRestart(deps);
    }, 5000); // 5초 후 재시도
  }
}
