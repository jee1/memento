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
import type { ExtractedProceduralMemory } from '../shared/utils/procedural-memory-extractor.js';
import type { ReflectionNotes } from '../shared/utils/procedural-memory-extractor.types.js';

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
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
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
    
    // 중복 윈도우 정리 (1분마다)
    this.cleanupInterval = setInterval(() => {
      this.reflectionRecorder.cleanupDuplicateWindow();
    }, 60 * 1000);
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
      
      // 헬스체크 시작
      this.startHealthCheck();
      
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
      
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
      
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
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
   * 헬스체크 시작
   */
  private startHealthCheck(): void {
    // 30초마다 헬스체크
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30 * 1000);
  }

  /**
   * 헬스체크 수행
   */
  private performHealthCheck(): void {
    try {
      const now = Date.now();
      
      // 큐 적체 확인
      this.checkQueueBacklog();
      
      // Worker 상태 확인
      if (!this.eventQueue.isRunning() && this.status.isRunning) {
        logger.warn('ReflexionWorker 큐가 중지됨, 재시작 시도', {
          queue_running: this.eventQueue.isRunning(),
          worker_running: this.status.isRunning
        });
        this.attemptRestart();
      }
      
      this.lastHealthCheck = now;
    } catch (error) {
      logger.error('헬스체크 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      // 헬스체크 실패 시 재시작 시도
      this.attemptRestart();
    }
  }

  /**
   * Worker 재시작 시도
   */
  private async attemptRestart(): Promise<void> {
    if (this.status.restartCount >= this.MAX_RESTART_ATTEMPTS) {
      logger.error('ReflexionWorker 최대 재시작 횟수 초과', {
        restart_count: this.status.restartCount,
        max_attempts: this.MAX_RESTART_ATTEMPTS
      });
      this.status.isRunning = false;
      return;
    }

    this.status.restartCount++;
    logger.warn('ReflexionWorker 재시작 시도', {
      attempt: this.status.restartCount,
      max_attempts: this.MAX_RESTART_ATTEMPTS
    });

    try {
      // 현재 상태 정리
      await this.eventQueue.stop();
      
      // 재시작
      await this.eventQueue.start();
      
      logger.info('ReflexionWorker 재시작 성공', {
        restart_count: this.status.restartCount
      });
    } catch (error) {
      logger.error('ReflexionWorker 재시작 실패', {
        error: error instanceof Error ? error.message : String(error),
        restart_count: this.status.restartCount
      });
      
      // 재시작 실패 시 일정 시간 후 재시도
      setTimeout(() => {
        this.attemptRestart();
      }, 5000); // 5초 후 재시도
    }
  }

  /**
   * auto_reflect 내부 함수
   * 실패 정보를 바탕으로 Reflexion 데이터 생성 및 저장
   */
  private async autoReflect(event: FailureEvent): Promise<void> {
    try {
      const recorded = await this.reflectionRecorder.record(event);
      if (recorded) {
        this.status.processedCount++;
      }
    } catch (error) {
      this.status.failedCount++;
      logger.error('auto_reflect 실행 실패', {
        error: error instanceof Error ? error.message : String(error),
        event_id: event.id
      });
      throw error;
    }
  }

  private async updateProceduralMemory(
    memoryId: string,
    extracted: ExtractedProceduralMemory,
    updateMode: 'replace' | 'incremental' | 'versioned',
    reflectionNote: ReflectionNotes | Record<string, unknown>,
    event: FailureEvent
  ): Promise<void> {
    await this.proceduralMemoryService.updateProceduralMemory(
      memoryId,
      extracted,
      updateMode,
      reflectionNote,
      event
    );
  }

  /**
   * FailureDetector의 큐에 핸들러 등록
   * FailureDetector가 실패 이벤트를 큐에 추가할 때 이 핸들러를 사용하도록 설정
   */
  registerHandler(): void {
    // FailureDetector의 queueFailureEvent를 래핑하여
    // 큐 크기 제한 및 processFailureEvent를 호출하도록 설정
    // 실제로는 FailureDetector에 직접 등록하는 대신,
    // BaseTool의 handleFailure에서 이 메서드를 호출하도록 수정 필요
    // 또는 FailureDetector에 setHandler 메서드를 추가
  }

  /**
   * 실패 이벤트를 큐에 추가 (큐 크기 제한 포함)
   * FailureDetector의 queueFailureEvent를 대체하는 메서드
   * AsyncTaskQueue가 자동으로 큐 크기 제한을 처리함
   */
  async queueFailureEvent(event: FailureEvent): Promise<boolean> {
    try {
      // 큐에 추가 (processFailureEvent를 핸들러로 사용)
      // AsyncTaskQueue의 addTask에서 자동으로 큐 크기 제한 처리
      const taskId = this.eventQueue.addTask({
        id: event.id,
        type: 'failure_event',
        data: {
          event,
          handler: (evt: FailureEvent) => this.processFailureEvent(evt)
        },
        priority: event.priority,
        maxRetries: this.MAX_RETRIES,
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
      this.checkQueueBacklog();

      logger.debug('실패 이벤트 큐에 추가됨', {
        event_id: event.id,
        tool: event.tool_name,
        priority: event.priority,
        queue_size: this.eventQueue.getStats().pending
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
  async processFailureEvent(event: FailureEvent): Promise<void> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        await this.autoReflect(event);
        return; // 성공
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAYS[attempt] || this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
          logger.warn('Reflexion 기록 실패, 재시도 예정', {
            attempt: attempt + 1,
            max_retries: this.MAX_RETRIES,
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
      retry_count: this.MAX_RETRIES
    });
    throw lastError || new Error('Reflexion 기록 실패');
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
    const queueStats = this.eventQueue.getStats();
    if (queueStats.pending > this.QUEUE_WARNING_THRESHOLD) {
      logger.warn('ReflexionWorker 큐 적체 경고', {
        queue_size: queueStats.pending,
        threshold: this.QUEUE_WARNING_THRESHOLD
      });
    }
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
    const status = this.getStatus();
    const queueStats = this.eventQueue.getStats();
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
    const detectionMetrics = this.failureDetector.getDetectionMetrics();
    const reflexionMetrics = this.getReflexionMetrics();
    
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
}
