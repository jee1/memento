/**
 * FailureDetector 테스트
 * MCP Tool 호출 실패 감지, 사용자 피드백 감지, 성능 지표 미달 감지 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FailureDetector, ErrorType, type FailureEvent, type PerformanceThresholds } from '../failure-detector.js';
import { AsyncTaskQueue } from '../../../../infrastructure/async-optimizer.js';

describe('FailureDetector', () => {
  let detector: FailureDetector;
  let eventQueue: AsyncTaskQueue;

  beforeEach(() => {
    eventQueue = new AsyncTaskQueue(5);
    detector = new FailureDetector(eventQueue);
  });

  afterEach(async () => {
    await detector.stopQueue();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('detectToolError', () => {
    it('MCP Tool 호출 실패를 감지해야 함', () => {
      // Given: Tool 에러 발생
      const toolName = 'test_tool';
      const error = new Error('Database connection failed');
      const params = { query: 'SELECT * FROM users' };

      // When: Tool 에러 감지
      const result = detector.detectToolError(toolName, error, params);

      // Then: 실패가 감지되어야 함
      expect(result.detected).toBe(true);
      expect(result.event).toBeDefined();
      expect(result.event?.tool_name).toBe(toolName);
      expect(result.event?.error_type).toBe(ErrorType.TOOL_ERROR);
      expect(result.event?.error_message).toBe('Database connection failed');
      expect(result.event?.context.params).toEqual(params);
    });

    it('ValidationError를 감지해야 함', () => {
      // Given: ValidationError 발생
      const toolName = 'test_tool';
      const error = new Error('Validation failed: invalid input');
      error.name = 'ValidationError';

      // When: Tool 에러 감지
      const result = detector.detectToolError(toolName, error);

      // Then: 실패가 감지되어야 함
      expect(result.detected).toBe(true);
      expect(result.event?.error_type).toBe(ErrorType.TOOL_ERROR);
    });

    it('DatabaseError를 감지해야 함', () => {
      // Given: DatabaseError 발생
      const toolName = 'test_tool';
      const error = new Error('SQLite database error');
      error.name = 'DatabaseError';

      // When: Tool 에러 감지
      const result = detector.detectToolError(toolName, error);

      // Then: 실패가 감지되어야 함
      expect(result.detected).toBe(true);
      expect(result.event?.error_type).toBe(ErrorType.TOOL_ERROR);
    });

    it('원래 작업 목표를 추출해야 함', () => {
      // Given: task_goal이 포함된 파라미터
      const toolName = 'test_tool';
      const error = new Error('Test error');
      const params = { task_goal: '사용자 인증 구현' };

      // When: Tool 에러 감지
      const result = detector.detectToolError(toolName, error, params);

      // Then: original_task가 설정되어야 함
      expect(result.detected).toBe(true);
      expect(result.event?.original_task).toBe('사용자 인증 구현');
    });

    it('실행 시간을 기록해야 함', () => {
      // Given: 실행 시간이 포함된 에러
      const toolName = 'test_tool';
      const error = new Error('Timeout error');
      const executionTimeMs = 6000;

      // When: Tool 에러 감지
      const result = detector.detectToolError(toolName, error, undefined, executionTimeMs);

      // Then: 실행 시간이 기록되어야 함
      expect(result.detected).toBe(true);
      expect(result.event?.context.execution_time_ms).toBe(executionTimeMs);
    });
  });

  describe('detectUserFeedback', () => {
    it('사용자 피드백에서 실패 키워드를 감지해야 함', () => {
      // Given: 실패 키워드가 포함된 피드백
      const toolName = 'test_tool';
      const feedback = '이 도구가 실패했습니다. 오류가 발생했어요.';

      // When: 사용자 피드백 감지
      const result = detector.detectUserFeedback(toolName, feedback);

      // Then: 실패가 감지되어야 함
      expect(result.detected).toBe(true);
      expect(result.event?.error_type).toBe(ErrorType.USER_FEEDBACK);
      expect(result.event?.error_message).toBe(feedback);
    });

    it('영어 실패 키워드를 감지해야 함', () => {
      // Given: 영어 실패 키워드가 포함된 피드백
      const toolName = 'test_tool';
      const feedback = 'This tool failed. There was an error.';

      // When: 사용자 피드백 감지
      const result = detector.detectUserFeedback(toolName, feedback);

      // Then: 실패가 감지되어야 함
      expect(result.detected).toBe(true);
      expect(result.event?.error_type).toBe(ErrorType.USER_FEEDBACK);
    });

    it('실패 키워드가 없으면 감지하지 않아야 함', () => {
      // Given: 실패 키워드가 없는 피드백
      const toolName = 'test_tool';
      const feedback = '이 도구가 잘 작동했습니다. 좋아요!';

      // When: 사용자 피드백 감지
      const result = detector.detectUserFeedback(toolName, feedback);

      // Then: 실패가 감지되지 않아야 함
      expect(result.detected).toBe(false);
      expect(result.reason).toContain('실패 키워드가 감지되지 않음');
    });

    it('사용자 피드백에서 task_goal을 추출해야 함', () => {
      // Given: task_goal이 포함된 피드백
      const toolName = 'test_tool';
      const feedback = '이 도구가 실패했습니다.';
      const params = { task_goal: '데이터베이스 백업' };

      // When: 사용자 피드백 감지
      const result = detector.detectUserFeedback(toolName, feedback, params);

      // Then: original_task가 설정되어야 함
      expect(result.detected).toBe(true);
      expect(result.event?.original_task).toBe('데이터베이스 백업');
    });
  });

  describe('detectPerformanceFailure', () => {
    it('응답 시간 임계값 초과를 감지해야 함', () => {
      // Given: 응답 시간이 임계값을 초과하는 경우
      const toolName = 'test_tool';
      const executionTimeMs = 6000; // 6초 (임계값 5초 초과)
      const thresholds: PerformanceThresholds = {
        responseTimeMs: 5000,
        errorRate: 0.1
      };
      const detectorWithThresholds = new FailureDetector(eventQueue, thresholds);

      // When: 성능 지표 감지
      const result = detectorWithThresholds.detectPerformanceFailure(
        toolName,
        executionTimeMs,
        true
      );

      // Then: 실패가 감지되어야 함
      expect(result.detected).toBe(true);
      expect(result.event?.error_type).toBe(ErrorType.METRIC_FAILURE);
      expect(result.event?.error_message).toContain('응답 시간 임계값 초과');
    });

    it('에러율 임계값 초과를 감지해야 함', () => {
      // Given: 에러율이 임계값을 초과하는 경우
      const toolName = 'test_tool';
      const thresholds: PerformanceThresholds = {
        responseTimeMs: 5000,
        errorRate: 0.1 // 10%
      };
      const detectorWithThresholds = new FailureDetector(eventQueue, thresholds);

      // When: 여러 번 실패하여 에러율이 임계값 초과
      for (let i = 0; i < 15; i++) {
        detectorWithThresholds.detectPerformanceFailure(toolName, 1000, i % 3 === 0); // 33% 실패율
      }

      const result = detectorWithThresholds.detectPerformanceFailure(
        toolName,
        1000,
        false
      );

      // Then: 실패가 감지되어야 함
      expect(result.detected).toBe(true);
      expect(result.event?.error_type).toBe(ErrorType.METRIC_FAILURE);
      expect(result.event?.error_message).toContain('에러율 임계값 초과');
    });

    it('성능 지표가 정상이면 감지하지 않아야 함', () => {
      // Given: 성능 지표가 정상인 경우
      const toolName = 'test_tool';
      const executionTimeMs = 1000; // 1초 (임계값 이내)

      // When: 성능 지표 감지
      const result = detector.detectPerformanceFailure(
        toolName,
        executionTimeMs,
        true
      );

      // Then: 실패가 감지되지 않아야 함
      expect(result.detected).toBe(false);
      expect(result.reason).toContain('성능 지표가 임계값 이내');
    });
  });

  describe('queueFailureEvent', () => {
    it('실패 이벤트를 큐에 추가해야 함', async () => {
      // Given: 실패 이벤트
      const event: FailureEvent = {
        id: 'test_event_1',
        tool_name: 'test_tool',
        error_type: ErrorType.TOOL_ERROR,
        error_message: 'Test error',
        error_message_hash: 'abc123',
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      };
      const handler = vi.fn(async (e: FailureEvent) => {
        expect(e.id).toBe(event.id);
      });

      // When: 큐에 추가
      await detector.startQueue();
      const result = await detector.queueFailureEvent(event, handler);

      // Then: 큐에 추가되어야 함
      expect(result).toBe(true);
      
      // 핸들러가 호출될 때까지 대기
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('중복 이벤트는 큐에 추가하지 않아야 함', async () => {
      // Given: 동일 ID의 실패 이벤트
      const event: FailureEvent = {
        id: 'test_event_1',
        tool_name: 'test_tool',
        error_type: ErrorType.TOOL_ERROR,
        error_message: 'Test error',
        error_message_hash: 'abc123',
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      };
      const handler = vi.fn();

      // When: 동일 이벤트를 두 번 추가
      await detector.startQueue();
      const result1 = await detector.queueFailureEvent(event, handler);
      const result2 = await detector.queueFailureEvent(event, handler);

      // Then: 첫 번째는 성공, 두 번째는 실패해야 함
      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });
  });

  describe('getQueueStats', () => {
    it('큐 통계를 반환해야 함', async () => {
      // Given: 큐가 시작된 상태
      await detector.startQueue();

      // When: 큐 통계 조회
      const stats = detector.getQueueStats();

      // Then: 통계가 반환되어야 함
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('processing');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
    });
  });
});

