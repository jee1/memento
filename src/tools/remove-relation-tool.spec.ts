/**
 * Remove Relation Tool 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { RemoveRelationTool } from '../domains/relation/tools/remove-relation-tool.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import { RelationEngineSchemaMigration } from '../../infrastructure/database/database/migration/migrations/005-relation-engine-schema.js';
import { RelationGraph } from '../domains/relation/services/relation-graph.js';
import type { ToolContext } from '../types.js';

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

describe('RemoveRelationTool', () => {
  let db: Database.Database;
  let tool: RemoveRelationTool;
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
    tool = new RemoveRelationTool();
  });

  afterEach(() => {
    // 데이터베이스 정리
    if (db) {
      db.close();
    }
  });

  describe('relation_id로 관계 삭제', () => {
    it('relation_id로 관계를 성공적으로 삭제해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      const relationId = await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      const params = {
        relation_id: relationId
      };

      // When: 관계 삭제
      const result = await tool.handle(params, context);

      // Then: 관계가 삭제됨
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.deleted).toBe(true);
      expect(data.source_id).toBe('mem1');
      expect(data.target_id).toBe('mem2');
      expect(data.relation_type).toBe('CAUSES');
      expect(data.message).toContain('관계가 삭제되었습니다');

      // 데이터베이스에서 확인
      const relations = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
      expect(relations.length).toBe(0);
    });

    it('존재하지 않는 relation_id로 삭제 시 에러를 반환해야 함', async () => {
      // Given: 존재하지 않는 relation_id
      const params = {
        relation_id: 99999
      };

      // When: 관계 삭제 시도
      const result = await tool.handle(params, context);

      // Then: 에러 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('RELATION_NOT_FOUND');
      expect(data.message).toContain('관계를 찾을 수 없습니다');
    });
  });

  describe('source_id/target_id/relation_type 조합으로 관계 삭제', () => {
    it('source_id/target_id/relation_type 조합으로 관계를 성공적으로 삭제해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 삭제
      const result = await tool.handle(params, context);

      // Then: 관계가 삭제됨
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.deleted).toBe(true);
      expect(data.source_id).toBe('mem1');
      expect(data.target_id).toBe('mem2');
      expect(data.relation_type).toBe('CAUSES');
      expect(data.message).toContain('관계가 삭제되었습니다');

      // 데이터베이스에서 확인
      const relations = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
      expect(relations.length).toBe(0);
    });

    it('존재하지 않는 관계로 삭제 시 에러를 반환해야 함', async () => {
      // Given: 메모리 생성 (관계 없음)
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 삭제 시도
      const result = await tool.handle(params, context);

      // Then: 에러 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('RELATION_NOT_FOUND');
      expect(data.message).toContain('관계를 찾을 수 없습니다');
    });

    it('다양한 관계 유형을 삭제할 수 있어야 함', async () => {
      // Given: 메모리 및 다양한 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      createTestMemory(db, 'mem3', 'Test memory 3');
      createTestMemory(db, 'mem4', 'Test memory 4');
      createTestMemory(db, 'mem5', 'Test memory 5'); // mem${i+2}에서 i=3일 때 mem5 필요

      const relationTypes = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH'] as const;

      // 관계 추가
      for (let i = 0; i < relationTypes.length; i++) {
        await relationGraph.addRelation('mem1', `mem${i + 2}`, relationTypes[i], { confidence: 0.7 });
      }

      // When: 각 관계 삭제
      for (let i = 0; i < relationTypes.length; i++) {
        const params = {
          source_id: 'mem1',
          target_id: `mem${i + 2}`,
          relation_type: relationTypes[i]
        };

        const result = await tool.handle(params, context);
        const data = JSON.parse(result.content[0].text);
        expect(data.deleted).toBe(true);
        expect(data.relation_type).toBe(relationTypes[i]);
      }

      // Then: 모든 관계가 삭제됨
      const relations = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
      expect(relations.length).toBe(0);
    });
  });

  describe('relation_id 우선순위', () => {
    it('relation_id와 source_id/target_id/relation_type이 모두 제공되면 relation_id를 우선 사용해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      createTestMemory(db, 'mem3', 'Test memory 3');
      
      // mem1 -> mem2 관계 생성
      const relationId1 = await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });
      // mem1 -> mem3 관계 생성
      await relationGraph.addRelation('mem1', 'mem3', 'DEPENDS_ON', { confidence: 0.7 });

      const params = {
        relation_id: relationId1, // mem1 -> mem2 관계 ID
        source_id: 'mem1',
        target_id: 'mem3', // 다른 관계
        relation_type: 'DEPENDS_ON' as const
      };

      // When: 관계 삭제
      const result = await tool.handle(params, context);

      // Then: relation_id로 지정한 관계가 삭제됨 (mem1 -> mem2)
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.deleted).toBe(true);
      expect(data.target_id).toBe('mem2'); // relation_id로 지정한 관계
      expect(data.relation_type).toBe('CAUSES');

      // mem1 -> mem3 관계는 여전히 존재
      const relations = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
      expect(relations.length).toBe(1);
      expect(relations[0].target_id).toBe('mem3');
    });
  });

  describe('파라미터 검증', () => {
    it('relation_id와 source_id/target_id/relation_type이 모두 없으면 에러를 반환해야 함', async () => {
      // Given: 파라미터 없음
      const params = {} as any;

      // When: 관계 삭제 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('source_id만 제공되면 에러를 반환해야 함', async () => {
      // Given: source_id만 제공
      const params = {
        source_id: 'mem1'
      } as any;

      // When: 관계 삭제 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('source_id와 target_id만 제공되면 에러를 반환해야 함', async () => {
      // Given: source_id와 target_id만 제공
      const params = {
        source_id: 'mem1',
        target_id: 'mem2'
      } as any;

      // When: 관계 삭제 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('relation_id가 0 이하면 에러를 반환해야 함', async () => {
      // Given: 잘못된 relation_id
      const params = {
        relation_id: 0
      };

      // When: 관계 삭제 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('relation_id가 음수이면 에러를 반환해야 함', async () => {
      // Given: 잘못된 relation_id
      const params = {
        relation_id: -1
      };

      // When: 관계 삭제 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('잘못된 relation_type이면 에러를 반환해야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'INVALID_TYPE' as any
      };

      // When: 관계 삭제 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });

  describe('RelationGraph 통합', () => {
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
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 삭제
      const result = await tool.handle(params, contextWithoutGraph);

      // Then: 에러 없이 완료 (내부에서 RelationGraph 생성)
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.deleted).toBe(true);
    });

    it('context에 relationGraph가 있으면 사용해야 함', async () => {
      // Given: relationGraph가 있는 context
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 삭제
      const result = await tool.handle(params, context);

      // Then: context의 relationGraph 사용
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.deleted).toBe(true);
    });
  });

  describe('캐시 무효화', () => {
    it('관계 삭제 후 캐시가 무효화되어야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      // 캐시에 저장 (getRelations 호출)
      await relationGraph.getRelations('mem1', { direction: 'outgoing' });

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 삭제
      const result = await tool.handle(params, context);

      // Then: 관계가 삭제됨
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.deleted).toBe(true);

      // 삭제 후 조회 시 빈 결과 반환 (캐시 무효화 확인)
      const relations = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
      expect(relations.length).toBe(0);
    });
  });
});
