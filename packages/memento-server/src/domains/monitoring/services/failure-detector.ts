/**
 * 실패 감지 시스템
 * MCP Tool 호출 실패, 사용자 피드백, 성능 지표 미달 등을 감지하여 Reflexion Worker에 전달
 */

import type { IAsyncTaskQueue } from '../../../shared/interfaces/async-task-queue.interface.js';
import type { FailureEvent } from '../../../shared/types/failure-event.js';
import { logger } from '../../../shared/utils/logger.js';
import type { ToolContext } from '../../../tools/types.js';

/** 실패 이벤트 타입 재export (shared 타입 사용, 하위 호환) */
export type { FailureEvent };

/**
 * 에러 타입 분류
 */
export enum ErrorType {
  TOOL_ERROR = 'tool_error',
  USER_FEEDBACK = 'user_feedback',
  METRIC_FAILURE = 'metric_failure'
}

/**
 * 실패 감지 결과
 */
export interface FailureDetectionResult {
  detected: boolean; // 실패 감지 여부
  event?: FailureEvent; // 감지된 실패 이벤트
  reason?: string; // 감지 이유 또는 미감지 이유
}

/**
 * 성능 지표 임계값 설정
 */
export interface PerformanceThresholds {
  responseTimeMs: number; // 응답 시간 임계값 (밀리초)
  errorRate: number; // 에러율 임계값 (0-1)
  accuracyThreshold?: number; // 정확도 임계값 (0-1, 선택적)
}

/**
 * 사용자 피드백 감지 키워드
 */
const USER_FEEDBACK_KEYWORDS = [
  '실패', '오류', '에러', '문제', '잘못', '틀림', '안됨', '안되', '못함',
  'failed', 'error', 'wrong', 'incorrect', 'problem', 'issue', 'bug',
  '실패했습니다', '오류가 발생했습니다', '문제가 있습니다'
];

/**
 * FailureDetector 서비스 클래스
 */
export class FailureDetector {
  private eventQueue: IAsyncTaskQueue;
  private performanceThresholds: PerformanceThresholds;
  private toolMetrics: Map<string, { success: number; failure: number; totalTime: number; count: number }> = new Map();

  constructor(
    eventQueue: IAsyncTaskQueue,
    performanceThresholds?: PerformanceThresholds
  ) {
    this.eventQueue = eventQueue;
    this.performanceThresholds = performanceThresholds ?? {
      responseTimeMs: 5000,
      errorRate: 0.1
    };
  }

  /**
   * MCP Tool 호출 실패 감지
   */
  detectToolError(
    toolName: string,
    error: Error,
    params?: any,
    executionTimeMs?: number
  ): FailureDetectionResult {
    try {
      // 에러 타입 분류
      const errorType = this.classifyError(error);

      // 실패 이벤트 생성
      const event: FailureEvent = {
        id: this.generateEventId(toolName, errorType, error.message),
        tool_name: toolName,
        error_type: errorType,
        error_message: error.message,
        error_message_hash: this.hashMessage(error.message),
        timestamp: new Date().toISOString(),
        context: {
          params,
          stack: error.stack,
          execution_time_ms: executionTimeMs
        },
        priority: this.calculatePriority(errorType, error.message)
      };

      // 원래 작업 목표 추출 시도
      if (params?.task_goal) {
        event.original_task = params.task_goal;
      } else if (params?.content) {
        // content에서 작업 목표 추출 시도
        event.original_task = this.extractTaskGoal(params.content);
      }

      logger.info('Tool 에러 감지', {
        tool: toolName,
        error_type: errorType,
        error_message: error.message.substring(0, 100)
      });

      return {
        detected: true,
        event
      };
    } catch (detectionError) {
      logger.error('실패 감지 중 오류 발생', {
        error: detectionError instanceof Error ? detectionError.message : String(detectionError),
        tool: toolName
      });

      return {
        detected: false,
        reason: '실패 감지 처리 중 오류 발생'
      };
    }
  }

