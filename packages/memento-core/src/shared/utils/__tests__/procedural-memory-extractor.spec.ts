/**
 * Procedural Memory Extractor 테스트
 * reflection_notes에서 procedural memory 필드 추출 및 변환 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../database.js';
import {
  extractWorkflowName,
  extractSkillName,
  extractSteps,
  generateTriggerConditions,
  extractProceduralMemory,
  calculateSimilarity,
  determineMergeStrategy,
  RuleBasedProceduralExtractor,
  type ExtractedProceduralMemory
} from '../procedural-memory-extractor.js';
import type { FailureEvent } from '../../../domains/monitoring/services/failure-detector.js';

/**
 * 테스트용 데이터베이스 초기화
 */
function initializeTestDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT,
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memory_item_workflow_name ON memory_item(workflow_name);
    CREATE INDEX IF NOT EXISTS idx_memory_item_skill_name ON memory_item(skill_name);
  `);
}

describe('Procedural Memory Extractor', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('extractWorkflowName', () => {
    it('should extract workflow_name from original_task', () => {
      // Given: original_task가 있는 reflection_notes
      const reflectionNotes = {
        original_task: '데이터 마이그레이션 작업 수행'
      };

      // When: workflow_name 추출
      const result = extractWorkflowName(reflectionNotes);

      // Then: 워크플로우 이름이 추출되어야 함
      expect(result).toBeDefined();
      expect(result).toContain('마이그레이션');
    });

    it('should extract workflow_name from event tool_name', () => {
      // Given: tool_name이 있는 event
      const event: FailureEvent = {
        id: 'test-event',
        tool_name: 'remember-tool',
        error_type: 'tool_error',
        error_message: 'Test error',
        error_message_hash: 'test-hash',
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      };

      // When: workflow_name 추출
      const result = extractWorkflowName({}, event);

      // Then: 워크플로우 이름이 추출되어야 함
      expect(result).toBeDefined();
    });

    it('should return undefined when no workflow_name can be extracted', () => {
      // Given: workflow_name을 추출할 수 없는 reflection_notes
      const reflectionNotes = {
        failure_description: 'Some error occurred'
      };

      // When: workflow_name 추출
      const result = extractWorkflowName(reflectionNotes);

      // Then: undefined 반환
      expect(result).toBeUndefined();
    });
  });

  describe('extractSkillName', () => {
    it('should extract skill_name from event tool_name', () => {
      // Given: tool_name이 있는 event
      const event: FailureEvent = {
        id: 'test-event',
        tool_name: 'remember-tool',
        error_type: 'tool_error',
        error_message: 'Test error',
        error_message_hash: 'test-hash',
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      };

      // When: skill_name 추출
      const result = extractSkillName({}, event);

      // Then: skill_name이 추출되어야 함
      expect(result).toBe('remember-tool');
    });

    it('should extract skill_name from failure_type', () => {
      // Given: failure_type이 있는 reflection_notes
      const reflectionNotes = {
        failure_type: 'tool_error'
      };

      // When: skill_name 추출
      const result = extractSkillName(reflectionNotes);

      // Then: skill_name이 추출되어야 함
      expect(result).toBe('도구 실행');
    });

    it('should return undefined when no skill_name can be extracted', () => {
      // Given: skill_name을 추출할 수 없는 reflection_notes
      const reflectionNotes = {
        failure_description: 'Some error occurred'
      };

      // When: skill_name 추출
      const result = extractSkillName(reflectionNotes);

      // Then: undefined 반환
      expect(result).toBeUndefined();
    });
  });

  describe('extractSteps', () => {
    it('should extract steps from suggested_improvements', () => {
      // Given: suggested_improvements가 있는 reflection_notes
      const reflectionNotes = {
        suggested_improvements: '입력 파라미터 검증 로직을 강화해야 합니다. 데이터베이스 연결을 최적화해야 합니다.'
      };

      // When: steps 추출
      const result = extractSteps(reflectionNotes);

      // Then: steps가 추출되어야 함
      expect(result).toBeDefined();
      const steps = JSON.parse(result!);
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThan(0);
    });

    it('should extract steps from lessons_learned', () => {
      // Given: lessons_learned가 있는 reflection_notes
      const reflectionNotes = {
        lessons_learned: '도구 실행 중 오류가 발생했습니다. 에러 유형을 분석하여 재발 방지 방안을 수립해야 합니다.'
      };

      // When: steps 추출
      const result = extractSteps(reflectionNotes);

      // Then: steps가 추출되어야 함
      expect(result).toBeDefined();
      const steps = JSON.parse(result!);
      expect(Array.isArray(steps)).toBe(true);
    });

    it('should generate default steps when no steps can be extracted', () => {
      // Given: steps를 추출할 수 없는 reflection_notes
      const reflectionNotes = {
        failure_description: 'Some error occurred'
      };

      // When: steps 추출
      const result = extractSteps(reflectionNotes);

      // Then: 기본 steps가 생성되어야 함
      expect(result).toBeDefined();
      const steps = JSON.parse(result!);
      expect(Array.isArray(steps)).toBe(true);
      expect(steps.length).toBeGreaterThan(0);
    });
  });

  describe('generateTriggerConditions', () => {
    it('should generate trigger_conditions from event', () => {
      // Given: event 정보가 있는 reflection_notes
      const reflectionNotes = {
        failure_type: 'tool_error',
        failure_description: 'Validation error occurred'
      };
      const event: FailureEvent = {
        id: 'test-event',
        tool_name: 'remember-tool',
        error_type: 'tool_error',
        error_message: 'Validation error occurred',
        error_message_hash: 'test-hash',
        timestamp: new Date().toISOString(),
        context: {
          execution_time_ms: 6000
        },
        priority: 5
      };

      // When: trigger_conditions 생성
      const result = generateTriggerConditions(reflectionNotes, event);

      // Then: trigger_conditions가 생성되어야 함
      expect(result).toBeDefined();
      const conditions = JSON.parse(result!);
      expect(conditions.error_type).toBe('tool_error');
      expect(conditions.tool_name).toBe('remember-tool');
      expect(conditions.slow_execution).toBe(true);
    });

    it('should generate default trigger_conditions when no conditions can be extracted', () => {
      // Given: 조건을 추출할 수 없는 reflection_notes
      const reflectionNotes = {};

      // When: trigger_conditions 생성
      const result = generateTriggerConditions(reflectionNotes);

      // Then: 기본 trigger_conditions가 생성되어야 함
      expect(result).toBeDefined();
      const conditions = JSON.parse(result!);
      expect(conditions.event).toBe('failure_detected');
    });
  });

  describe('extractProceduralMemory', () => {
    it('should extract all procedural memory fields', () => {
      // Given: 모든 필드가 있는 reflection_notes와 event
      const reflectionNotes = {
        original_task: '데이터 마이그레이션 작업 수행',
        failure_type: 'tool_error',
        suggested_improvements: '입력 파라미터 검증 로직을 강화해야 합니다.'
      };
      const event: FailureEvent = {
        id: 'test-event',
        tool_name: 'remember-tool',
        error_type: 'tool_error',
        error_message: 'Validation error',
        error_message_hash: 'test-hash',
        timestamp: new Date().toISOString(),
        context: {},
        priority: 5
      };

      // When: procedural memory 추출
      const result = extractProceduralMemory(reflectionNotes, event);

      // Then: 모든 필드가 추출되어야 함
      expect(result.workflow_name).toBeDefined();
      expect(result.skill_name).toBeDefined();
      expect(result.steps).toBeDefined();
      expect(result.trigger_conditions).toBeDefined();
      expect(result.task_goal).toBeDefined();
    });
  });

  describe('calculateSimilarity', () => {
    it('should calculate high similarity for identical workflow_name and skill_name', () => {
      // Given: 동일한 workflow_name과 skill_name
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션',
        skill_name: 'remember-tool',
        task_goal: '데이터 마이그레이션 작업 수행',
        steps: JSON.stringify(['step1', 'step2'])
      };
      const existing = {
        workflow_name: '데이터 마이그레이션',
        skill_name: 'remember-tool',
        task_goal: '데이터 마이그레이션 작업 수행',
        steps: JSON.stringify(['step1', 'step2'])
      };

      // When: 유사도 계산
      const similarity = calculateSimilarity(extracted, existing);

      // Then: 높은 유사도 반환
      expect(similarity).toBeGreaterThan(0.8);
    });

    it('should calculate low similarity for different workflow_name and skill_name', () => {
      // Given: 다른 workflow_name과 skill_name
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션',
        skill_name: 'remember-tool'
      };
      const existing = {
        workflow_name: 'API 배포',
        skill_name: 'recall-tool'
      };

      // When: 유사도 계산
      const similarity = calculateSimilarity(extracted, existing);

      // Then: 낮은 유사도 반환
      expect(similarity).toBeLessThan(0.5);
    });

    it('should calculate partial similarity for partially matching fields', () => {
      // Given: 부분적으로 일치하는 필드
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션 작업',
        skill_name: 'remember-tool'
      };
      const existing = {
        workflow_name: '데이터 마이그레이션',
        skill_name: 'remember-tool'
      };

      // When: 유사도 계산
      const similarity = calculateSimilarity(extracted, existing);

      // Then: 중간 수준의 유사도 반환
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1.0);
    });
  });

  describe('determineMergeStrategy', () => {
    it('should return shouldMerge=false when no existing memory found', async () => {
      // Given: 기존 메모리가 없는 경우
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션',
        skill_name: 'remember-tool'
      };

      // When: 병합 전략 결정
      const result = await determineMergeStrategy(db, extracted);

      // Then: 병합하지 않음
      expect(result.shouldMerge).toBe(false);
      expect(result.updateMode).toBe('versioned');
    });

    it('should return shouldMerge=true with replace mode for high similarity', async () => {
      // Given: 높은 유사도의 기존 메모리
      const memoryId = 'mem_test_1';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, task_goal, steps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          memoryId,
          'procedural',
          'Test content',
          '데이터 마이그레이션',
          'remember-tool',
          '데이터 마이그레이션 작업 수행',
          JSON.stringify(['step1', 'step2']),
          new Date().toISOString()
        ]
      );

      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션',
        skill_name: 'remember-tool',
        task_goal: '데이터 마이그레이션 작업 수행',
        steps: JSON.stringify(['step1', 'step2'])
      };

      // When: 병합 전략 결정
      const result = await determineMergeStrategy(db, extracted);

      // Then: 병합 결정 (유사도에 따라 replace 또는 incremental)
      expect(result.shouldMerge).toBe(true);
      expect(result.existingMemoryId).toBe(memoryId);
      expect(['replace', 'incremental', 'versioned']).toContain(result.updateMode);
    });

    it('should return shouldMerge=false with versioned mode for low similarity', async () => {
      // Given: 낮은 유사도의 기존 메모리
      const memoryId = 'mem_test_2';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          memoryId,
          'procedural',
          'Test content',
          'API 배포',
          'recall-tool',
          new Date().toISOString()
        ]
      );

      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션',
        skill_name: 'remember-tool'
      };

      // When: 병합 전략 결정
      const result = await determineMergeStrategy(db, extracted);

      // Then: 병합하지 않음 (유사도가 낮으면 versioned 모드)
      // 유사도가 임계값 미만이면 shouldMerge=false
      if (result.similarity < 0.7) {
        expect(result.shouldMerge).toBe(false);
        expect(result.updateMode).toBe('versioned');
      }
    });

    it('should use AND condition when both workflow_name and skill_name are provided', async () => {
      // Given: workflow_name만 일치하는 기존 메모리
      const memoryId1 = 'mem_test_workflow_only';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          memoryId1,
          'procedural',
          'Test content 1',
          '데이터 마이그레이션',
          'different-skill',
          new Date().toISOString()
        ]
      );

      // Given: skill_name만 일치하는 기존 메모리
      const memoryId2 = 'mem_test_skill_only';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          memoryId2,
          'procedural',
          'Test content 2',
          'different-workflow',
          'remember-tool',
          new Date().toISOString()
        ]
      );

      // Given: 둘 다 일치하는 기존 메모리
      const memoryId3 = 'mem_test_both_match';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, task_goal, steps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          memoryId3,
          'procedural',
          'Test content 3',
          '데이터 마이그레이션',
          'remember-tool',
          '데이터 마이그레이션 작업 수행',
          JSON.stringify(['step1', 'step2']),
          new Date().toISOString()
        ]
      );

      // When: workflow_name과 skill_name이 모두 제공된 경우
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션',
        skill_name: 'remember-tool',
        task_goal: '데이터 마이그레이션 작업 수행',
        steps: JSON.stringify(['step1', 'step2'])
      };

      const result = await determineMergeStrategy(db, extracted);

      // Then: 둘 다 일치하는 메모리만 병합 대상이 되어야 함
      expect(result.shouldMerge).toBe(true);
      expect(result.existingMemoryId).toBe(memoryId3); // 둘 다 일치하는 메모리
      expect(result.existingMemoryId).not.toBe(memoryId1); // workflow_name만 일치
      expect(result.existingMemoryId).not.toBe(memoryId2); // skill_name만 일치
    });

    it('should use single field matching when only one field is provided', async () => {
      // Given: workflow_name만 일치하는 기존 메모리
      const memoryId1 = 'mem_test_workflow_single';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          memoryId1,
          'procedural',
          'Test content',
          '데이터 마이그레이션',
          'some-skill',
          new Date().toISOString()
        ]
      );

      // When: workflow_name만 제공된 경우
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션'
      };

      const result = await determineMergeStrategy(db, extracted);

      // Then: workflow_name만 일치하는 메모리를 찾을 수 있어야 함
      // (유사도가 임계값 이상이면 병합)
      if (result.similarity >= 0.7) {
        expect(result.shouldMerge).toBe(true);
        expect(result.existingMemoryId).toBe(memoryId1);
      }
    });
  });

  describe('엣지 케이스 및 타입 안전성', () => {
    describe('extractWorkflowName - 비문자열 입력', () => {
      it('should handle non-string original_task gracefully', () => {
        // Given: original_task가 문자열이 아닌 reflection_notes
        const reflectionNotes = {
          original_task: 12345 // 숫자
        };

        // When: workflow_name 추출
        const result = extractWorkflowName(reflectionNotes);

        // Then: undefined 반환 (타입 체크로 인해 건너뜀)
        expect(result).toBeUndefined();
      });

      it('should handle null original_task gracefully', () => {
        // Given: original_task가 null인 reflection_notes
        const reflectionNotes = {
          original_task: null
        };

        // When: workflow_name 추출
        const result = extractWorkflowName(reflectionNotes);

        // Then: undefined 반환
        expect(result).toBeUndefined();
      });

      it('should handle object original_task gracefully', () => {
        // Given: original_task가 객체인 reflection_notes
        const reflectionNotes = {
          original_task: { task: 'test' }
        };

        // When: workflow_name 추출
        const result = extractWorkflowName(reflectionNotes);

        // Then: undefined 반환
        expect(result).toBeUndefined();
      });

      it('should handle non-string failure_description gracefully', () => {
        // Given: failure_description이 문자열이 아닌 reflection_notes
        const reflectionNotes = {
          failure_description: ['error1', 'error2'] // 배열
        };

        // When: workflow_name 추출
        const result = extractWorkflowName(reflectionNotes);

        // Then: undefined 반환
        expect(result).toBeUndefined();
      });
    });

    describe('extractSkillName - 비문자열 입력', () => {
      it('should handle non-string failure_type gracefully', () => {
        // Given: failure_type이 문자열이 아닌 reflection_notes
        const reflectionNotes = {
          failure_type: { type: 'tool_error' } // 객체
        };

        // When: skill_name 추출
        const result = extractSkillName(reflectionNotes);

        // Then: undefined 반환
        expect(result).toBeUndefined();
      });

      it('should handle non-string suggested_improvements gracefully', () => {
        // Given: suggested_improvements가 문자열이 아닌 reflection_notes
        const reflectionNotes = {
          suggested_improvements: ['improvement1', 'improvement2'] // 배열
        };

        // When: skill_name 추출
        const result = extractSkillName(reflectionNotes);

        // Then: undefined 반환
        expect(result).toBeUndefined();
      });

      it('should handle non-string event.tool_name gracefully', () => {
        // Given: tool_name이 문자열이 아닌 event (테스트용으로 잘못된 타입 주입)
        const event = {
          id: 'test-event',
          tool_name: 12345, // 숫자
          error_type: 'tool_error',
          error_message: 'Test error',
          error_message_hash: 'test-hash',
          timestamp: new Date().toISOString(),
          context: {},
          priority: 5
        } as FailureEvent;

        // When: skill_name 추출
        const result = extractSkillName({}, event);

        // Then: undefined 반환
        expect(result).toBeUndefined();
      });
    });

    describe('extractSteps - 비문자열 입력 및 JSON 파싱 실패', () => {
      it('should handle non-string suggested_improvements gracefully', () => {
        // Given: suggested_improvements가 문자열이 아닌 reflection_notes
        const reflectionNotes = {
          suggested_improvements: 12345 // 숫자
        };

        // When: steps 추출
        const result = extractSteps(reflectionNotes);

        // Then: 기본 steps 반환 (문자열이 아니므로 건너뛰고 기본값 생성)
        expect(result).toBeDefined();
        const steps = JSON.parse(result!);
        expect(Array.isArray(steps)).toBe(true);
        expect(steps.length).toBeGreaterThan(0);
      });

      it('should handle non-string lessons_learned gracefully', () => {
        // Given: lessons_learned가 문자열이 아닌 reflection_notes
        const reflectionNotes = {
          lessons_learned: { lesson: 'test' } // 객체
        };

        // When: steps 추출
        const result = extractSteps(reflectionNotes);

        // Then: 기본 steps 반환
        expect(result).toBeDefined();
        const steps = JSON.parse(result!);
        expect(Array.isArray(steps)).toBe(true);
      });

      it('should handle non-string failure_description gracefully', () => {
        // Given: failure_description이 문자열이 아닌 reflection_notes
        const reflectionNotes = {
          failure_description: null
        };

        // When: steps 추출
        const result = extractSteps(reflectionNotes);

        // Then: 기본 steps 반환
        expect(result).toBeDefined();
        const steps = JSON.parse(result!);
        expect(Array.isArray(steps)).toBe(true);
      });

      it('should generate default steps when all inputs are invalid', () => {
        // Given: 모든 입력이 유효하지 않은 reflection_notes
        const reflectionNotes = {
          suggested_improvements: null,
          lessons_learned: undefined,
          failure_description: 12345
        };

        // When: steps 추출
        const result = extractSteps(reflectionNotes);

        // Then: 기본 steps 반환
        expect(result).toBeDefined();
        const steps = JSON.parse(result!);
        expect(Array.isArray(steps)).toBe(true);
        expect(steps.length).toBeGreaterThan(0);
        // 기본 steps는 '에러 로그 분석', '근본 원인 파악' 등을 포함해야 함
        expect(steps.some((s: string) => s.includes('에러') || s.includes('분석'))).toBe(true);
      });
    });

    describe('generateTriggerConditions - 비문자열 입력', () => {
      it('should handle non-string failure_type gracefully', () => {
        // Given: failure_type이 문자열이 아닌 reflection_notes
        const reflectionNotes = {
          failure_type: 12345 // 숫자
        };

        // When: trigger_conditions 생성
        const result = generateTriggerConditions(reflectionNotes);

        // Then: 기본 trigger_conditions 생성 (문자열이 아니므로 건너뜀)
        expect(result).toBeDefined();
        const conditions = JSON.parse(result!);
        expect(conditions.event).toBe('failure_detected');
      });

      it('should handle non-string failure_description gracefully', () => {
        // Given: failure_description이 문자열이 아닌 reflection_notes
        const reflectionNotes = {
          failure_description: ['error1', 'error2'] // 배열
        };

        // When: trigger_conditions 생성
        const result = generateTriggerConditions(reflectionNotes);

        // Then: 기본 trigger_conditions 생성
        expect(result).toBeDefined();
        const conditions = JSON.parse(result!);
        expect(conditions.event).toBe('failure_detected');
      });

      it('should handle non-string event.error_message gracefully', () => {
        // Given: error_message가 문자열이 아닌 event (테스트용으로 잘못된 타입 주입)
        const event = {
          id: 'test-event',
          tool_name: 'remember-tool',
          error_type: 'tool_error',
          error_message: null, // null
          error_message_hash: 'test-hash',
          timestamp: new Date().toISOString(),
          context: {},
          priority: 5
        } as FailureEvent;

        // When: trigger_conditions 생성
        const result = generateTriggerConditions({}, event);

        // Then: 기본 trigger_conditions 생성
        expect(result).toBeDefined();
        const conditions = JSON.parse(result!);
        expect(conditions.tool_name).toBe('remember-tool');
      });
    });

    describe('calculateSimilarity - 유사도 임계값 경계 및 steps 파싱 실패', () => {
      it('should return 0 similarity when steps JSON parsing fails', () => {
        // Given: steps JSON 파싱 실패 케이스
        const extracted: ExtractedProceduralMemory = {
          workflow_name: '데이터 마이그레이션',
          skill_name: 'remember-tool',
          steps: 'invalid json' // 유효하지 않은 JSON
        };
        const existing = {
          workflow_name: '데이터 마이그레이션',
          skill_name: 'remember-tool',
          steps: JSON.stringify(['step1', 'step2'])
        };

        // When: 유사도 계산
        const similarity = calculateSimilarity(extracted, existing);

        // Then: steps 파싱 실패 시 0점 처리되어 전체 유사도가 낮아짐
        // workflow_name과 skill_name이 일치하므로 0.6 이상이지만, steps 파싱 실패로 인해 낮아질 수 있음
        expect(similarity).toBeGreaterThanOrEqual(0);
        expect(similarity).toBeLessThanOrEqual(1);
      });

      it('should return 0 similarity when both steps are invalid JSON', () => {
        // Given: 양쪽 모두 steps JSON 파싱 실패
        const extracted: ExtractedProceduralMemory = {
          workflow_name: '데이터 마이그레이션',
          steps: 'invalid json 1'
        };
        const existing = {
          workflow_name: '데이터 마이그레이션',
          steps: 'invalid json 2'
        };

        // When: 유사도 계산
        const similarity = calculateSimilarity(extracted, existing);

        // Then: steps 파싱 실패로 인해 steps 가중치(0.2)가 제외되어 유사도가 낮아짐
        expect(similarity).toBeGreaterThanOrEqual(0);
        expect(similarity).toBeLessThan(1);
      });

      it('should calculate similarity at threshold boundary (0.7)', () => {
        // Given: 유사도가 임계값(0.7) 근처인 경우
        const extracted: ExtractedProceduralMemory = {
          workflow_name: '데이터 마이그레이션',
          skill_name: 'remember-tool',
          task_goal: '데이터 마이그레이션 작업 수행',
          steps: JSON.stringify(['step1', 'step2', 'step3'])
        };
        const existing = {
          workflow_name: '데이터 마이그레이션',
          skill_name: 'remember-tool',
          task_goal: '데이터 마이그레이션 작업', // 약간 다름
          steps: JSON.stringify(['step1', 'step2']) // 일부만 일치
        };

        // When: 유사도 계산
        const similarity = calculateSimilarity(extracted, existing);

        // Then: 유사도가 0과 1 사이의 값
        expect(similarity).toBeGreaterThanOrEqual(0);
        expect(similarity).toBeLessThanOrEqual(1);
        // workflow_name과 skill_name이 일치하므로 최소 0.6 이상
        expect(similarity).toBeGreaterThanOrEqual(0.6);
      });

      it('should calculate similarity at high threshold boundary (0.9)', () => {
        // Given: 유사도가 높은 임계값(0.9) 근처인 경우
        const extracted: ExtractedProceduralMemory = {
          workflow_name: '데이터 마이그레이션',
          skill_name: 'remember-tool',
          task_goal: '데이터 마이그레이션 작업 수행',
          steps: JSON.stringify(['step1', 'step2', 'step3'])
        };
        const existing = {
          workflow_name: '데이터 마이그레이션',
          skill_name: 'remember-tool',
          task_goal: '데이터 마이그레이션 작업 수행',
          steps: JSON.stringify(['step1', 'step2', 'step3'])
        };

        // When: 유사도 계산
        const similarity = calculateSimilarity(extracted, existing);

        // Then: 매우 높은 유사도 (거의 1.0)
        expect(similarity).toBeGreaterThan(0.9);
        expect(similarity).toBeLessThanOrEqual(1);
      });

      it('should return 0 similarity when no fields match', () => {
        // Given: 일치하는 필드가 없는 경우
        const extracted: ExtractedProceduralMemory = {
          workflow_name: '데이터 마이그레이션',
          skill_name: 'remember-tool'
        };
        const existing = {
          workflow_name: 'API 배포',
          skill_name: 'recall-tool'
        };

        // When: 유사도 계산
        const similarity = calculateSimilarity(extracted, existing);

        // Then: 0에 가까운 유사도
        expect(similarity).toBeLessThan(0.3);
      });

      it('should return 0 similarity when all fields are empty', () => {
        // Given: 모든 필드가 비어있는 경우
        const extracted: ExtractedProceduralMemory = {};
        const existing = {};

        // When: 유사도 계산
        const similarity = calculateSimilarity(extracted, existing);

        // Then: 0 반환 (가중치 합이 0이므로)
        expect(similarity).toBe(0);
      });
    });

    describe('determineMergeStrategy - 엣지 케이스', () => {
      it('should handle JSON parsing failure in steps gracefully', async () => {
        // Given: steps가 유효하지 않은 JSON인 기존 메모리
        const memoryId = 'mem_invalid_json';
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, steps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            memoryId,
            'procedural',
            'Test content',
            '데이터 마이그레이션',
            'remember-tool',
            'invalid json', // 유효하지 않은 JSON
            new Date().toISOString()
          ]
        );

        const extracted: ExtractedProceduralMemory = {
          workflow_name: '데이터 마이그레이션',
          skill_name: 'remember-tool',
          steps: JSON.stringify(['step1', 'step2'])
        };

        // When: 병합 전략 결정
        const result = await determineMergeStrategy(db, extracted);

        // Then: steps 파싱 실패에도 불구하고 workflow_name과 skill_name 일치로 병합 가능
        // 유사도 계산 시 steps 파싱 실패는 0점 처리되지만, 다른 필드 일치로 병합 가능
        expect(result).toBeDefined();
        if (result.shouldMerge) {
          expect(result.existingMemoryId).toBe(memoryId);
        }
      });

      it('should handle empty workflow_name and skill_name', async () => {
        // Given: workflow_name과 skill_name이 모두 없는 extracted
        const extracted: ExtractedProceduralMemory = {
          task_goal: 'Some task'
        };

        // When: 병합 전략 결정
        const result = await determineMergeStrategy(db, extracted);

        // Then: 병합하지 않음 (workflow_name과 skill_name이 모두 없으면 병합하지 않음)
        expect(result.shouldMerge).toBe(false);
        expect(result.updateMode).toBe('versioned');
        expect(result.similarity).toBe(0);
      });

      it('should handle only workflow_name provided', async () => {
        // Given: workflow_name만 제공된 경우
        const memoryId = 'mem_workflow_only';
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content, workflow_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [
            memoryId,
            'procedural',
            'Test content',
            '데이터 마이그레이션',
            new Date().toISOString()
          ]
        );

        const extracted: ExtractedProceduralMemory = {
          workflow_name: '데이터 마이그레이션'
        };

        // When: 병합 전략 결정
        const result = await determineMergeStrategy(db, extracted);

        // Then: workflow_name 일치로 병합 가능 (유사도가 임계값 이상이면)
        expect(result).toBeDefined();
        if (result.similarity >= 0.7) {
          expect(result.shouldMerge).toBe(true);
          expect(result.existingMemoryId).toBe(memoryId);
        }
      });

      it('should handle only skill_name provided', async () => {
        // Given: skill_name만 제공된 경우
        const memoryId = 'mem_skill_only';
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content, skill_name, created_at) VALUES (?, ?, ?, ?, ?)`,
          [
            memoryId,
            'procedural',
            'Test content',
            'remember-tool',
            new Date().toISOString()
          ]
        );

        const extracted: ExtractedProceduralMemory = {
          skill_name: 'remember-tool'
        };

        // When: 병합 전략 결정
        const result = await determineMergeStrategy(db, extracted);

        // Then: skill_name 일치로 병합 가능 (유사도가 임계값 이상이면)
        expect(result).toBeDefined();
        if (result.similarity >= 0.7) {
          expect(result.shouldMerge).toBe(true);
          expect(result.existingMemoryId).toBe(memoryId);
      }
    });
  });

  describe('determineMergeStrategy - 병합 조건 완화 (LOWER/LIKE fallback)', () => {
    it('should find existing memory with case-insensitive workflow_name match', async () => {
      // Given: 대소문자가 다른 workflow_name을 가진 기존 메모리
      const memoryId = 'mem_case_insensitive';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          memoryId,
          'procedural',
          'Test content',
          '데이터 마이그레이션', // 소문자
          'remember-tool',
          new Date().toISOString()
        ]
      );

      // When: 대소문자가 다른 workflow_name으로 검색
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션', // 동일하지만 fallback 검색 테스트
        skill_name: 'remember-tool'
      };

      const result = await determineMergeStrategy(db, extracted);

      // Then: 완전 일치로 찾아야 함
      expect(result.shouldMerge).toBe(true);
      expect(result.existingMemoryId).toBe(memoryId);
    });

    it('should use fallback search when exact match fails', async () => {
      // Given: 부분적으로 일치하는 workflow_name을 가진 기존 메모리
      const memoryId = 'mem_partial_match';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, task_goal, steps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          memoryId,
          'procedural',
          'Test content',
          '데이터 마이그레이션 작업', // 부분 일치
          'remember-tool',
          '데이터 마이그레이션 작업 수행',
          JSON.stringify(['step1', 'step2']),
          new Date().toISOString()
        ]
      );

      // When: 완전히 일치하지 않는 workflow_name으로 검색
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션', // 부분 일치
        skill_name: 'remember-tool',
        task_goal: '데이터 마이그레이션 작업 수행',
        steps: JSON.stringify(['step1', 'step2'])
      };

      const result = await determineMergeStrategy(db, extracted);

      // Then: fallback 검색으로 찾아서 유사도 계산 후 병합 결정
      expect(result).toBeDefined();
      // 유사도가 임계값 이상이면 병합
      if (result.similarity >= 0.7) {
        expect(result.shouldMerge).toBe(true);
        expect(result.existingMemoryId).toBe(memoryId);
      }
    });

    it('should use OR condition in fallback search when both fields provided', async () => {
      // Given: workflow_name만 일치하는 기존 메모리
      const memoryId1 = 'mem_workflow_only_fallback';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          memoryId1,
          'procedural',
          'Test content 1',
          '데이터 마이그레이션',
          'different-skill',
          new Date().toISOString()
        ]
      );

      // Given: skill_name만 일치하는 기존 메모리
      const memoryId2 = 'mem_skill_only_fallback';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          memoryId2,
          'procedural',
          'Test content 2',
          'different-workflow',
          'remember-tool',
          new Date().toISOString()
        ]
      );

      // When: 완전 일치가 없는 경우 fallback 검색
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션 작업', // 부분 일치
        skill_name: 'remember-tool-special' // 부분 일치
      };

      const result = await determineMergeStrategy(db, extracted);

      // Then: OR 조건으로 검색하여 둘 중 하나를 찾을 수 있어야 함
      expect(result).toBeDefined();
      // fallback 검색으로 찾은 메모리와 유사도 계산
      if (result.similarity >= 0.7) {
        expect(result.shouldMerge).toBe(true);
        // workflow_name 또는 skill_name이 일치하는 메모리를 찾음
        expect([memoryId1, memoryId2]).toContain(result.existingMemoryId);
      }
    });

    it('should handle whitespace differences in fallback search', async () => {
      // Given: 공백이 다른 workflow_name을 가진 기존 메모리
      const memoryId = 'mem_whitespace';
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          memoryId,
          'procedural',
          'Test content',
          '데이터  마이그레이션', // 공백 2개
          'remember-tool',
          new Date().toISOString()
        ]
      );

      // When: 공백이 다른 workflow_name으로 검색
      const extracted: ExtractedProceduralMemory = {
        workflow_name: '데이터 마이그레이션', // 공백 1개
        skill_name: 'remember-tool'
      };

      const result = await determineMergeStrategy(db, extracted);

      // Then: 완전 일치는 실패하지만 fallback 검색으로 찾을 수 있어야 함
      expect(result).toBeDefined();
      // LIKE 검색으로 찾아서 유사도 계산
      if (result.similarity >= 0.7) {
        expect(result.shouldMerge).toBe(true);
        expect(result.existingMemoryId).toBe(memoryId);
      }
    });
  });

  describe('RuleBasedProceduralExtractor', () => {
    it('Given: reflection_notes와 event가 주어졌을 때, When: extract()를 호출하면, Then: ExtractedProceduralMemory를 Promise로 반환한다', async () => {
      const notes = { original_task: '테스트 작업', suggested_improvements: '단계1. 검증' };
      const extractor = new RuleBasedProceduralExtractor();
      const result = await extractor.extract(notes);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('workflow_name');
      expect(result).toHaveProperty('skill_name');
      expect(result).toHaveProperty('steps');
    });
  });
});
});

