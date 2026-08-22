/**
 * Reflexion Worker 서비스
 * 실패 이벤트를 처리하여 reflection_notes를 자동 생성하고 저장
 */

import type { IReflexionWorker, IWorkerStatus } from '../shared/interfaces/reflexion-worker.interface.js';
import { logger } from '../shared/utils/logger.js';
import { FailureDetector, type FailureEvent } from '../domains/monitoring/services/failure-detector.js';
import { AsyncTaskQueue } from './async-optimizer.js';
import Database from 'better-sqlite3';
import { ReflexionProceduralMemoryService } from './reflexion-procedural-memory-service.js';
import { ReflexionReflectionRecorder } from './reflexion-reflection-recorder.js';
import type { ExtractedProceduralMemory } from '../domains/memory/procedural/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../domains/memory/procedural/procedural-memory-extractor.types.js';
import {
  attemptRestart,
  performHealthCheck as performHealthCheckModule,
  type ReflexionWorkerHealthDeps
} from './reflexion-worker/reflexion-worker-health.js';
import {
  checkQueueBacklog as checkQueueBacklogModule,
  processFailureEvent as processFailureEventModule,
  queueFailureEvent as queueFailureEventModule,
  type ReflexionWorkerEventQueueDeps
} from './reflexion-worker/reflexion-worker-event-queue.js';
import {
  registerHandler as registerHandlerModule,
  updateProceduralMemory as updateProceduralMemoryModule,
  type ReflexionWorkerFailureHandlerDeps
} from './reflexion-worker/reflexion-worker-failure-handler.js';
import {
  getIntegratedMetrics as getIntegratedMetricsModule,
  getReflexionMetrics as getReflexionMetricsModule,
  type ReflexionWorkerMetricsDeps
} from './reflexion-worker/reflexion-worker-metrics.js';

/**
 * Worker 상태 (내부 구현용, IWorkerStatus와 호환)
 */
interface WorkerStatus extends IWorkerStatus {}

/**
 * ReflexionWorker 서비스 클래스
 */
export class ReflexionWorker implements IReflexionWorker {
  private failureDetector: FailureDetector;
  private db: Database.Database;
  private eventQueue: AsyncTaskQueue;
  private duplicateWindow: Map<string, number> = new Map(); // 이벤트 키 -> 타임스탬프
  private readonly WINDOW_SIZE_MS = 5 * 60 * 1000; // 5분
  private readonly MAX_CONCURRENT = 5; // 최대 동시 실행 수
  private readonly MAX_QUEUE_SIZE = 100; // 최대 큐 크기
  private readonly MAX_RETRIES = 3; // 최대 재시도 횟수
  private readonly RETRY_DELAYS = [1000, 2000, 4000]; // 지수 백오프: 1초, 2초, 4초
  private readonly QUEUE_WARNING_THRESHOLD = 50; // 큐 적체 경고 임계값
  private readonly MAX_RESTART_ATTEMPTS = 3; // 최대 재시작 횟수
  private readonly proceduralMemoryService: ReflexionProceduralMemoryService;
  private readonly reflectionRecorder: ReflexionReflectionRecorder;
  private status: WorkerStatus = {
    isRunning: false,
    activeWorkers: 0,
    queueSize: 0,
    processedCount: 0,
    failedCount: 0,
    restartCount: 0
  };
  private lastHealthCheck: number = Date.now();

  constructor(
    failureDetector: FailureDetector,
    db: Database.Database,
    eventQueue?: AsyncTaskQueue
  ) {
    this.failureDetector = failureDetector;
    this.db = db;
    // 큐 크기 제한 포함하여 생성
    this.eventQueue = eventQueue || new AsyncTaskQueue(this.MAX_CONCURRENT, this.MAX_QUEUE_SIZE);
    this.proceduralMemoryService = new ReflexionProceduralMemoryService(db);
    this.reflectionRecorder = new ReflexionReflectionRecorder(
      db,
      this.proceduralMemoryService,
      this.WINDOW_SIZE_MS
    );
  }

  private getHealthDeps(): ReflexionWorkerHealthDeps {
    return {
      getStatus: () => this.status,
      incrementRestartCount: () => {
        this.status.restartCount++;
      },
      setIsRunning: (running: boolean) => {
        this.status.isRunning = running;
      },
      getEventQueue: () => this.eventQueue,
      checkQueueBacklog: () => this.checkQueueBacklog(),
      getLastHealthCheck: () => this.lastHealthCheck,
      setLastHealthCheck: (timestamp: number) => {
        this.lastHealthCheck = timestamp;
      },
      maxRestartAttempts: this.MAX_RESTART_ATTEMPTS
    };
  }