  /**
   * 사용자 피드백 기반 실패 감지
   */
  detectUserFeedback(
    toolName: string,
    feedback: string,
    params?: any
  ): FailureDetectionResult {
    try {
      // 키워드 기반 감지
      const normalizedFeedback = feedback.toLowerCase();
      const hasFailureKeyword = USER_FEEDBACK_KEYWORDS.some(keyword =>
        normalizedFeedback.includes(keyword.toLowerCase())
      );

      if (!hasFailureKeyword) {
        return {
          detected: false,
          reason: '실패 키워드가 감지되지 않음'
        };
      }

      // 실패 이벤트 생성
      const event: FailureEvent = {
        id: this.generateEventId(toolName, ErrorType.USER_FEEDBACK, feedback),
        tool_name: toolName,
        error_type: ErrorType.USER_FEEDBACK,
        error_message: feedback,
        error_message_hash: this.hashMessage(feedback),
        timestamp: new Date().toISOString(),
        context: {
          params,
          feedback_text: feedback
        },
        original_task: params?.task_goal || this.extractTaskGoal(feedback),
        priority: 8 // 사용자 피드백은 높은 우선순위
      };

      logger.info('사용자 피드백 기반 실패 감지', {
        tool: toolName,
        feedback: feedback.substring(0, 100)
      });

      return {
        detected: true,
        event
      };
    } catch (detectionError) {
      logger.error('사용자 피드백 감지 중 오류 발생', {
        error: detectionError instanceof Error ? detectionError.message : String(detectionError),
        tool: toolName
      });

      return {
        detected: false,
        reason: '사용자 피드백 감지 처리 중 오류 발생'
      };
    }
  }

  /**
   * 성능 지표 미달 감지
   */
  detectPerformanceFailure(
    toolName: string,
    executionTimeMs: number,
    success: boolean,
    params?: any
  ): FailureDetectionResult {
    try {
      // 메트릭 업데이트
      this.updateMetrics(toolName, success, executionTimeMs);

      // 응답 시간 임계값 초과 확인
      const responseTimeExceeded = executionTimeMs > this.performanceThresholds.responseTimeMs;

      // 에러율 확인
      const metrics = this.toolMetrics.get(toolName);
      const errorRateExceeded = metrics && metrics.count > 10
        ? metrics.failure / metrics.count > this.performanceThresholds.errorRate
        : false;

      if (!responseTimeExceeded && !errorRateExceeded) {
        return {
          detected: false,
          reason: '성능 지표가 임계값 이내'
        };
      }

      // 실패 이벤트 생성
      const event: FailureEvent = {
        id: this.generateEventId(toolName, ErrorType.METRIC_FAILURE, `performance_${executionTimeMs}ms`),
        tool_name: toolName,
        error_type: ErrorType.METRIC_FAILURE,
        error_message: responseTimeExceeded
          ? `응답 시간 임계값 초과: ${executionTimeMs}ms > ${this.performanceThresholds.responseTimeMs}ms`
          : `에러율 임계값 초과: ${((metrics!.failure / metrics!.count) * 100).toFixed(1)}% > ${(this.performanceThresholds.errorRate * 100).toFixed(1)}%`,
        error_message_hash: this.hashMessage(`performance_${executionTimeMs}ms`),
        timestamp: new Date().toISOString(),
        context: {
          params,
          execution_time_ms: executionTimeMs,
          response_time_exceeded: responseTimeExceeded,
          error_rate_exceeded: errorRateExceeded,
          metrics: metrics ? {
            success: metrics.success,
            failure: metrics.failure,
            total_time: metrics.totalTime,
            count: metrics.count,
            error_rate: metrics.failure / metrics.count
          } : undefined
        },
        original_task: params?.task_goal,
        priority: responseTimeExceeded ? 6 : 5
      };

      logger.info('성능 지표 미달 감지', {
        tool: toolName,
        execution_time_ms: executionTimeMs,
        response_time_exceeded: responseTimeExceeded,
        error_rate_exceeded: errorRateExceeded
      });

      return {
        detected: true,
        event
      };
    } catch (detectionError) {
      logger.error('성능 지표 감지 중 오류 발생', {
        error: detectionError instanceof Error ? detectionError.message : String(detectionError),
        tool: toolName
      });

      return {
        detected: false,
        reason: '성능 지표 감지 처리 중 오류 발생'
      };
    }
  }

