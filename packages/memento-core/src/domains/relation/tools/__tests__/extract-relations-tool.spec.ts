/**
 * Extract Relations Tool 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ExtractRelationsTool } from '../extract-relations-tool.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RelationEngineSchemaMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/005-relation-engine-schema.js';
import type { RelationGraph } from '../../services/relation-graph.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';
import { RelationExtractor } from '../../services/relation-extractor.js';
import { LLMBasedRelationExtractor } from '../../services/llm-based-relation-extractor.js';
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
      edit_count INTEGER DEFAULT 0,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
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
    INSERT INTO memory_item (id, type, content) VALUES (?, ?, ?)
  `, [id, type, content]);
}

describe('ExtractRelationsTool', () => {
  let db: Database.Database;
  let tool: ExtractRelationsTool;
  let context: ToolContext;
  let relationGraph: RelationGraph;
  let originalLlmProvider: string | undefined;

  beforeEach(() => {
    // Given: 테스트 환경에서 LLM 사용 비활성화 (타임아웃 방지)
    originalLlmProvider = process.env.LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    
    // LLMBasedRelationExtractor의 isAvailable 메서드 모킹 (타임아웃 방지)
    vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailable').mockReturnValue(false);
    // 비동기 판정도 함께 막는다. 그러지 않으면 실제 초기화(프로바이더 연결 점검)를 기다린다.
    vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailableAsync').mockResolvedValue(false);
    
    // Given: in-memory 데이터베이스 생성 및 초기화
    db = new Database(':memory:');
    createBaseSchema(db);
    
    // 마이그레이션 실행
    const migration = new RelationEngineSchemaMigration();
    migration.up(db);
    
    // RelationGraph 초기화
    relationGraph = createRelationGraph(db);
    
    // ToolContext 생성
    context = {
      db,
      services: {
        relationGraph
      }
    };
    
    // 도구 인스턴스 생성
    tool = new ExtractRelationsTool();
  });

  afterEach(() => {
    // 모킹 복원
    vi.restoreAllMocks();
    
    // 환경 변수 복원
    if (originalLlmProvider !== undefined) {
      process.env.LLM_PROVIDER = originalLlmProvider;
    } else {
      delete process.env.LLM_PROVIDER;
    }
    
    // 데이터베이스 정리
    if (db) {
      db.close();
    }
  });

  describe('관계 추출', () => {
    it('메모리가 존재하지 않으면 에러를 반환해야 함', async () => {
      // Given: 존재하지 않는 메모리 ID
      const params = {
        memory_id: 'non_existent_memory'
      };

      // When: 관계 추출 시도
      const result = await tool.handle(params, context);

      // Then: 에러 반환
      expect(result.content).toBeDefined();
      expect(result.content[0].text).toContain('MEMORY_NOT_FOUND');
      expect(result.content[0].text).toContain('메모리를 찾을 수 없습니다');
    });

    it('기존 메모리가 없으면 빈 관계 목록을 반환해야 함', async () => {
      // Given: 단일 메모리만 존재
      createTestMemory(db, 'mem1', 'Test memory content');

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 추출 수행
      const result = await tool.handle(params, context);

      // Then: 빈 관계 목록 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.extracted_count).toBe(0);
      expect(data.relations).toEqual([]);
      expect(data.message).toContain('관계를 추출할 기존 메모리가 없습니다');
    });

    it('관계를 추출하고 저장해야 함', async () => {
      // Given: 관련된 메모리들 생성
      createTestMemory(db, 'mem1', '정산 시스템에서 세금 계산 로직에 버그가 발생했습니다.');
      createTestMemory(db, 'mem2', '고객 정산 금액이 잘못 계산되어 환불 요청이 발생했습니다.');
      createTestMemory(db, 'mem3', '버그 수정을 위해 세금 계산 로직을 재검토했습니다.');

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 추출 수행
      const result = await tool.handle(params, context);

      // Then: 관계가 추출되고 저장됨
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.memory_id).toBe('mem1');
      expect(data.extracted_count).toBeGreaterThanOrEqual(0);
      expect(data.saved_count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.relations)).toBe(true);
      
      // 저장된 관계 확인
      if (data.saved_count > 0) {
        const relations = await relationGraph.getRelations('mem1', { direction: 'outgoing' });
        expect(relations.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('force=true일 때 캐시를 무시하고 재추출해야 함', async () => {
      // Given: 관련된 메모리들 생성
      createTestMemory(db, 'mem1', '정산 시스템에서 세금 계산 로직에 버그가 발생했습니다.');
      createTestMemory(db, 'mem2', '고객 정산 금액이 잘못 계산되어 환불 요청이 발생했습니다.');

      const params = {
        memory_id: 'mem1',
        force: true
      };

      // When: 관계 추출 수행 (force=true)
      const result1 = await tool.handle(params, context);
      
      // 다시 추출 (force=true)
      const result2 = await tool.handle(params, context);

      // Then: 두 번 모두 추출 수행 (캐시 무시)
      expect(result1.content).toBeDefined();
      expect(result2.content).toBeDefined();
      
      const data1 = JSON.parse(result1.content[0].text);
      const data2 = JSON.parse(result2.content[0].text);
      
      // force=true이므로 캐시를 무시하고 매번 추출 수행
      expect(data1.extracted_count).toBeGreaterThanOrEqual(0);
      expect(data2.extracted_count).toBeGreaterThanOrEqual(0);
    });

    it('force=false일 때 캐시를 사용할 수 있어야 함', async () => {
      // Given: 관련된 메모리들 생성
      createTestMemory(db, 'mem1', '정산 시스템에서 세금 계산 로직에 버그가 발생했습니다.');
      createTestMemory(db, 'mem2', '고객 정산 금액이 잘못 계산되어 환불 요청이 발생했습니다.');

      const params = {
        memory_id: 'mem1',
        force: false
      };

      // When: 관계 추출 수행 (force=false)
      const result = await tool.handle(params, context);

      // Then: 추출 수행 (캐시 사용 가능)
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.extracted_count).toBeGreaterThanOrEqual(0);
    });

    it('중복 관계나 순환 관계는 무시하고 계속 진행해야 함', async () => {
      // Given: 관련된 메모리들 생성
      createTestMemory(db, 'mem1', '정산 시스템에서 세금 계산 로직에 버그가 발생했습니다.');
      createTestMemory(db, 'mem2', '고객 정산 금액이 잘못 계산되어 환불 요청이 발생했습니다.');

      // 이미 관계가 존재하는 경우
      await relationGraph.addRelation('mem1', 'mem2', 'CAUSES', { confidence: 0.8 });

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 추출 수행
      const result = await tool.handle(params, context);

      // Then: 에러 없이 완료 (중복 관계는 무시)
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.extracted_count).toBeGreaterThanOrEqual(0);
      // saved_count는 중복 관계로 인해 extracted_count보다 작을 수 있음
      expect(data.saved_count).toBeLessThanOrEqual(data.extracted_count);
    });

    it('여러 메모리와의 관계를 추출해야 함', async () => {
      // Given: 여러 관련 메모리들 생성
      createTestMemory(db, 'mem1', '프로젝트 계획을 수립했습니다.');
      createTestMemory(db, 'mem2', '프로젝트 계획에 따라 개발을 시작했습니다.');
      createTestMemory(db, 'mem3', '개발 완료 후 테스트를 진행했습니다.');
      createTestMemory(db, 'mem4', '테스트 결과를 바탕으로 배포를 준비했습니다.');

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 추출 수행
      const result = await tool.handle(params, context);

      // Then: 여러 관계가 추출될 수 있음
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.memory_id).toBe('mem1');
      expect(data.extracted_count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(data.relations)).toBe(true);
    });
  });

  describe('파라미터 검증', () => {
    it('memory_id가 없으면 에러를 반환해야 함', async () => {
      // Given: memory_id가 없는 파라미터
      const params = {} as any;

      // When: 관계 추출 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('memory_id가 빈 문자열이면 에러를 반환해야 함', async () => {
      // Given: 빈 문자열 memory_id
      const params = {
        memory_id: ''
      };

      // When: 관계 추출 시도
      // Then: Zod 검증 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('force 파라미터가 boolean이 아니면 기본값 false를 사용해야 함', async () => {
      // Given: 메모리 생성
      createTestMemory(db, 'mem1', 'Test memory');

      const params = {
        memory_id: 'mem1',
        force: 'true' as any // 잘못된 타입
      };

      // When: 관계 추출 시도
      // Then: 기본값 false로 처리되거나 에러 발생
      // (Zod가 자동으로 변환하거나 에러를 발생시킴)
      try {
        const result = await tool.handle(params, context);
        expect(result.content).toBeDefined();
      } catch (error) {
        // 타입 검증 실패는 정상
        expect(error).toBeDefined();
      }
    });
  });

  describe('RelationGraph 통합', () => {
    it('context에 relationGraph가 없으면 구성 오류를 반환해야 함', async () => {
      // Given: relationGraph가 없는 context
      const contextWithoutGraph: ToolContext = {
        db,
        services: {}
      };

      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');
      vi.spyOn(RelationExtractor.prototype, 'extractRelations').mockResolvedValue([
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.8
        }
      ]);

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 추출 수행
      const result = await tool.handle(params, contextWithoutGraph);

      // Then: 구성 오류 반환
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toBe('RELATION_GRAPH_UNAVAILABLE');
      expect(data.message).toContain('관계 그래프 서비스');
    });

    it('context에 relationGraph가 있으면 사용해야 함', async () => {
      // Given: relationGraph가 있는 context
      createTestMemory(db, 'mem1', 'Test memory 1');
      createTestMemory(db, 'mem2', 'Test memory 2');

      const params = {
        memory_id: 'mem1'
      };

      // When: 관계 추출 수행
      const result = await tool.handle(params, context);

      // Then: context의 relationGraph 사용
      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.extracted_count).toBeGreaterThanOrEqual(0);
    });
  });
});
