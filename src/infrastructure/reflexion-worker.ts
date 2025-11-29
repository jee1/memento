/**
 * Reflexion Worker 서비스
 * 실패 이벤트를 처리하여 reflection_notes를 자동 생성하고 저장
 */

import { logger } from '../shared/utils/logger.js';
import { FailureDetector, type FailureEvent } from '../domains/monitoring/services/failure-detector.js';
import { AsyncTaskQueue } from './async-optimizer.js';
import { mergeReflectionNotes, serializeReflectionNotes, type ExistingReflectionNotes } from '../shared/utils/reflection-notes-merge.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import Database from 'better-sqlite3';
import { createHash } from 'crypto';

/**
 * 중복 감지용 이벤트 키 (슬라이딩 윈도우)
 */
interface EventKey {
  key: string;
  timestamp: number;
}

/**
 * Worker 상태
 */
interface WorkerStatus {
  isRunning: boolean;
  activeWorkers: number;
  queueSize: number;
  processedCount: number;
  failedCount: number;
  restartCount: number;
}

/**
 * ReflexionWorker 서비스 클래스
 */
export class ReflexionWorker {
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
  private status: WorkerStatus = {
    isRunning: false,
    activeWorkers: 0,
    queueSize: 0,
    processedCount: 0,
    failedCount: 0,
    restartCount: 0
  };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
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
    