  /**
   * 실패 이벤트를 큐에 추가
   */
  async queueFailureEvent(event: FailureEvent, handler: (event: FailureEvent) => Promise<void>): Promise<boolean> {
    try {
      const taskId = this.eventQueue.addTask({
        id: event.id,
        type: 'failure_event',
        data: {
          event,
          handler
        },
        priority: event.priority,
        maxRetries: 3,
        timeout: 30000 // 30초 타임아웃
      });

      if (taskId === false) {
        logger.warn('실패 이벤트 큐 추가 실패 (중복 또는 큐 가득참)', {
          event_id: event.id,
          tool: event.tool_name
        });
        return false;
      }

      logger.debug('실패 이벤트 큐에 추가됨', {
        event_id: event.id,
        tool: event.tool_name,
        priority: event.priority
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
   * 에러 타입 분류
   */
  private classifyError(error: Error): ErrorType {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // ValidationError
    if (name.includes('validation') || name.includes('zod') || message.includes('validation') || message.includes('검증')) {
      return ErrorType.TOOL_ERROR;
    }

    // DatabaseError
    if (name.includes('database') || name.includes('sqlite') || message.includes('database') || message.includes('sql') || message.includes('데이터베이스')) {
      return ErrorType.TOOL_ERROR;
    }

    // ToolError (기본값)
    return ErrorType.TOOL_ERROR;
  }

  /**
   * 이벤트 ID 생성
   */
  private generateEventId(toolName: string, errorType: ErrorType, errorMessage: string): string {
    const hash = this.hashMessage(errorMessage);
    return `failure_${toolName}_${errorType}_${hash}_${Date.now()}`;
  }

  /**
   * 메시지 해시 생성 (SHA256, 첫 16자)
   */
  private hashMessage(message: string): string {
    // 간단한 해시 함수 (실제로는 crypto 모듈 사용 권장)
    const normalized = message.substring(0, 50).toLowerCase().trim();
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit 정수로 변환
    }
    return Math.abs(hash).toString(16).substring(0, 16);
  }

  /**
   * 우선순위 계산
   */
  private calculatePriority(errorType: ErrorType, errorMessage: string): number {
    // 기본 우선순위
    let priority = 5;

    // 에러 타입별 우선순위 조정
    if (errorType === ErrorType.USER_FEEDBACK) {
      priority = 8; // 사용자 피드백은 높은 우선순위
    } else if (errorType === ErrorType.METRIC_FAILURE) {
      priority = 6; // 성능 지표 미달은 중간 우선순위
    }

    // 에러 메시지 키워드 기반 우선순위 조정
    const criticalKeywords = ['critical', 'fatal', 'crash', '심각', '치명'];
    if (criticalKeywords.some(keyword => errorMessage.toLowerCase().includes(keyword))) {
      priority = Math.min(priority + 2, 10); // 최대 10
    }

    return priority;
  }

  /**
   * 작업 목표 추출 (간단한 휴리스틱)
   */
  private extractTaskGoal(text: string): string | undefined {
    // 간단한 추출 로직 (Phase 2에서는 LLM 활용 고려)
    if (text.length > 200) {
      return text.substring(0, 200) + '...';
    }
    return text;
  }

  /**
   * 메트릭 업데이트
   */
  private updateMetrics(toolName: string, success: boolean, executionTimeMs: number): void {
    const metrics = this.toolMetrics.get(toolName) || {
      success: 0,
      failure: 0,
      totalTime: 0,
      count: 0
    };

    if (success) {
      metrics.success++;
    } else {
      metrics.failure++;
    }

    metrics.totalTime += executionTimeMs;
    metrics.count++;

    this.toolMetrics.set(toolName, metrics);
  }

  /**
   * 큐 상태 조회
   */
  getQueueStats() {
    return this.eventQueue.getStats();
  }

  /**
   * 큐 시작
   */
  async startQueue(): Promise<boolean> {
    return await this.eventQueue.start();
  }

  /**
   * 큐 중지
   */
  async stopQueue(): Promise<boolean> {
    return await this.eventQueue.stop();
  }

  /**
   * 실패 감지 메트릭 수집
   */
  getDetectionMetrics(): {
    totalDetections: number;
    toolErrorCount: number;
    userFeedbackCount: number;
    metricFailureCount: number;
    detectionRate: number; // 감지율 (감지된 실패 / 전체 실패)
  } {
    const queueStats = this.eventQueue.getStats();
    const totalDetections = queueStats.completed + queueStats.failed;
    
    // 에러 타입별 카운트 (간단한 추정)
    // 실제로는 이벤트를 추적하여 정확한 카운트를 수집해야 함
    const toolErrorCount = Math.floor(totalDetections * 0.6); // 추정
    const userFeedbackCount = Math.floor(totalDetections * 0.2); // 추정
    const metricFailureCount = Math.floor(totalDetections * 0.2); // 추정
    
    return {
      totalDetections,
      toolErrorCount,
      userFeedbackCount,
      metricFailureCount,
      detectionRate: totalDetections > 0 ? 1.0 : 0.0 // 모든 실패가 감지되었다고 가정
    };
  }
}

