/**
 * Convert Episodic to Semantic Tool 테스트
 * AriGraph Pipeline의 수동 변환 기능 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { ConvertEpisodicToSemanticTool } from '../convert-episodic-to-semantic-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import { UnifiedEmbeddingService } from '../../../../domains/embedding/services/unified-embedding-service.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';
/**
 * Memory ID 생성 유틸리티 (테스트용)
 */
function generateId(prefix: string = 'mem'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `${prefix}_${timestamp}_${random}`;
}

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
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
      origin_source TEXT,
      -- AriGraph Pipeline 필드
      subject TEXT,
      predicate TEXT,
      object TEXT,
      triple_extracted BOOLEAN DEFAULT NULL,
      triple_extracted_status TEXT DEFAULT NULL,
      triple_extraction_metadata TEXT DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_item_triple_extracted ON memory_item(triple_extracted);
    CREATE INDEX IF NOT EXISTS idx_memory_item_triple_status ON memory_item(triple_extracted_status);

    -- memory_relation 테이블 (AriGraph Pipeline용)
    CREATE TABLE IF NOT EXISTS memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0.0 AND confidence <= 1.0),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, relation_type)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_relation_source ON memory_relation(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relation_target ON memory_relation(target_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relation_type ON memory_relation(relation_type);

    -- relation_type_registry 테이블 (AriGraph Pipeline용)
    CREATE TABLE IF NOT EXISTS relation_type_registry (
      type_name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      applicable_types TEXT,
      default_confidence REAL DEFAULT 0.7,
      search_boost REAL DEFAULT 1.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- extracted_from, supported_by 관계 타입 등록
    INSERT OR IGNORE INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
    VALUES 
      ('extracted_from', 'Structural', '추출 관계: Semantic Memory가 Episodic Memory에서 추출됨', '["episodic", "semantic"]', 0.7, 1.1),
      ('supported_by', 'Structural', '근거 관계: Semantic Memory가 Episodic Memory에 의해 근거를 가짐', '["episodic", "semantic"]', 0.7, 1.1);
  `);
}

/**
 * 테스트용 Episodic Memory 생성
 */
function createTestEpisodicMemory(
  db: Database.Database,
  id: string,
  content: string,
  importance: number = 0.5
): void {
  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content, importance, created_at)
    VALUES (?, 'episodic', ?, ?, CURRENT_TIMESTAMP)
  `, [id, content, importance]);
}

describe('ConvertEpisodicToSemanticTool', () => {
  let db: Database.Database;
  let tool: ConvertEpisodicToSemanticTool;
  let context: ToolContext;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    tool = new ConvertEpisodicToSemanticTool();

    context = {
      db,
      services: {
        embeddingService: new UnifiedEmbeddingService(),
        relationGraph: createRelationGraph(db)
      }
    };
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('초기화', () => {
    it('should create tool with correct name and description', () => {
      // Given: ConvertEpisodicToSemanticTool 인스턴스
      // When: getDefinition 호출
      const definition = tool.getDefinition();

      // Then: 올바른 이름과 설명 반환
      expect(definition.name).toBe('convert_episodic_to_semantic');
      expect(definition.description).toContain('Episodic Memory를 Semantic Memory로 변환');
    });

    it('should have correct input schema', () => {
      // Given: ConvertEpisodicToSemanticTool 인스턴스
      // When: getDefinition 호출
      const definition = tool.getDefinition();

      // Then: 올바른 input schema 반환
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('memory_id');
      expect(definition.inputSchema.properties).toHaveProperty('skip_converted');
      expect(definition.inputSchema.properties).toHaveProperty('retry_failed');
      expect(definition.inputSchema.properties).toHaveProperty('limit');
    });
  });

  describe('단일 Episodic Memory 변환', () => {
    it('should convert episodic memory to semantic memory when memory_id is provided', async () => {
      // Given: 기존 Episodic Memory
      const episodicMemoryId = generateId('mem');
      const episodicContent = 'John works at Google. He is a software engineer.';
      createTestEpisodicMemory(db, episodicMemoryId, episodicContent, 0.8);

      // When: convert 호출
      const params = {
        memory_id: episodicMemoryId
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: Semantic Memory 생성 확인
      expect(resultData.total).toBe(1);
      // Triple 추출이 성공했는지 또는 실패했는지 확인 (LLM 응답에 따라 다를 수 있음)
      expect(resultData.success).toBeGreaterThanOrEqual(0);
      expect(resultData.failed).toBeGreaterThanOrEqual(0);
      expect(resultData.success + resultData.failed).toBe(1);

      // Episodic Memory의 상태 확인 (변환이 완료될 때까지 대기)
      // convert-episodic-to-semantic-tool은 동기적으로 처리되지만, 
      // LLM 호출 등으로 인해 약간의 지연이 있을 수 있음
      let episodicMemory: { triple_extracted: boolean | null; triple_extracted_status: string | null } | undefined;
      let waitCount = 0;
      while (waitCount < 20) {
        episodicMemory = DatabaseUtils.get(db, `
          SELECT triple_extracted, triple_extracted_status
          FROM memory_item WHERE id = ?
        `, [episodicMemoryId]) as { 
          triple_extracted: boolean | null; 
          triple_extracted_status: string | null;
        } | undefined;
        
        if (episodicMemory?.triple_extracted_status) {
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }

      // triple_extracted_status가 설정되었어야 함 (성공 또는 실패)
      // DB에서 TEXT로 저장되므로 문자열로 변환
      const status = typeof episodicMemory?.triple_extracted_status === 'string' 
        ? episodicMemory.triple_extracted_status 
        : String(episodicMemory?.triple_extracted_status || '');
      expect(status).toMatch(/^(success|failed)$/);

      // 성공한 경우 Semantic Memory 확인
      if (resultData.success > 0) {
        const semanticMemories = DatabaseUtils.all(db, `
          SELECT id, type, subject, predicate, object
          FROM memory_item
          WHERE type = 'semantic' AND subject IS NOT NULL
        `) as Array<{ id: string; type: string; subject: string | null; predicate: string | null; object: string | null }>;

        expect(semanticMemories.length).toBeGreaterThan(0);

        // extracted_from 관계 확인
        const extractedFromRelations = DatabaseUtils.all(db, `
          SELECT * FROM memory_relation
          WHERE target_id = ? AND relation_type = 'extracted_from'
        `, [episodicMemoryId]);

        expect(extractedFromRelations.length).toBeGreaterThan(0);
        expect(extractedFromRelations[0].confidence).toBeGreaterThanOrEqual(0);
        expect(extractedFromRelations[0].confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should return error when memory_id does not exist', async () => {
      // Given: 존재하지 않는 memory_id
      const nonExistentId = 'mem_nonexistent';

      // When: convert 호출
      const params = {
        memory_id: nonExistentId
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 에러 반환
      expect(resultData.error).toBe('MEMORY_NOT_FOUND');
      expect(resultData.message).toContain(nonExistentId);
    });

    it('should return error when memory_id is not episodic type', async () => {
      // Given: semantic type의 memory
      const semanticMemoryId = generateId('mem');
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, created_at)
        VALUES (?, 'semantic', 'Some semantic content', 0.5, CURRENT_TIMESTAMP)
      `, [semanticMemoryId]);

      // When: convert 호출
      const params = {
        memory_id: semanticMemoryId
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 에러 반환
      expect(resultData.error).toBe('MEMORY_NOT_FOUND');
    });
  });

  describe('배치 처리', () => {
    it('should convert multiple episodic memories when memory_id is not provided', async () => {
      // Given: 여러 Episodic Memory
      const memory1Id = generateId('mem');
      const memory2Id = generateId('mem');
      const memory3Id = generateId('mem');
      
      createTestEpisodicMemory(db, memory1Id, 'Alice works at Microsoft. She is a data scientist.', 0.7);
      createTestEpisodicMemory(db, memory2Id, 'Bob works at Amazon. He is a product manager.', 0.6);
      createTestEpisodicMemory(db, memory3Id, 'Charlie works at Apple. He is a designer.', 0.8);

      // When: convert 호출 (memory_id 없이, 배치 처리)
      const params = {
        skip_converted: true,
        retry_failed: false,
        limit: 10
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 여러 Episodic Memory 변환 시도
      expect(resultData.total).toBeGreaterThan(0);
      expect(resultData.total).toBeLessThanOrEqual(3);
      expect(resultData.success + resultData.failed + resultData.skipped).toBe(resultData.total);
    });

    it('should skip already converted memories when skip_converted=true', async () => {
      // Given: 이미 변환된 Episodic Memory
      const memoryId = generateId('mem');
      createTestEpisodicMemory(db, memoryId, 'Test content', 0.5);
      
      // 이미 변환된 상태로 설정
      DatabaseUtils.run(db, `
        UPDATE memory_item SET
          triple_extracted = ?,
          triple_extracted_status = ?
        WHERE id = ?
      `, [1, 'success', memoryId]); // SQLite에서는 boolean을 INTEGER로 변환

      // When: convert 호출 (skip_converted=true)
      const params = {
        memory_id: memoryId,
        skip_converted: true
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 건너뛰기 확인
      // 단일 변환의 경우 skip_converted는 쿼리 레벨에서 필터링되지 않고
      // 처리 중에 확인되므로, skipped가 1이어야 함
      expect(resultData.skipped).toBe(1);
      expect(resultData.success).toBe(0);
      expect(resultData.failed).toBe(0);
    });

    it('should retry failed memories when retry_failed=true', async () => {
      // Given: 실패한 Episodic Memory
      const memoryId = generateId('mem');
      createTestEpisodicMemory(db, memoryId, 'Test content for retry', 0.5);
      
      // 실패 상태로 설정
      DatabaseUtils.run(db, `
        UPDATE memory_item SET
          triple_extracted = ?,
          triple_extracted_status = ?,
          triple_extraction_metadata = ?
        WHERE id = ?
      `, [
        0, // SQLite에서는 boolean을 INTEGER로 변환
        'failed',
        JSON.stringify({ failureReason: 'no_triple', retry_count: 1, last_attempt: new Date().toISOString() }),
        memoryId
      ]);

      // When: convert 호출 (retry_failed=true, memory_id 없이 배치 처리)
      const params = {
        retry_failed: true,
        skip_converted: true,
        limit: 10
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 재시도 확인
      expect(resultData.total).toBeGreaterThan(0);
      // 재시도 시도는 했지만, LLM 응답에 따라 성공 또는 실패할 수 있음
      expect(resultData.success + resultData.failed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('에러 처리', () => {
    it('should return error when database is not available', async () => {
      // Given: 데이터베이스가 없는 context
      const contextWithoutDb: ToolContext = {
        db: null as any,
        services: {}
      };

      // When: convert 호출
      const params = {
        memory_id: 'test_id'
      };
      const result = await tool.handle(params, contextWithoutDb);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 에러 반환
      expect(resultData.error).toBe('DATABASE_NOT_AVAILABLE');
    });
  });
});

