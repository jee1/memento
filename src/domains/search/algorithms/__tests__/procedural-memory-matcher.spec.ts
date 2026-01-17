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
        trigger_conditions TEXT
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
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions)
        VALUES (?, ?, ?, ?)
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
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions)
        VALUES (?, ?, ?, ?)
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
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions)
        VALUES (?, ?, ?, ?)
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
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions)
        VALUES (?, ?, ?, ?)
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
        INSERT INTO memory_item (id, workflow_name, skill_name, trigger_conditions)
        VALUES (?, ?, ?, ?)
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
});