  private getEventQueueDeps(): ReflexionWorkerEventQueueDeps {
    return {
      eventQueue: this.eventQueue,
      reflectionRecorder: this.reflectionRecorder,
      status: this.status,
      maxRetries: this.MAX_RETRIES,
      retryDelays: this.RETRY_DELAYS,
      queueWarningThreshold: this.QUEUE_WARNING_THRESHOLD,
      processFailureEvent: (event: FailureEvent) => this.processFailureEvent(event)
    };
  }

  private getFailureHandlerDeps(): ReflexionWorkerFailureHandlerDeps {
    return {
      proceduralMemoryService: this.proceduralMemoryService
    };
  }

  private getMetricsDeps(): ReflexionWorkerMetricsDeps {
    return {
      getStatus: () => this.getStatus(),
      eventQueue: this.eventQueue,
      failureDetector: this.failureDetector
    };
  }

  /**
   * Worker 시작
   */
  async start(): Promise<boolean> {
    if (this.status.isRunning) {
      logger.warn('ReflexionWorker가 이미 실행 중입니다');
      return false;
    }

    try {
      // FailureDetector의 큐에 핸들러 등록
      await this.failureDetector.startQueue();

      // 이벤트 큐 시작
      await this.eventQueue.start();

      this.status.isRunning = true;
      this.lastHealthCheck = Date.now();
      logger.info('ReflexionWorker 시작됨');

      return true;
    } catch (error) {
      logger.error('ReflexionWorker 시작 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      // 시작 실패 시 자동 재시작 시도
      await this.attemptRestart();
      return false;
    }
  }

  /**
   * Worker 중지
   */
  async stop(): Promise<boolean> {
    if (!this.status.isRunning) {
      return false;
    }

    try {
      await this.eventQueue.stop();
      await this.failureDetector.stopQueue();

      this.status.isRunning = false;
      logger.info('ReflexionWorker 중지됨');

      return true;
    } catch (error) {
      logger.error('ReflexionWorker 중지 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * 헬스체크 수행
   */
  performHealthCheck(): void {
    performHealthCheckModule(this.getHealthDeps());
  }

  cleanupDuplicateWindow(): void {
    this.reflectionRecorder.cleanupDuplicateWindow();
  }

  /**
   * Worker 재시작 시도
   */
  private async attemptRestart(): Promise<void> {
    await attemptRestart(this.getHealthDeps());
  }

  /**
   * FailureDetector의 큐에 핸들러 등록
   * FailureDetector가 실패 이벤트를 큐에 추가할 때 이 핸들러를 사용하도록 설정
   */
  registerHandler(): void {
    registerHandlerModule();
  }

  /**
   * 실패 이벤트를 큐에 추가 (큐 크기 제한 포함)
   * FailureDetector의 queueFailureEvent를 대체하는 메서드
   * AsyncTaskQueue가 자동으로 큐 크기 제한을 처리함
   */
  async queueFailureEvent(event: FailureEvent): Promise<boolean> {
    return queueFailureEventModule(this.getEventQueueDeps(), event);
  }

  /**
   * 실패 이벤트 처리 (재시도 및 백오프 포함)
   */
  async processFailureEvent(event: FailureEvent): Promise<void> {
    await processFailureEventModule(this.getEventQueueDeps(), event);
  }

  private async updateProceduralMemory(
    memoryId: string,
    extracted: ExtractedProceduralMemory,
    updateMode: 'replace' | 'incremental' | 'versioned',
    reflectionNote: ReflectionNotes | Record<string, unknown>,
    event: FailureEvent
  ): Promise<void> {
    await updateProceduralMemoryModule(
      this.getFailureHandlerDeps(),
      memoryId,
      extracted,
      updateMode,
      reflectionNote,
      event
    );
  }

  /**
   * Worker 상태 조회
   */
  getStatus(): WorkerStatus {
    const queueStats = this.eventQueue.getStats();
    return {
      ...this.status,
      queueSize: queueStats.pending,
      activeWorkers: queueStats.processing
    };
  }

  /**
   * 큐 적체 경고 확인
   */
  checkQueueBacklog(): void {
    checkQueueBacklogModule(this.getEventQueueDeps());
  }

  /**
   * Reflexion 기록 메트릭 수집
   */
  getReflexionMetrics(): {
    processedCount: number;
    failedCount: number;
    successRate: number; // 기록 성공률
    averageProcessingTime: number; // 평균 처리 시간 (밀리초)
    queueSize: number;
    activeWorkers: number;
    restartCount: number;
  } {
    return getReflexionMetricsModule(this.getMetricsDeps());
  }

  /**
   * 통합 메트릭 수집 (FailureDetector + ReflexionWorker)
   */
  getIntegratedMetrics(): {
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
    return getIntegratedMetricsModule(this.getMetricsDeps());
  }
}