    // 중복 윈도우 정리 (1분마다)
    this.cleanupInterval = setInterval(() => {
      this.cleanupDuplicateWindow();
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
      const queueStats = this.eventQueue.getStats();
      
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
      // 중복 감지
      if (this.isDuplicate(event)) {
        logger.debug('중복 이벤트 감지, Reflexion 기록 스킵', {
          event_id: event.id,
          tool: event.tool_name
        });
        return;
      }

      // 중복 윈도우에 추가
      const eventKey = this.generateEventKey(event);
      this.duplicateWindow.set(eventKey, Date.now());

      // Reflexion 데이터 생성
      const reflectionNote = this.generateReflectionNote(event);

      // 동일 task_goal 확인 및 병합
      const taskGoal = event.original_task || this.extractTaskGoal(event);
      
      if (taskGoal) {
        // 기존 reflection_notes 조회 (id도 함께 조회하여 업데이트에 사용)
        const existingRecord = DatabaseUtils.get(
          this.db,
          `SELECT id, reflection_notes FROM memory_item 
           WHERE type = 'procedural' AND task_goal = ? 
           ORDER BY created_at DESC LIMIT 1`,
          [taskGoal]
        ) as { id: string; reflection_notes: string | null } | undefined;

        let existing: ExistingReflectionNotes;
        if (!existingRecord || !existingRecord.reflection_notes) {
          existing = { type: 'null', value: null };
        } else {
          const parsed = this.parseReflectionNotes(existingRecord.reflection_notes);
          existing = parsed.type === 'null' ? { type: 'null', value: null } :
                     parsed.type === 'object' ? { type: 'object', value: parsed.value } :
                     { type: 'array', value: parsed.value };
        }

        // 반복 실패 패턴 분석
        const patternAnalysis = this.analyzeFailurePattern(existing, event);
        
        // 반복 실패 경고
        if (patternAnalysis.repeatCount > 1) {
          logger.warn('동일 작업 반복 실패 감지', {
            task_goal: taskGoal,
            repeat_count: patternAnalysis.repeatCount,
            failure_types: patternAnalysis.failureTypes,
            tools: patternAnalysis.tools,
            message: `동일 작업이 ${patternAnalysis.repeatCount}회 실패했습니다. 개선 방안을 검토해야 합니다.`
          });
        }

        // 병합
        const mergeResult = mergeReflectionNotes(existing, reflectionNote);
        const finalReflectionNotes = serializeReflectionNotes(mergeResult.merged);

        // 기존 메모리 업데이트 또는 새로 생성
        if (existingRecord && existingRecord.id) {
          // 기존 메모리 업데이트
          DatabaseUtils.run(
            this.db,
            `UPDATE memory_item SET reflection_notes = ? WHERE id = ?`,
            [finalReflectionNotes, existingRecord.id]
          );
          logger.info('기존 reflection_notes 업데이트됨', {
            memory_id: existingRecord.id,
            task_goal: taskGoal
          });
        } else {
          // 새 메모리 생성 (remember Tool 사용)
          // 여기서는 직접 DB에 삽입하지 않고, remember Tool을 호출하는 것이 더 나을 수 있음
          // 하지만 Phase 2에서는 직접 삽입으로 처리
          const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          DatabaseUtils.run(
            this.db,
            `INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              memoryId,
              'procedural',
              `Reflexion: ${event.tool_name} 실패 기록`,
              taskGoal,
              JSON.stringify([]),
              finalReflectionNotes,
              0.7,
              'private',
              new Date().toISOString()
            ]
          );
          logger.info('새 reflection_notes 생성됨', {
            memory_id: memoryId,
            task_goal: taskGoal
          });
        }

        // 경고 메시지 처리
        if (mergeResult.warnings.length > 0) {
          mergeResult.warnings.forEach(warning => {
            logger.warn('reflection_notes 병합 경고', { warning });
          });
        }

        if (mergeResult.removedCount > 0) {
          logger.warn('reflection_notes 크기 제한으로 인해 항목 제거됨', {
            removed_count: mergeResult.removedCount
          });
        }
      } else {
        // task_goal이 없는 경우 새 메모리 생성 (task_goal 없이)
        const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        DatabaseUtils.run(
          this.db,
          `INSERT INTO memory_item (id, type, content, reflection_notes, importance, privacy_scope, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            memoryId,
            'procedural',
            `Reflexion: ${event.tool_name} 실패 기록`,
            JSON.stringify(reflectionNote),
            0.7,
            'private',
            new Date().toISOString()
          ]
        );
        logger.info('새 reflection_notes 생성됨 (task_goal 없음)', {
          memory_id: memoryId
        });
      }

      this.status.processedCount++;
    } catch (error) {
      this.status.failedCount++;
      logger.error('auto_reflect 실행 실패', {
        error: error instanceof Error ? error.message : String(error),
        event_id: event.id
      });
      throw error;
    }
  }

  /**
   * 중복 감지
   */
  private isDuplicate(event: FailureEvent): boolean {
    const eventKey = this.generateEventKey(event);
    const timestamp = this.duplicateWindow.get(eventKey);
    
    if (!timestamp) {
      return false;
    }

    // 슬라이딩 윈도우 내에 있는지 확인
    const now = Date.now();
    if (now - timestamp < this.WINDOW_SIZE_MS) {
      return true;
    }

    // 윈도우를 벗어났으면 제거
    this.duplicateWindow.delete(eventKey);
    return false;
  }

  /**
   * 이벤트 키 생성: SHA256({tool_name}_{error_type}_{error_message_hash})
   */
  private generateEventKey(event: FailureEvent): string {
    const keyString = `${event.tool_name}_${event.error_type}_${event.error_message_hash}`;
    return createHash('sha256').update(keyString).digest('hex');
  }

  /**
   * 중복 윈도우 정리 (만료된 항목 제거)
   */
  private cleanupDuplicateWindow(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.duplicateWindow.entries()) {
      if (now - timestamp >= this.WINDOW_SIZE_MS) {
        this.duplicateWindow.delete(key);
      }
    }
  }

  /**
   * Reflexion 데이터 생성
   */
  private generateReflectionNote(event: FailureEvent): any {
    return {
      failure_type: event.error_type,
      failure_description: event.error_message,
      timestamp: event.timestamp,
      original_task: event.original_task,
      lessons_learned: this.generateLessonsLearned(event),
      suggested_improvements: this.generateSuggestedImprovements(event),
      phase: 'auto' // 자동 생성
    };
  }

  /**
   * 교훈 추출 (템플릿 기반)
   */
  private generateLessonsLearned(event: FailureEvent): string {
    const templates: Record<string, string> = {
      'tool_error': `${event.tool_name} 도구 실행 중 오류가 발생했습니다. 에러 유형을 분석하여 재발 방지 방안을 수립해야 합니다.`,
      'user_feedback': `사용자 피드백을 통해 ${event.tool_name} 도구의 문제점이 확인되었습니다. 사용자 요구사항을 반영하여 개선이 필요합니다.`,
      'metric_failure': `${event.tool_name} 도구의 성능 지표가 임계값을 초과했습니다. 성능 최적화가 필요합니다.`
    };

    return templates[event.error_type] || `${event.tool_name} 도구 실행 중 문제가 발생했습니다.`;
  }

