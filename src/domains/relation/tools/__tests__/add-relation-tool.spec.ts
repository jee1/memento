/**
 * Add Relation Tool 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AddRelationTool } from '../add-relation-tool.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { RelationEngineSchemaMigration } from '../../infrastructure/database/database/migration/migrations/005-relation-engine-schema.js';
import { RelationGraph } from '../../relation-graph.js';
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

describe('AddRelationTool', () => {
  let db: Database.Database;
  let tool: AddRelationTool;
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
    tool = new AddRelationTool();
  });

  afterEach(() => {
    // 데이터베이스 정리
    if (db) {
      db.close();
    }
  });

  describe('관계 추가', () => {
    it('관계를 성공적으로 추가해야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const,
        confidence: 0.8
      };

      // When: 관계 추가
      const result = await tool.handle(params, context);

      // Then: 관계가 추가됨
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_id).toBeDefined();
      expect(data.source_id).toBe('mem1');
      expect(data.target_id).toBe('mem2');
      expect(data.relation_type).toBe('CAUSES');
      expect(data.confidence).toBe(0.8);
      expect(data.message).toContain('관계가 추가되었습니다');

      // 데이터베이스에서 확인
      const relations = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
      expect(relations.length).toBe(1);
      expect(relations[0].relation_type).toBe('CAUSES');
    });

    it('confidence가 없으면 기본값 0.7을 사용해야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'FOLLOWS' as const
        // confidence 생략
      };

      // When: 관계 추가
      const result = await tool.handle(params, context);

      // Then: 기본값 0.7 사용
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.confidence).toBe(0.7);
    });

    it('소스 메모리가 없으면 에러를 반환해야 함', async () => {
      // Given: 타겟 메모리만 존재
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        source_id: 'non_existent_mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 추가 시도
      const result = await tool.handle(params, context);

      // Then: 에러 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('SOURCE_MEMORY_NOT_FOUND');
      expect(data.message).toContain('소스 메모리를 찾을 수 없습니다');
    });

    it('타겟 메모리가 없으면 에러를 반환해야 함', async () => {
      // Given: 소스 메모리만 존재
      createTestMemory(db, 'mem1', 'Test memory 1');

      const params = {
        source_id: 'mem1',
        target_id: 'non_existent_mem2',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 추가 시도
      const result = await tool.handle(params, context);

      // Then: 에러 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('TARGET_MEMORY_NOT_FOUND');
      expect(data.message).toContain('타겟 메모리를 찾을 수 없습니다');
    });

    it('소스와 타겟이 같으면 에러를 반환해야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory 1');

      const params = {
        source_id: 'mem1',
        target_id: 'mem1',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 추가 시도
      const result = await tool.handle(params, context);

      // Then: 에러 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('INVALID_RELATION');
      expect(data.message).toContain('소스 메모리와 타겟 메모리는 같을 수 없습니다');
    });

    it('중복 관계 추가 시 에러를 반환해야 함', async () => {
      // Given: 메모리 및 관계 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const,
        confidence: 0.9
      };

      // When: 중복 관계 추가 시도
      const result = await tool.handle(params, context);

      // Then: 에러 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('DUPLICATE_RELATION');
      expect(data.message).toContain('이미 존재하는 관계');
    });

    it('순환 관계 추가 시 에러를 반환해야 함', async () => {
      // Given: 메모리 및 관계 생성 (mem1 -> mem2)
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      const params = {
        source_id: 'mem2',
        target_id: 'mem1',
        relation_type: 'CAUSES' as const,
        confidence: 0.7
      };

      // When: 순환 관계 추가 시도
      const result = await tool.handle(params, context);

      // Then: 에러 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('CYCLIC_RELATION');
      expect(data.message).toContain('순환 참조');
    });

    it('다양한 관계 유형을 추가할 수 있어야 함', async () => {
      // Given: 메모리 생성 (충분한 수)
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      createTestMemory(db, 'mem3', 'Test memory 3');
      createTestMemory(db, 'mem4', 'Test memory 4');
      createTestMemory(db, 'mem5', 'Test memory 5');
      createTestMemory(db, 'mem6', 'Test memory 6');
      createTestMemory(db, 'mem7', 'Test memory 7');

      const relationTypes = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'] as const;

      // When: 다양한 관계 유형 추가
      for (let i = 0; i < relationTypes.length; i++) {
        const params = {
          source_id: 'mem1',
          target_id: `mem${i + 2}`,
          relation_type: relationTypes[i],
          confidence: 0.7
        };

        const result = await tool.handle(params, context);
        expect(result.content).toBeDefined();
        const data = JSON.parse(result.content[0].text);
        
        // 성공 여부 확인
        if (data.success === false) {
          console.error(`관계 추가 실패: ${relationTypes[i]}`, data);
        }
        expect(data.relation_id).toBeDefined();
        expect(data.relation_type).toBe(relationTypes[i]);
      }

      // Then: 모든 관계가 추가됨
      const relations = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
      expect(relations.length).toBe(relationTypes.length);
    });

    it('메타데이터에 method: manual이 설정되어야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const,
        confidence: 0.8
      };

      // When: 관계 추가
      const result = await tool.handle(params, context);

      // Then: 메타데이터 확인
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_id).toBeDefined();

      const relations = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
      expect(relations.length).toBe(1);
      expect(relations[0].metadata?.method).toBe('manual');
      expect(relations[0].metadata?.extracted_at).toBeDefined();
    });
  });

  describe('파라미터 검증', () => {
    it('source_id가 없으면 에러를 반환해야 함', async () => {
      // Given: source_id가 없는 파라미터
      const params = {
        target_id: 'mem2',
        relation_type: 'CAUSES' as const
      } as any;

      // When: 관계 추가 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('target_id가 없으면 에러를 반환해야 함', async () => {
      // Given: target_id가 없는 파라미터
      const params = {
        source_id: 'mem1',
        relation_type: 'CAUSES' as const
      } as any;

      // When: 관계 추가 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('relation_type이 없으면 에러를 반환해야 함', async () => {
      // Given: relation_type이 없는 파라미터
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        source_id: 'mem1',
        target_id: 'mem2'
      } as any;

      // When: 관계 추가 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('confidence가 범위를 벗어나면 에러를 반환해야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const,
        confidence: 1.5 // 범위 초과
      };

      // When: 관계 추가 시도
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

      // When: 관계 추가 시도
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

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 추가
      const result = await tool.handle(params, contextWithoutGraph);

      // Then: 에러 없이 완료 (내부에서 RelationGraph 생성)
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_id).toBeDefined();
    });

    it('context에 relationGraph가 있으면 사용해야 함', async () => {
      // Given: relationGraph가 있는 context
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'CAUSES' as const
      };

      // When: 관계 추가
      const result = await tool.handle(params, context);

      // Then: context의 relationGraph 사용
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.relation_id).toBeDefined();
    });
  });
});
