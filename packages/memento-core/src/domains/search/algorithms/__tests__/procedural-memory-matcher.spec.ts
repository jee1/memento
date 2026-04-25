/**
 * ProceduralMemoryMatcher 테스트
 * TDD GREEN 단계: ProceduralMemoryMatcher 클래스 구현 및 테스트 작성
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProceduralMemoryMatcher } from '../procedural-memory-matcher.js';
import Database from 'better-sqlite3';
import type { HybridSearchQuery } from '../hybrid-search-engine.js';

describe('ProceduralMemoryMatcher', () => {
  let matcher: ProceduralMemoryMatcher;
  let db: Database.Database;

  beforeEach(() => {
    // Given: ProceduralMemoryMatcher 인스턴스와 테스트 데이터베이스가 준비됨
    matcher = new ProceduralMemoryMatcher();
    db = new Database(':memory:');
    
    // 테스트 스키마 생성
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_item (
        id TEXT PRIMARY KEY,
        workflow_name TEXT,
        skill_name TEXT,
        trigger_conditions TEXT,
        owner_id TEXT NULL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
      );
    `);
  });

  describe('fetchProceduralMemoryMatches', () => {
    it('Given: 빈 메모리 ID 목록이 제공됨, When: fetchProceduralMemoryMatches를 호출함, Then: 빈 Map을 반환함', () => {
      // Given: 빈 메모리 ID 목록이 제공됨
      const memoryIds: string[] = [];
      const query: HybridSearchQuery = { query: 'test' };
      
      // When: fetchProceduralMemoryMatches를 호출함
      const result = matcher.fetchProceduralMemoryMatches(db, memoryIds, query);
      
      // Then: 빈 Map을 반환함
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('Given: workflow_name이 있는 메모리와 쿼리가 제공됨, When: fetchProceduralMemoryMatches를 호출함, Then: workflow_name_match가 true로 반환됨', () => {
      // Given: workflow_name이 있는 메모리와 쿼리가 제공됨
      const memoryId = 'mem-1';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, '데이터 마이그레이션', null, null);
      
      const query: HybridSearchQuery = { query: '마이그레이션' };
      
      // When: fetchProceduralMemoryMatches를 호출함
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: workflow_name_match가 true로 반환됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match).toBeDefined();
      expect(match?.workflow_name_match).toBe(true);
      expect(match?.skill_name_match).toBe(false);
      expect(match?.trigger_conditions_match).toBe(false);
    });

    it('Given: skill_name이 있는 메모리와 쿼리가 제공됨, When: fetchProceduralMemoryMatches를 호출함, Then: skill_name_match가 true로 반환됨', () => {
      // Given: skill_name이 있는 메모리와 쿼리가 제공됨
      const memoryId = 'mem-2';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, null, '스키마 백업', null);
      
      const query: HybridSearchQuery = { query: '백업' };
      
      // When: fetchProceduralMemoryMatches를 호출함
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: skill_name_match가 true로 반환됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match).toBeDefined();
      expect(match?.workflow_name_match).toBe(false);
      expect(match?.skill_name_match).toBe(true);
      expect(match?.trigger_conditions_match).toBe(false);
    });

    it('Given: trigger_conditions가 있는 메모리와 match_trigger_conditions=true 쿼리가 제공됨, When: fetchProceduralMemoryMatches를 호출함, Then: trigger_conditions_match가 true로 반환됨', () => {
      // Given: trigger_conditions가 있는 메모리와 match_trigger_conditions=true 쿼리가 제공됨
      const memoryId = 'mem-3';
      const triggerConditions = JSON.stringify({ tool_name: 'migration', event: 'start' });
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, null, null, triggerConditions);
      
      const query: HybridSearchQuery = { 
        query: 'migration',
        match_trigger_conditions: true
      };
      
      // When: fetchProceduralMemoryMatches를 호출함
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: trigger_conditions_match가 true로 반환됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match).toBeDefined();
      expect(match?.workflow_name_match).toBe(false);
      expect(match?.skill_name_match).toBe(false);
      expect(match?.trigger_conditions_match).toBe(true);
    });

    it('Given: 모든 필드가 있는 메모리와 쿼리가 제공됨, When: fetchProceduralMemoryMatches를 호출함, Then: 모든 매칭 결과가 true로 반환됨', () => {
      // Given: 모든 필드가 있는 메모리와 쿼리가 제공됨
      const memoryId = 'mem-4';
      const triggerConditions = JSON.stringify({ tool_name: 'migration' });
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, '데이터 마이그레이션', '마이그레이션 스킬', triggerConditions);
      
      const query: HybridSearchQuery = { 
        query: '마이그레이션',
        match_trigger_conditions: true,
        context: { tool_name: 'migration' }
      };
      
      // When: fetchProceduralMemoryMatches를 호출함
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 모든 매칭 결과가 true로 반환됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match).toBeDefined();
      expect(match?.workflow_name_match).toBe(true);
      expect(match?.skill_name_match).toBe(true);
      expect(match?.trigger_conditions_match).toBe(true);
    });

    it('Given: 필터가 있는 쿼리가 제공됨, When: fetchProceduralMemoryMatches를 호출함, Then: 필터와 정확히 일치하는 경우에만 매칭됨', () => {
      // Given: 필터가 있는 쿼리가 제공됨
      const memoryId = 'mem-5';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, '데이터 마이그레이션', null, null);
      
      const query: HybridSearchQuery = { 
        query: 'test',
        filters: { workflow_name: '데이터 마이그레이션' }
      };
      
      // When: fetchProceduralMemoryMatches를 호출함
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 필터와 정확히 일치하는 경우에만 매칭됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match).toBeDefined();
      expect(match?.workflow_name_match).toBe(true);
    });

    it('Given: 존재하지 않는 메모리 ID가 제공됨, When: fetchProceduralMemoryMatches를 호출함, Then: 빈 Map을 반환함', () => {
      // Given: 존재하지 않는 메모리 ID가 제공됨
      const memoryId = 'non-existent';
      const query: HybridSearchQuery = { query: 'test' };
      
      // When: fetchProceduralMemoryMatches를 호출함
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 빈 Map을 반환함
      expect(result.size).toBe(0);
    });

    it('Given: IProceduralMemoryMatcher 인터페이스를 구현함, When: 타입 체크를 수행함, Then: 인터페이스를 올바르게 구현함', () => {
      // Given: IProceduralMemoryMatcher 인터페이스를 구현함
      // When: 타입 체크를 수행함
      const matcherInstance: ProceduralMemoryMatcher = new ProceduralMemoryMatcher();
      
      // Then: 인터페이스를 올바르게 구현함
      expect(matcherInstance).toBeInstanceOf(ProceduralMemoryMatcher);
      expect(typeof matcherInstance.fetchProceduralMemoryMatches).toBe('function');
    });
  });

  describe('extractQueryInfo (embedQuery 분리)', () => {
    it('Given: 쿼리가 제공됨, When: extractQueryInfo를 호출함, Then: 쿼리 텍스트와 필터 정보가 추출됨', () => {
      // Given: 쿼리가 제공됨
      const query: HybridSearchQuery = { 
        query: '테스트 쿼리',
        filters: { workflow_name: '워크플로우', skill_name: '스킬' },
        match_trigger_conditions: true
      };
      
      // When: extractQueryInfo를 호출함 (간접 테스트: fetchProceduralMemoryMatches를 통해)
      const memoryId = 'mem-extract-1';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, '워크플로우', '스킬', null);
      
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 쿼리 텍스트와 필터 정보가 추출되어 매칭에 사용됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.workflow_name_match).toBe(true); // 필터와 정확히 일치
      expect(match?.skill_name_match).toBe(true); // 필터와 정확히 일치
    });

    it('Given: 쿼리만 제공되고 필터가 없음, When: extractQueryInfo를 호출함, Then: 쿼리 텍스트만 추출됨', () => {
      // Given: 쿼리만 제공되고 필터가 없음
      const query: HybridSearchQuery = { query: '마이그레이션' };
      const memoryId = 'mem-extract-2';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, '데이터 마이그레이션', null, null);
      
      // When: extractQueryInfo를 호출함 (간접 테스트)
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 쿼리 텍스트만 추출되어 부분 매칭에 사용됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.workflow_name_match).toBe(true); // 부분 매칭
    });

    it('Given: 쿼리가 없음, When: extractQueryInfo를 호출함, Then: 빈 쿼리 텍스트가 추출됨', () => {
      // Given: 쿼리가 없음
      const query: HybridSearchQuery = {};
      const memoryId = 'mem-extract-3';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, '워크플로우', null, null);
      
      // When: extractQueryInfo를 호출함 (간접 테스트)
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 빈 쿼리 텍스트가 추출되어 매칭되지 않음
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.workflow_name_match).toBe(false); // 쿼리와 필터가 모두 없으면 매칭 안 됨
    });
  });

  describe('fetchProceduralMemoryRows (findCandidates 분리)', () => {
    it('Given: 메모리 ID 목록이 제공됨, When: fetchProceduralMemoryRows를 호출함, Then: 해당 메모리 항목들이 조회됨', () => {
      // Given: 메모리 ID 목록이 제공됨
      const memoryId1 = 'mem-fetch-1';
      const memoryId2 = 'mem-fetch-2';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId1, '워크플로우1', null, null);
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId2, '워크플로우2', null, null);
      
      // When: fetchProceduralMemoryRows를 호출함 (간접 테스트)
      const query: HybridSearchQuery = { query: '워크플로우' };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId1, memoryId2], query);
      
      // Then: 해당 메모리 항목들이 조회됨
      expect(result.size).toBe(2);
      expect(result.has(memoryId1)).toBe(true);
      expect(result.has(memoryId2)).toBe(true);
    });

    it('Given: 존재하지 않는 메모리 ID가 제공됨, When: fetchProceduralMemoryRows를 호출함, Then: 빈 배열이 반환됨', () => {
      // Given: 존재하지 않는 메모리 ID가 제공됨
      const memoryId = 'non-existent-fetch';
      
      // When: fetchProceduralMemoryRows를 호출함 (간접 테스트)
      const query: HybridSearchQuery = { query: 'test' };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 빈 배열이 반환됨
      expect(result.size).toBe(0);
    });

    it('Given: workflow_name, skill_name, trigger_conditions가 모두 null인 메모리가 제공됨, When: fetchProceduralMemoryRows를 호출함, Then: 해당 메모리는 조회되지 않음', () => {
      // Given: workflow_name, skill_name, trigger_conditions가 모두 null인 메모리가 제공됨
      const memoryId = 'mem-fetch-null';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, null, null, null);
      
      // When: fetchProceduralMemoryRows를 호출함 (간접 테스트)
      const query: HybridSearchQuery = { query: 'test' };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 해당 메모리는 조회되지 않음 (SQL WHERE 절에서 필터링됨)
      expect(result.size).toBe(0);
    });
  });

  describe('matchWorkflowName (filterByRelevance 분리 - workflow_name)', () => {
    it('Given: workflow_name과 쿼리가 제공됨, When: matchWorkflowName을 호출함, Then: 부분 매칭이 수행됨', () => {
      // Given: workflow_name과 쿼리가 제공됨
      const memoryId = 'mem-match-workflow-1';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, '데이터 마이그레이션', null, null);
      
      // When: matchWorkflowName을 호출함 (간접 테스트)
      const query: HybridSearchQuery = { query: '마이그레이션' };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 부분 매칭이 수행됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.workflow_name_match).toBe(true);
    });

    it('Given: workflow_name과 필터가 제공됨, When: matchWorkflowName을 호출함, Then: 정확한 일치가 수행됨', () => {
      // Given: workflow_name과 필터가 제공됨
      const memoryId = 'mem-match-workflow-2';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, '데이터 마이그레이션', null, null);
      
      // When: matchWorkflowName을 호출함 (간접 테스트)
      const query: HybridSearchQuery = { 
        query: 'test',
        filters: { workflow_name: '데이터 마이그레이션' }
      };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 정확한 일치가 수행됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.workflow_name_match).toBe(true);
    });

    it('Given: workflow_name이 null임, When: matchWorkflowName을 호출함, Then: 매칭되지 않음', () => {
      // Given: workflow_name이 null임
      const memoryId = 'mem-match-workflow-3';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, null, null, null);
      
      // When: matchWorkflowName을 호출함 (간접 테스트)
      const query: HybridSearchQuery = { query: 'test' };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 매칭되지 않음 (workflow_name이 null이면 SQL에서 필터링됨)
      expect(result.size).toBe(0);
    });
  });

  describe('matchSkillName (filterByRelevance 분리 - skill_name)', () => {
    it('Given: skill_name과 쿼리가 제공됨, When: matchSkillName을 호출함, Then: 부분 매칭이 수행됨', () => {
      // Given: skill_name과 쿼리가 제공됨
      const memoryId = 'mem-match-skill-1';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, null, '스키마 백업', null);
      
      // When: matchSkillName을 호출함 (간접 테스트)
      const query: HybridSearchQuery = { query: '백업' };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 부분 매칭이 수행됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.skill_name_match).toBe(true);
    });

    it('Given: skill_name과 필터가 제공됨, When: matchSkillName을 호출함, Then: 정확한 일치가 수행됨', () => {
      // Given: skill_name과 필터가 제공됨
      const memoryId = 'mem-match-skill-2';
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, null, '스키마 백업', null);
      
      // When: matchSkillName을 호출함 (간접 테스트)
      const query: HybridSearchQuery = { 
        query: 'test',
        filters: { skill_name: '스키마 백업' }
      };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 정확한 일치가 수행됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.skill_name_match).toBe(true);
    });
  });

  describe('matchTriggerConditions (filterByRelevance 분리 - trigger_conditions)', () => {
    it('Given: trigger_conditions와 쿼리가 제공됨, When: matchTriggerConditions를 호출함, Then: 키 또는 값 매칭이 수행됨', () => {
      // Given: trigger_conditions와 쿼리가 제공됨
      const memoryId = 'mem-match-trigger-1';
      const triggerConditions = JSON.stringify({ tool_name: 'migration', event: 'start' });
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, null, null, triggerConditions);
      
      // When: matchTriggerConditions를 호출함 (간접 테스트)
      const query: HybridSearchQuery = { 
        query: 'migration',
        match_trigger_conditions: true
      };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 키 또는 값 매칭이 수행됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.trigger_conditions_match).toBe(true);
    });

    it('Given: trigger_conditions와 컨텍스트가 제공됨, When: matchTriggerConditions를 호출함, Then: 모든 키-값 쌍이 매칭됨', () => {
      // Given: trigger_conditions와 컨텍스트가 제공됨
      const memoryId = 'mem-match-trigger-2';
      const triggerConditions = JSON.stringify({ tool_name: 'migration', event: 'start' });
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, null, null, triggerConditions);
      
      // When: matchTriggerConditions를 호출함 (간접 테스트)
      const query: HybridSearchQuery = { 
        query: 'test',
        match_trigger_conditions: true,
        context: { tool_name: 'migration', event: 'start' }
      };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 모든 키-값 쌍이 매칭됨
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.trigger_conditions_match).toBe(true);
    });

    it('Given: match_trigger_conditions가 false임, When: matchTriggerConditions를 호출함, Then: 매칭되지 않음', () => {
      // Given: match_trigger_conditions가 false임
      const memoryId = 'mem-match-trigger-3';
      const triggerConditions = JSON.stringify({ tool_name: 'migration' });
      db.prepare(`
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions) VALUES (?, ?, ?, ?)
      `).run(memoryId, null, null, triggerConditions);
      
      // When: matchTriggerConditions를 호출함 (간접 테스트)
      const query: HybridSearchQuery = { 
        query: 'migration',
        match_trigger_conditions: false
      };
      const result = matcher.fetchProceduralMemoryMatches(db, [memoryId], query);
      
      // Then: 매칭되지 않음
      expect(result.size).toBe(1);
      const match = result.get(memoryId);
      expect(match?.trigger_conditions_match).toBe(false);
    });
  });
});