  /**
   * 개선 방안 제안 (템플릿 기반)
   */
  private generateSuggestedImprovements(event: FailureEvent): string {
    const errorMessage = event.error_message.toLowerCase();
    
    let suggestions: string[] = [];

    if (errorMessage.includes('validation') || errorMessage.includes('검증')) {
      suggestions.push('입력 파라미터 검증 로직을 강화해야 합니다.');
    }
    
    if (errorMessage.includes('database') || errorMessage.includes('데이터베이스') || errorMessage.includes('sqlite')) {
      suggestions.push('데이터베이스 연결 및 쿼리 최적화가 필요합니다.');
    }
    
    if (errorMessage.includes('timeout') || errorMessage.includes('타임아웃')) {
      suggestions.push('타임아웃 설정을 조정하고 재시도 로직을 추가해야 합니다.');
    }
    
    if (event.context?.execution_time_ms && event.context.execution_time_ms > 5000) {
      suggestions.push('실행 시간이 길어 성능 최적화가 필요합니다.');
    }

    if (suggestions.length === 0) {
      suggestions.push('에러 로그를 분석하여 근본 원인을 파악하고 개선 방안을 수립해야 합니다.');
    }

    return suggestions.join(' ');
  }

  /**
   * 반복 실패 패턴 분석
   * 동일 task_goal의 반복 실패 횟수 및 패턴을 분석
   */
  private analyzeFailurePattern(
    existing: ExistingReflectionNotes,
    currentEvent: FailureEvent
  ): {
    repeatCount: number;
    failureTypes: string[];
    tools: string[];
    errorMessages: string[];
  } {
    let repeatCount = 1; // 현재 실패 포함
    const failureTypes = new Set<string>([currentEvent.error_type]);
    const tools = new Set<string>([currentEvent.tool_name]);
    const errorMessages: string[] = [currentEvent.error_message];

    // 기존 reflection_notes 분석
    if (existing.type === 'array') {
      const existingArray = existing.value;
      repeatCount += existingArray.length;
      
      for (const note of existingArray) {
        if (note.failure_type) {
          failureTypes.add(note.failure_type);
        }
        if (note.tool_name) {
          tools.add(note.tool_name);
        }
        if (note.failure_description) {
          errorMessages.push(note.failure_description);
        }
      }
    } else if (existing.type === 'object') {
      repeatCount += 1;
      const note = existing.value;
      if (note.failure_type) {
        failureTypes.add(note.failure_type);
      }
      if (note.tool_name) {
        tools.add(note.tool_name);
      }
      if (note.failure_description) {
        errorMessages.push(note.failure_description);
      }
    }

    return {
      repeatCount,
      failureTypes: Array.from(failureTypes),
      tools: Array.from(tools),
      errorMessages
    };
  }

  /**
   * 작업 목표 추출
   */
  private extractTaskGoal(event: FailureEvent): string | undefined {
    if (event.original_task) {
      return event.original_task;
    }

    // context에서 추출 시도
    if (event.context?.params?.task_goal) {
      return event.context.params.task_goal;
    }

    if (event.context?.params?.content) {
      const content = event.context.params.content;
      if (content.length > 200) {
        return content.substring(0, 200) + '...';
      }
      return content;
    }

    return undefined;
  }

  /**
   * reflection_notes 파싱
   */
  private parseReflectionNotes(reflectionNotes: string): { type: 'null' | 'object' | 'array'; value: null | any | any[] } {
    if (!reflectionNotes) {
      return { type: 'null', value: null };
    }

    try {
      const parsed = JSON.parse(reflectionNotes);
      
      if (Array.isArray(parsed)) {
        return { type: 'array', value: parsed };
      } else if (typeof parsed === 'object' && parsed !== null) {
        return { type: 'object', value: parsed };
      } else {
        return { type: 'null', value: null };
      }
    } catch (error) {
      logger.warn('reflection_notes 파싱 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { type: 'null', value: null };
    }
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
   * 가장 오래된 큐 이벤트 제거 (FIFO)
   * AsyncTaskQueue의 큐 크기 제한 기능을 사용하므로 여기서는 더 이상 필요 없음
   * @deprecated AsyncTaskQueue가 자동으로 처리하므로 사용하지 않음
   */
  private removeOldestQueuedEvent(): string | null {
    // AsyncTaskQueue의 addTask에서 자동으로 큐 크기 제한을 처리하므로
    // 여기서는 더 이상 필요 없음
    return null;
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

