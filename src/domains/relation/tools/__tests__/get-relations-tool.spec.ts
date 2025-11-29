/**
 * Get Relations Tool 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { GetRelationsTool } from './get-relations-tool.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { RelationEngineSchemaMigration } from '../infrastructure/database/migration/migrations/005-relation-engine-schema.js';
import { RelationGraph } from '../domains/relation/services/relation-graph.js';
import type { ToolContext } from './types.js';

/**
 * 테스트용 기본 스키마 생성
 */
function createBaseSchema(db: Database.Database): void {
  // memory_item 테이블 생성
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
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0
    );
  `);

  // memento_schema_version 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * 테스트용 메모리 생성
 */
function createTestMemory(
  db: Database.Database,
  id: string,
  content: string,
  type: string = 'episodic'
): void {
  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content)
    VALUES (?, ?, ?)
  `, [id, type, content]);
}

describe('GetRelationsTool', () => {
  let db: Database.Database;
  let tool: GetRelationsTool;
  let context: ToolContext;
  let relationGraph: RelationGraph;

  beforeEach(() => {
    // Given: in-memory 데이터베이스 생성 및 초기화
    db = new Database(':memory:');
    createBaseSchema(db);
    
    // 마이그레이션 실행
    const migration = new RelationEngineSchemaMigration();
    migration.up(db);
    
    // RelationGraph 초기화
    relationGraph = new RelationGraph(db);
    
    // ToolContext 생성
    context = {
      db,
      services: {
        relationGraph
      }
    };
    
    // 도구 인스턴스 생성
    tool = new GetRelationsTool();
  });

  afterEach(() => {
    // 데이터베이스 정리
    if (db) {
      db.close();
    }
  });

  describe('관계 조회', () => {
    it('메모리가 존재하지 않으면 에러를 반환해야 함', async () => {
      // Given: 존재하지 않는 메모리 ID
      const params = {
        memory_id: 'non_existent_memory'
      };

      // When: 관계 조회 시도
      const result = await tool.handle(params, context);

      // Then: 에러 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('MEMORY_NOT_FOUND');
      expect(data.message).toContain('메모리를 찾을 수 없습니다');
    });

    it('관계가 없으면 빈 목록을 반환해야 함', async () => {
      // Given: 관계가 없는 메모리
      createTestMemory(db, 'mem1', 'Test memory content');

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 조회
      const result = await tool.handle(params, context);

      // Then: 빈 관계 목록 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.memory_id).toBe('mem1');
      expect(data.relation_count).toBe(0);
      expect(data.relations).toEqual([]);
      expect(data.message).toContain('0개의 관계를 찾았습니다');
    });

    it('모든 관계를 조회해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      createTestMemory(db, 'mem3', 'Test memory 3');

      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      await relationGraph.addRelation('mem1', 'mem3', 'FOLLOWS', { confidence: 0.7 });
      await relationGraph.addRelation('mem2', 'mem3', 'DEPENDS_ON', { confidence: 0.9 });

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 조회 (direction: both)
      const result = await tool.handle(params, context);

      // Then: 모든 관계 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.memory_id).toBe('mem1');
      expect(data.relation_count).toBe(2); // mem1 -> mem2, mem1 -> mem3
      expect(data.relations.length).toBe(2);
      expect(data.filters.direction).toBe('both');
    });

    it('outgoing 관계만 조회해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      createTestMemory(db, 'mem3', 'Test memory 3');

      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      await relationGraph.addRelation('mem3', 'mem1', 'FOLLOWS', { confidence: 0.7 });

      const params = {
        memory_id: 'mem1',
        direction: 'outgoing'
      };

      // When: outgoing 관계 조회
      const result = await tool.handle(params, context);

      // Then: outgoing 관계만 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_count).toBe(1);
      expect(data.relations[0].source_id).toBe('mem1');
      expect(data.relations[0].target_id).toBe('mem2');
      expect(data.filters.direction).toBe('outgoing');
    });

    it('incoming 관계만 조회해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      createTestMemory(db, 'mem3', 'Test memory 3');

      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      await relationGraph.addRelation('mem3', 'mem1', 'FOLLOWS', { confidence: 0.7 });

      const params = {
        memory_id: 'mem1',
        direction: 'incoming'
      };

      // When: incoming 관계 조회
      const result = await tool.handle(params, context);

      // Then: incoming 관계만 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_count).toBe(1);
      expect(data.relations[0].source_id).toBe('mem3');
      expect(data.relations[0].target_id).toBe('mem1');
      expect(data.filters.direction).toBe('incoming');
    });

    it('특정 relation_type으로 필터링해야 함', async () => {
      // Given: 메모리 및 다양한 관계 유형 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      createTestMemory(db, 'mem3', 'Test memory 3');

      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      await relationGraph.addRelation('mem1', 'mem3', 'FOLLOWS', { confidence: 0.7 });

      const params = {
        memory_id: 'mem1',
        relation_type: 'CAUSES',
        direction: 'outgoing' // outgoing만 조회하여 정확한 개수 확인
      };

      // When: CAUSES 관계만 조회
      const result = await tool.handle(params, context);

      // Then: CAUSES 관계만 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_count).toBe(1);
      expect(data.relations[0].relation_type).toBe('CAUSES');
      expect(data.filters.relation_type).toBe('CAUSES');
    });

    it('category로 필터링해야 함', async () => {
      // Given: 메모리 및 다양한 카테고리 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      createTestMemory(db, 'mem3', 'Test memory 3');
      createTestMemory(db, 'mem4', 'Test memory 4');

      // Causal: CAUSES
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      // Temporal: FOLLOWS
      await relationGraph.addRelation('mem1', 'mem3', 'FOLLOWS', { confidence: 0.7 });
      // Semantic: CONTRASTS_WITH
      await relationGraph.addRelation('mem1', 'mem4', 'CONTRASTS_WITH', { confidence: 0.6 });

      const params = {
        memory_id: 'mem1',
        category: 'Causal',
        direction: 'outgoing' // outgoing만 조회하여 정확한 개수 확인
      };

      // When: Causal 카테고리 관계 조회
      const result = await tool.handle(params, context);

      // Then: Causal 카테고리 관계만 반환 (CAUSES)
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_count).toBe(1);
      expect(data.relations[0].relation_type).toBe('CAUSES');
      expect(data.filters.category).toBe('Causal');
    });

    it('relation_type과 category 필터를 조합해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      createTestMemory(db, 'mem3', 'Test memory 3');

      // CAUSES는 Causal 카테고리
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      // FOLLOWS는 Temporal 카테고리
      await relationGraph.addRelation('mem1', 'mem3', 'FOLLOWS', { confidence: 0.7 });

      const params = {
        memory_id: 'mem1',
        relation_type: 'CAUSES',
        category: 'Causal',
        direction: 'outgoing' // outgoing만 조회하여 정확한 개수 확인
      };

      // When: relation_type과 category 모두 지정
      const result = await tool.handle(params, context);

      // Then: 교집합 반환 (CAUSES는 Causal이므로 반환됨)
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_count).toBe(1);
      expect(data.relations[0].relation_type).toBe('CAUSES');
      expect(data.filters.relation_type).toBe('CAUSES');
      expect(data.filters.category).toBe('Causal');
    });

    it('relation_type과 category 필터가 일치하지 않으면 빈 목록을 반환해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      // CAUSES는 Causal 카테고리
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      const params = {
        memory_id: 'mem1',
        relation_type: 'CAUSES',
        category: 'Temporal', // CAUSES는 Causal이므로 일치하지 않음
        direction: 'outgoing' // outgoing만 조회
      };

      // When: 일치하지 않는 필터 조합
      const result = await tool.handle(params, context);

      // Then: 빈 목록 반환 (교집합이 비어있음)
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_count).toBe(0);
      expect(data.relations).toEqual([]);
    });

    it('context에 relationGraph가 없으면 새로 생성해야 함', async () => {
      // Given: relationGraph가 없는 context
      const contextWithoutGraph: ToolContext = {
        db,
        services: {}
      };

      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 조회
      const result = await tool.handle(params, contextWithoutGraph);

      // Then: 에러 없이 완료 (내부에서 RelationGraph 생성)
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_count).toBeGreaterThanOrEqual(0);
    });

    it('관계 정보를 올바르게 반환해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const relationId = await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { 
        confidence: 0.85,
        metadata: { method: 'rule', evidence: '버그 발생' }
      });

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 조회
      const result = await tool.handle(params, context);

      // Then: 관계 정보가 올바르게 반환됨
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_count).toBe(1);
      expect(data.relations[0]).toMatchObject({
        relation_id: relationId,
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES',
        confidence: 0.85
      });
      expect(data.relations[0].metadata).toBeDefined();
      expect(data.relations[0].created_at).toBeDefined();
    });
  });

  describe('파라미터 검증', () => {
    it('memory_id가 없으면 에러를 반환해야 함', async () => {
      // Given: memory_id가 없는 파라미터
      const params = {} as any;

      // When: 관계 조회 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('memory_id가 빈 문자열이면 에러를 반환해야 함', async () => {
      // Given: 빈 문자열 memory_id
      const params = {
        memory_id: ''
      };

      // When: 관계 조회 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('잘못된 relation_type이면 에러를 반환해야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory');

      const params = {
        memory_id: 'mem1',
        relation_type: 'INVALID_TYPE' as any
      };

      // When: 관계 조회 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('잘못된 category이면 에러를 반환해야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory');

      const params = {
        memory_id: 'mem1',
        category: 'InvalidCategory' as any
      };

      // When: 관계 조회 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('잘못된 direction이면 에러를 반환해야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory');

      const params = {
        memory_id: 'mem1',
        direction: 'invalid' as any
      };

      // When: 관계 조회 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });
});
