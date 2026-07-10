import type { FailureDetector } from '../../domains/monitoring/services/failure-detector.js';
import type { AsyncTaskQueue } from '../async-optimizer.js';
import type { IWorkerStatus } from '../../shared/interfaces/reflexion-worker.interface.js';

export interface ReflexionWorkerMetricsDeps {
  getStatus: () => IWorkerStatus;
  eventQueue: AsyncTaskQueue;
  failureDetector: FailureDetector;
}

/**
 * Reflexion 기록 메트릭 수집
 */
export function getReflexionMetrics(deps: ReflexionWorkerMetricsDeps): {
  processedCount: number;
  failedCount: number;
  successRate: number; // 기록 성공률
  averageProcessingTime: number; // 평균 처리 시간 (밀리초)
  queueSize: number;
  activeWorkers: number;
  restartCount: number;
} {
  const status = deps.getStatus();
  const queueStats = deps.eventQueue.getStats();
  const total = status.processedCount + status.failedCount;
  const successRate = total > 0 ? status.processedCount / total : 0.0;

  return {
    processedCount: status.processedCount,
    failedCount: status.failedCount,
    successRate,
    averageProcessingTime: queueStats.averageProcessingTime,
    queueSize: status.queueSize,
    activeWorkers: status.activeWorkers,
    restartCount: status.restartCount
  };
}

/**
 * 통합 메트릭 수집 (FailureDetector + ReflexionWorker)
 */
export function getIntegratedMetrics(deps: ReflexionWorkerMetricsDeps): {
  detection: {
    totalDetections: number;
    toolErrorCount: number;
    userFeedbackCount: number;
    metricFailureCount: number;
    detectionRate: number;
  };
  reflexion: {
    processedCount: number;
    failedCount: number;
    successRate: number;
    averageProcessingTime: number;
    queueSize: number;
    activeWorkers: number;
    restartCount: number;
  };
  overall: {
    recall: number; // 재현율 (감지된 실패 / 실제 실패)
    precision: number; // 정밀도 (올바르게 감지된 실패 / 감지된 실패)
    reflexionSuccessRate: number; // Reflexion 기록 성공률
  };
} {
  const detectionMetrics = deps.failureDetector.getDetectionMetrics();
  const reflexionMetrics = getReflexionMetrics(deps);

  // 전체 메트릭 계산
  const recall = detectionMetrics.detectionRate; // 재현율 (간단히 감지율로 근사)
  const precision = 1.0; // 정밀도 (모든 감지가 올바르다고 가정, 실제로는 검증 필요)
  const reflexionSuccessRate = reflexionMetrics.successRate;

  return {
    detection: detectionMetrics,
    reflexion: reflexionMetrics,
    overall: {
      recall,
      precision,
      reflexionSuccessRate
    }
  };
}
