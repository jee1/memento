/**
 * Procedural Memory Change Detector 테스트
 * 변경 감지 유틸리티 함수들의 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import {
  normalizeJson,
  computeJsonHash,
  createProceduralMemorySnapshot,
  hasProceduralMemoryChanged,
  type ProceduralMemorySnapshot,
} from './procedural-memory-change-detector.js';

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
      edit_count INTEGER DEFAULT 0,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT CHECK (relation_type IN ('cause_of', 'derived_from', 'duplicates', 'contradicts', 'version_of')) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, relation_type)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_item_workflow_name ON memory_item(workflow_name);
    CREATE INDEX IF NOT EXISTS idx_memory_item_skill_name ON memory_item(skill_name);
  `);
}

describe('Procedural Memory Change Detector', () => {
  describe('normalizeJson', () => {
    describe('Given: 정규화 성공 케이스', () => {
      it('When: 객체의 키가 정렬되어야 함, Then: 알파벳 순서로 정렬된 JSON 문자열 반환', () => {
        // Given: 키가 정렬되지 않은 객체
        const input = { z: 1, a: 2, m: 3 };

        // When: JSON 정규화
        const result = normalizeJson(input);

        // Then: 키가 알파벳 순서로 정렬되어야 함
        expect(result).toContain('"a":');
        expect(result.indexOf('"a":')).toBeLessThan(result.indexOf('"m":'));
        expect(result.indexOf('"m":')).toBeLessThan(result.indexOf('"z":'));
      });

      it('When: 배열의 순서가 유지되어야 함, Then: 배열 순서가 보존된 JSON 문자열 반환', () => {
        // Given: 순서가 중요한 배열
        const input = [3, 1, 2];

        // When: JSON 정규화
        const result = normalizeJson(input);

        // Then: 배열 순서가 유지되어야 함
        expect(result).toBe('[3,1,2]');
      });

      it('When: null 값이 처리되어야 함, Then: "null" 문자열 반환', () => {
        // Given: null 값
        const input = null;

        // When: JSON 정규화
        const result = normalizeJson(input);

        // Then: "null" 문자열 반환
        expect(result).toBe('null');
      });

      it('When: 중첩 객체가 정규화되어야 함, Then: 모든 레벨에서 키 정렬', () => {
        // Given: 중첩 객체
        const input = {
          b: { z: 1, a: 2 },
          a: { m: 3, b: 4 },
        };

        // When: JSON 정규화
        const result = normalizeJson(input);

        // Then: 모든 레벨에서 키가 정렬되어야 함
        expect(result.indexOf('"a":')).toBeLessThan(result.indexOf('"b":'));
        // 중첩 객체 내부도 정렬되어야 함 (각 중첩 객체 내부의 키가 정렬됨)
        // "a" 객체 내부: "b"가 "m"보다 먼저
        const aObjStart = result.indexOf('"a":{');
        const aObjEnd = result.indexOf('}', aObjStart);
        const aObjContent = result.substring(aObjStart, aObjEnd);
        expect(aObjContent.indexOf('"b":')).toBeLessThan(aObjContent.indexOf('"m":'));
      });
    });

    describe('Given: 정규화 실패 케이스', () => {
      it('When: undefined 값이 처리되어야 함, Then: "null" 문자열 반환', () => {
        // Given: undefined 값
        const input = undefined;

        // When: JSON 정규화
        const result = normalizeJson(input);

        // Then: "null" 문자열 반환
        expect(result).toBe('null');
      });

      it('When: 객체 내부의 undefined 필드가 제외되어야 함, Then: undefined 필드가 없는 JSON 문자열 반환', () => {
        // Given: undefined 필드를 포함한 객체
        const input = { a: 1, b: undefined, c: 2 };

        // When: JSON 정규화
        const result = normalizeJson(input);

        // Then: undefined 필드가 제외되어야 함
        expect(result).not.toContain('"b":');
        expect(result).toContain('"a":');
        expect(result).toContain('"c":');
      });
    });
  });

  describe('computeJsonHash', () => {
    describe('Given: null/빈 문자열 처리 규칙', () => {
      it('When: jsonString이 null인 경우, Then: "null" 문자열의 해시 반환', () => {
        // Given: null 입력
        const input = null;

        // When: 해시 계산
        const result = computeJsonHash(input);

        // Then: "null" 문자열의 해시 반환
        expect(result).toBe(computeJsonHash('null'));
      });

      it('When: jsonString이 빈 문자열인 경우, Then: 빈 문자열의 해시 반환', () => {
        // Given: 빈 문자열 입력
        const input = '';

        // When: 해시 계산
        const result = computeJsonHash(input);

        // Then: 빈 문자열의 해시 반환 (다른 값과 다름)
        expect(result).not.toBe(computeJsonHash('null'));
        expect(result).toBe(computeJsonHash(''));
      });

      it('When: jsonString이 "null" 문자열인 경우, Then: JSON 파싱 후 정규화된 해시 반환', () => {
        // Given: "null" 문자열 입력
        const input = 'null';

        // When: 해시 계산
        const result = computeJsonHash(input);

        // Then: JSON 파싱 후 정규화된 해시여야 함
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        expect(result.length).toBe(64); // SHA-256 hex 길이
        // "null" 문자열은 JSON.parse하면 null이 되고, normalizeJson(null)은 "null"을 반환하므로
        // null 입력과 같은 해시값을 반환할 수 있음 (이는 정상적인 동작)
        // 하지만 파싱 과정을 거쳤다는 것을 검증
        const nullHash = computeJsonHash(null);
        // 실제로는 같은 해시값이지만, 파싱 과정을 거쳤다는 것을 확인
        expect(result).toBe(nullHash); // JSON.parse("null") === null이므로 같은 해시
      });
    });

    describe('Given: Fallback 동작 검증', () => {
      it('When: 잘못된 JSON 문자열이 입력되면, Then: 원문 문자열의 해시 반환 (fallback)', () => {
        // Given: 잘못된 JSON 문자열
        const input = '{invalid json';

        // When: 해시 계산
        const result = computeJsonHash(input);

        // Then: 원문 문자열의 해시 반환 (fallback)
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        expect(result.length).toBe(64); // SHA-256 hex 길이
        // 같은 잘못된 JSON은 같은 해시를 반환해야 함
        expect(result).toBe(computeJsonHash(input));
      });

      it('When: 유효한 JSON 문자열이 입력되면, Then: 정규화된 JSON의 해시 반환', () => {
        // Given: 유효한 JSON 문자열 (키 순서가 다른 경우)
        const input1 = '{"b":2,"a":1}';
        const input2 = '{"a":1,"b":2}';

        // When: 해시 계산
        const result1 = computeJsonHash(input1);
        const result2 = computeJsonHash(input2);

        // Then: 정규화 후 같은 해시값 반환
        expect(result1).toBe(result2);
      });
    });
  });

  describe('createProceduralMemorySnapshot', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(':memory:');
      initializeTestDatabase(db);
    });

    afterEach(() => {
      db.close();
    });

    describe('Given: 스냅샷 생성 테스트', () => {
      it('When: procedural memory가 존재하면, Then: 스냅샷 생성', () => {
        // Given: procedural memory 생성
        const memoryId = 'test-memory-1';
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content, workflow_name, skill_name, steps, trigger_conditions, task_goal, reflection_notes, edit_count) VALUES (?, 'procedural', 'Test content', 'Test workflow', 'Test skill', '["step1","step2"]', '{"key":"value"}', 'Test goal', '[{"note":"test"}]', 1)`,
          [memoryId]
        );

        // When: 스냅샷 생성
        const snapshot = createProceduralMemorySnapshot(db, memoryId);

        // Then: 스냅샷이 생성되어야 함
        expect(snapshot).not.toBeNull();
        expect(snapshot?.id).toBe(memoryId);
        expect(snapshot?.content).toBe('Test content');
        expect(snapshot?.workflow_name).toBe('Test workflow');
        expect(snapshot?.skill_name).toBe('Test skill');
        expect(snapshot?.steps_hash).toBeDefined();
        expect(snapshot?.trigger_conditions_hash).toBeDefined();
        expect(snapshot?.task_goal).toBe('Test goal');
        expect(snapshot?.reflection_notes_count).toBe(1);
        expect(snapshot?.edit_count).toBe(1);
      });

      it('When: version_of 관계가 있으면, Then: version_of_target_id가 설정됨', () => {
        // Given: procedural memory와 version_of 관계 생성
        const originalId = 'original-memory';
        const versionId = 'version-memory';
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content) VALUES (?, 'procedural', 'Original')`,
          [originalId]
        );
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content) VALUES (?, 'procedural', 'Version')`,
          [versionId]
        );
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_link (source_id, target_id, relation_type) VALUES (?, ?, 'version_of')`,
          [versionId, originalId]
        );

        // When: 버전 메모리의 스냅샷 생성
        const snapshot = createProceduralMemorySnapshot(db, versionId);

        // Then: version_of_target_id가 설정되어야 함
        expect(snapshot).not.toBeNull();
        expect(snapshot?.version_of_target_id).toBe(originalId);
      });

      it('When: procedural memory가 없으면, Then: null 반환', () => {
        // Given: 존재하지 않는 메모리 ID
        const memoryId = 'non-existent';

        // When: 스냅샷 생성
        const snapshot = createProceduralMemorySnapshot(db, memoryId);

        // Then: null 반환
        expect(snapshot).toBeNull();
      });

      it('When: procedural 타입이 아니면, Then: null 반환', () => {
        // Given: episodic 타입 메모리 생성
        const memoryId = 'episodic-memory';
        DatabaseUtils.run(
          db,
          `INSERT INTO memory_item (id, type, content) VALUES (?, 'episodic', 'Test')`,
          [memoryId]
        );

        // When: 스냅샷 생성
        const snapshot = createProceduralMemorySnapshot(db, memoryId);

        // Then: null 반환
        expect(snapshot).toBeNull();
      });
    });
  });

  describe('hasProceduralMemoryChanged', () => {
    describe('Given: 경계값 처리 케이스', () => {
      it('When: before와 after가 모두 null이면, Then: none 타입 반환', () => {
        // Given: 둘 다 null
        const before = null;
        const after = null;

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: none 타입 반환
        expect(result.hasChanged).toBe(false);
        expect(result.changeType).toBe('none');
      });

      it('When: before가 null이고 after가 versioned 모드로 생성되면, Then: version_created 타입 반환', () => {
        // Given: 신규 생성 (versioned 모드)
        const before = null;
        const after: ProceduralMemorySnapshot = {
          id: 'new-memory',
          content: 'Test',
          importance: 0.5,
          privacy_scope: 'private',
          workflow_name: 'Test',
          skill_name: 'Test',
          steps_hash: 'hash',
          trigger_conditions_hash: 'hash',
          task_goal: 'Test',
          reflection_notes_count: 0,
          edit_count: 0,
          version_of_target_id: 'original-id',
        };

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: version_created 타입 반환
        expect(result.hasChanged).toBe(true);
        expect(result.changeType).toBe('version_created');
        expect(result.changedFields).toContain('version_of_target_id');
      });

      it('When: before가 null이고 after가 단순 신규 생성이면, Then: metadata_modified 타입 반환', () => {
        // Given: 신규 생성 (단순)
        const before = null;
        const after: ProceduralMemorySnapshot = {
          id: 'new-memory',
          content: 'Test',
          importance: 0.5,
          privacy_scope: 'private',
          workflow_name: 'Test',
          skill_name: 'Test',
          steps_hash: 'hash',
          trigger_conditions_hash: 'hash',
          task_goal: 'Test',
          reflection_notes_count: 0,
          edit_count: 0,
          version_of_target_id: null,
        };

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: metadata_modified 타입 반환
        expect(result.hasChanged).toBe(true);
        expect(result.changeType).toBe('metadata_modified');
      });

      it('When: before가 있고 after가 null이면, Then: deleted 타입 반환', () => {
        // Given: 삭제
        const before: ProceduralMemorySnapshot = {
          id: 'memory',
          content: 'Test',
          importance: 0.5,
          privacy_scope: 'private',
          workflow_name: 'Test',
          skill_name: 'Test',
          steps_hash: 'hash',
          trigger_conditions_hash: 'hash',
          task_goal: 'Test',
          reflection_notes_count: 0,
          edit_count: 0,
          version_of_target_id: null,
        };
        const after = null;

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: deleted 타입 반환
        expect(result.hasChanged).toBe(true);
        expect(result.changeType).toBe('deleted');
      });
    });

    describe('Given: 모든 changeType 케이스 검증', () => {
      const baseSnapshot: ProceduralMemorySnapshot = {
        id: 'memory',
        content: 'Test',
        importance: 0.5,
        privacy_scope: 'private',
        workflow_name: 'Test',
        skill_name: 'Test',
        steps_hash: 'hash1',
        trigger_conditions_hash: 'hash1',
        task_goal: 'Test',
        reflection_notes_count: 1,
        edit_count: 0,
        version_of_target_id: null,
      };

      it('When: versioned 모드로 새 버전 생성되면, Then: version_created 타입 반환', () => {
        // Given: versioned 모드로 새 버전 생성
        const before = baseSnapshot;
        const after: ProceduralMemorySnapshot = {
          ...baseSnapshot,
          version_of_target_id: 'original-id',
        };

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: version_created 타입 반환
        expect(result.hasChanged).toBe(true);
        expect(result.changeType).toBe('version_created');
        expect(result.changedFields).toContain('version_of_target_id');
      });

      it('When: steps_hash가 변경되면, Then: steps_modified 타입 반환', () => {
        // Given: steps_hash 변경
        const before = baseSnapshot;
        const after: ProceduralMemorySnapshot = {
          ...baseSnapshot,
          steps_hash: 'hash2',
        };

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: steps_modified 타입 반환
        expect(result.hasChanged).toBe(true);
        expect(result.changeType).toBe('steps_modified');
        expect(result.changedFields).toContain('steps_hash');
      });

      it('When: workflow_name이 변경되면, Then: metadata_modified 타입 반환', () => {
        // Given: workflow_name 변경
        const before = baseSnapshot;
        const after: ProceduralMemorySnapshot = {
          ...baseSnapshot,
          workflow_name: 'New Workflow',
        };

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: metadata_modified 타입 반환
        expect(result.hasChanged).toBe(true);
        expect(result.changeType).toBe('metadata_modified');
        expect(result.changedFields).toContain('workflow_name');
      });

      it('When: content가 변경되면, Then: content_modified 타입 반환', () => {
        // Given: content 변경
        const before = baseSnapshot;
        const after: ProceduralMemorySnapshot = {
          ...baseSnapshot,
          content: 'New Content',
        };

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: content_modified 타입 반환
        expect(result.hasChanged).toBe(true);
        expect(result.changeType).toBe('content_modified');
        expect(result.changedFields).toContain('content');
      });

      it('When: reflection_notes_count가 증가하면, Then: reflection_added 타입 반환', () => {
        // Given: reflection_notes_count 증가
        const before = baseSnapshot;
        const after: ProceduralMemorySnapshot = {
          ...baseSnapshot,
          reflection_notes_count: 2,
        };

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: reflection_added 타입 반환
        expect(result.hasChanged).toBe(true);
        expect(result.changeType).toBe('reflection_added');
        expect(result.changedFields).toContain('reflection_notes_count');
      });

      it('When: 모든 필드가 동일하면, Then: none 타입 반환', () => {
        // Given: 동일한 스냅샷
        const before = baseSnapshot;
        const after = baseSnapshot;

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: none 타입 반환
        expect(result.hasChanged).toBe(false);
        expect(result.changeType).toBe('none');
        expect(result.changedFields).toHaveLength(0);
      });

      it('When: edit_count만 변경되면, Then: metadata_modified 타입 반환', () => {
        // Given: edit_count만 변경
        const before = baseSnapshot;
        const after: ProceduralMemorySnapshot = {
          ...baseSnapshot,
          edit_count: 1,
        };

        // When: 변경 감지
        const result = hasProceduralMemoryChanged(before, after);

        // Then: metadata_modified 타입 반환
        expect(result.hasChanged).toBe(true);
        expect(result.changeType).toBe('metadata_modified');
        expect(result.changedFields).toContain('edit_count');
      });
    });
  });
});

