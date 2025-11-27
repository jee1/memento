/**
 * Reflexion 기능 E2E 테스트
 * Tool 호출 실패 → 자동 Reflexion 기록 → 동일 작업 재시도 시 개선 방안 적용
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase, createTestMemory } from './helpers/test-database.js';
import { FailureDetector, ErrorType, type FailureEvent } from '../services/failure-detector.js';
import { ReflexionWorker } from '../services/reflexion-worker.js';
import { DatabaseUtils } from '../utils/database.js';

describe('Reflexion E2E 테스트', () => {
  let db: Database.Database;
  let detector: FailureDetector;
  let worker: ReflexionWorker;

  beforeEach(async () => {
    db = await setupTestDatabase();
    detector = new FailureDetector();
    worker = new ReflexionWorker(detector, db);
    await detector.startQueue();
    await worker.start();
  });

  afterEach(async () => {
    await worker.stop();
    await detector.stopQueue();
    cleanupTestDatabase(db);
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('전체 워크플로우', () => {
    it('Tool 호출 실패 → 자동 Reflexion 기록 → 동일 작업 재시도 시 개선 방안 적용', async () => {
      // Given: Tool 호출 실패 시나리오
      const taskGoal = '사용자 인증 시스템 구현';
      const toolName = 'remember_tool';
      
      // Step 1: 첫 번째 실패 이벤트 발생
      const firstFailure: FailureEvent = {
        id: 'e2e_failure_1',
        tool_name: toolName,
        error_type: ErrorType.TOOL_ERROR,
        error_message: 'Database connection timeout',
        error_message_hash: 'hash1',
        timestamp: new Date().toISOString(),
        context: {
          params: { task_goal: taskGoal, content: '사용자 인증 구현' },
          execution_time_ms: 6000
        },
        original_task: taskGoal,
        priority: 5
      };

      // When: 첫 번째 실패 이벤트 처리
      await worker.queueFailureEvent(firstFailure);
      await new Promise(resolve => setTimeout(resolve, 500)); // 처리 완료 대기

      // Then: reflection_notes가 생성되어야 함
      let record = DatabaseUtils.get(
        db,
        `SELECT id, reflection_notes FROM memory_item 
         WHERE type = 'procedural' AND task_goal = ? 
         ORDER BY created_at DESC LIMIT 1`,
        [taskGoal]
      ) as { id: string; reflection_notes: string | null } | undefined;

      expect(record).toBeDefined();
      expect(record?.reflection_notes).toBeDefined();

      if (record && record.reflection_notes) {
        const parsed = JSON.parse(record.reflection_notes);
        const notes = Array.isArray(parsed) ? parsed : [parsed];
        expect(notes.length).toBe(1);
        expect(notes[0].failure_type).toBe('tool_error');
        expect(notes[0].failure_description).toBe('Database connection timeout');
        expect(notes[0].suggested_improvements).toBeDefined();
      }

      // Step 2: 동일 작업의 두 번째 실패 이벤트 발생
      const secondFailure: FailureEvent = {
        id: 'e2e_failure_2',
        tool_name: toolName,
        error_type: ErrorType.TOOL_ERROR,
        error_message: 'Database connection timeout', // 동일한 에러
        error_message_hash: 'hash1', // 동일한 해시
        timestamp: new Date().toISOString(),
        context: {
          params: { task_goal: taskGoal, content: '사용자 인증 구현' },
          execution_time_ms: 5500
        },
        original_task: taskGoal,
        priority: 5
      };

      // When: 두 번째 실패 이벤트 처리
      await worker.queueFailureEvent(secondFailure);
      await new Promise(resolve => setTimeout(resolve, 500)); // 처리 완료 대기

      // Then: reflection_notes가 업데이트되어야 함 (배열로 변환)
      record = DatabaseUtils.get(
        db,
        `SELECT id, reflection_notes FROM memory_item 
         WHERE type = 'procedural' AND task_goal = ? 
         ORDER BY created_at DESC LIMIT 1`,
        [taskGoal]
      ) as { id: string; reflection_notes: string | null } | undefined;

      expect(record).toBeDefined();
      if (record && record.reflection_notes) {
        const parsed = JSON.parse(record.reflection_notes);
        const notes = Array.isArray(parsed) ? parsed : [parsed];
        expect(notes.length).toBe(2); // 두 개의 실패 기록
        
        // 반복 실패 패턴이 분석되어야 함
        expect(notes[0].failure_type).toBe('tool_error');
        expect(notes[1].failure_type).toBe('tool_error');
        
        // 개선 방안이 제안되어야 함
        expect(notes[0].suggested_improvements).toBeDefined();
        expect(notes[1].suggested_improvements).toBeDefined();
      }

      // Step 3: recall Tool로 reflection_notes 조회하여 개선 방안 확인
      const recallRecord = DatabaseUtils.get(
        db,
        `SELECT reflection_notes FROM memory_item 
         WHERE type = 'procedural' AND task_goal = ? 
         ORDER BY created_at DESC LIMIT 1`,
        [taskGoal]
      ) as { reflection_notes: string | null } | undefined;

      expect(recallRecord?.reflection_notes).toBeDefined();
      if (recallRecord && recallRecord.reflection_notes) {
        const parsed = JSON.parse(recallRecord.reflection_notes);
        const notes = Array.isArray(parsed) ? parsed : [parsed];
        
        // 개선 방안이 데이터베이스 관련이어야 함
        const latestNote = notes[notes.length - 1];
        expect(latestNote.suggested_improvements).toContain('데이터베이스');
      }
    });

    it('다양한 에러 타입의 실패를 기록해야 함', async () => {
      // Given: 다양한 에러 타입의 실패 이벤트들
      const taskGoal = '다양한 에러 타입 테스트';
      const failures: FailureEvent[] = [
        {
          id: 'e2e_error_tool',
          tool_name: 'test_tool',
          error_type: ErrorType.TOOL_ERROR,
          error_message: 'Tool execution failed',
          error_message_hash: 'hash_tool',
          timestamp: new Date().toISOString(),
          context: {},
          original_task: taskGoal,
          priority: 5
        },
        {
          id: 'e2e_error_user',
          tool_name: 'test_tool',
          error_type: ErrorType.USER_FEEDBACK,
          error_message: '사용자가 이 도구가 실패했다고 피드백했습니다',
          error_message_hash: 'hash_user',
          timestamp: new Date().toISOString(),
          context: {},
          original_task: taskGoal,
          priority: 8
        },
        {
          id: 'e2e_error_metric',
          tool_name: 'test_tool',
          error_type: ErrorType.METRIC_FAILURE,
          error_message: 'Performance threshold exceeded',
          error_message_hash: 'hash_metric',
          timestamp: new Date().toISOString(),
          context: { execution_time_ms: 6000 },
          original_task: taskGoal,
          priority: 6
        }
      ];

      // When: 모든 실패 이벤트 처리
      for (const failure of failures) {
        await worker.queueFailureEvent(failure);
        await new Promise(resolve => setTimeout(resolve, 200)); // 처리 대기
      }
      await new Promise(resolve => setTimeout(resolve, 500)); // 모든 처리 완료 대기

      // Then: 모든 에러 타입이 기록되어야 함
      const record = DatabaseUtils.get(
        db,
        `SELECT reflection_notes FROM memory_item 
         WHERE type = 'procedural' AND task_goal = ? 
         ORDER BY created_at DESC LIMIT 1`,
        [taskGoal]
      ) as { reflection_notes: string | null } | undefined;

      expect(record?.reflection_notes).toBeDefined();
      if (record && record.reflection_notes) {
        const parsed = JSON.parse(record.reflection_notes);
        const notes = Array.isArray(parsed) ? parsed : [parsed];
        expect(notes.length).toBe(3);
        
        // 각 에러 타입이 올바르게 기록되어야 함
        const errorTypes = notes.map(n => n.failure_type);
        expect(errorTypes).toContain('tool_error');
        expect(errorTypes).toContain('user_feedback');
        expect(errorTypes).toContain('metric_failure');
      }
    });

    it('반복 실패 시 경고를 출력해야 함', async () => {
      // Given: 동일 작업의 반복 실패 이벤트들
      const taskGoal = '반복 실패 경고 테스트';
      const failures: FailureEvent[] = Array.from({ length: 3 }, (_, i) => ({
        id: `e2e_repeat_${i}`,
        tool_name: 'test_tool',
        error_type: ErrorType.TOOL_ERROR,
        error_message: `Error ${i}`,
        error_message_hash: `hash${i}`,
        timestamp: new Date().toISOString(),
        context: {},
        original_task: taskGoal,
        priority: 5
      }));

      // When: 여러 번 실패
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      for (const failure of failures) {
        await worker.queueFailureEvent(failure);
        await new Promise(resolve => setTimeout(resolve, 200)); // 처리 대기
      }
      await new Promise(resolve => setTimeout(resolve, 500)); // 모든 처리 완료 대기

      // Then: 반복 실패 경고가 출력되어야 함
      // (실제로는 logger.warn이 호출되지만, 여기서는 console.warn으로 확인)
      expect(warnSpy).toHaveBeenCalled();
      
      warnSpy.mockRestore();
    });
  });
});
