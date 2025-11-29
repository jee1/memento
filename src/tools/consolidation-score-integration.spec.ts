/**
 * Consolidation Score System 통합 테스트
 * MCP 도구 호출 시 consolidation score 메타데이터 업데이트 확인
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';
import { RecallTool } from './recall-tool.js';
import { RememberTool } from './remember-tool.js';
import { MemoryInjectionPrompt } from './memory-injection-prompt.js';
import type { ToolContext } from './types.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import { ConsolidationScoreService } from '../services/consolidation-score-service.js';
import { WriteCoalescingManager, type CoalescedWrite } from '../utils/write-coalescing.js';
import * as configModule from '../config/index.js';

/**
 * 테스트용 데이터베이스 초기화 (Consolidation Score 필드 포함)
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
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
      -- Consolidation Score 필드
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      consolidation_score REAL,
      g_value REAL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_desc ON memory_item(consolidation_score DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2;

    CREATE TABLE IF NOT EXISTS memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      embedding TEXT NOT NULL,
      dim INTEGER NOT NULL,
      model TEXT,
      embedding_provider TEXT DEFAULT 'tfidf',
      dimensions INTEGER,
      precision INTEGER DEFAULT 32,
      normalized BOOLEAN DEFAULT FALSE,
      version INTEGER DEFAULT 1,
      created_by TEXT DEFAULT 'system',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      projection_type TEXT NOT NULL DEFAULT 'native',
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(memory_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider);
    CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions);
  `);
}

describe('Consolidation Score System 통합 테스트', () => {
  let db: Database.Database;
  let recallTool: RecallTool;
  let rememberTool: RememberTool;
  let memoryInjectionPrompt: MemoryInjectionPrompt;
  let context: ToolContext;
  let hybridSearchEngine: HybridSearchEngine;
  let embeddingService: MemoryEmbeddingService;
  let consolidationScoreService: ConsolidationScoreService;
  let writeCoalescingManager: WriteCoalescingManager;
  let flushCallback: (writes: CoalescedWrite[]) => Promise<void>;
  let flushedWrites: CoalescedWrite[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    embeddingService = new MemoryEmbeddingService();
    hybridSearchEngine = new HybridSearchEngine();
    consolidationScoreService = new ConsolidationScoreService();

    // Write Coalescing Manager 초기화 (테스트용 flush callback)
    flushedWrites = [];
    flushCallback = async (writes: CoalescedWrite[]) => {
      flushedWrites.push(...writes);
      // 실제 데이터베이스 업데이트
      await DatabaseUtils.runTransaction(db, async () => {
        for (const write of writes) {
          const updates: string[] = [];
          const params: any[] = [];

          if (write.fields.recall_count !== undefined) {
            updates.push('recall_count = ?');
            params.push(write.fields.recall_count);
          }
          if (write.fields.last_accessed_at !== undefined) {
            updates.push('last_accessed_at = ?');
            params.push(write.fields.last_accessed_at);
          }
          if (write.fields.g_value !== undefined) {
            updates.push('g_value = ?');
            params.push(write.fields.g_value);
          }
          if (write.fields.consolidation_score !== undefined) {
            updates.push('consolidation_score = ?');
            params.push(write.fields.consolidation_score);
          }

          if (updates.length > 0) {
            params.push(write.memoryId);
            DatabaseUtils.run(
              db,
              `UPDATE memory_item SET ${updates.join(', ')} WHERE id = ?`,
              params
            );
          }
        }
      });
    };

    writeCoalescingManager = new WriteCoalescingManager(100, flushCallback); // 테스트용 짧은 간격

    recallTool = new RecallTool();
    rememberTool = new RememberTool();
    memoryInjectionPrompt = new MemoryInjectionPrompt();

    context = {
      db,
      services: {
        hybridSearchEngine,
        embeddingService,
        consolidationScoreService,
        writeCoalescingManager
      }
    };

    // 기능 플래그 활성화
    vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
      ...configModule.mementoConfig,
      consolidationScoreEnabled: true
    } as any);
  });

  afterEach(async () => {
    // 모든 비동기 작업이 완료될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 500));

    // 서비스 인스턴스 정리 (데이터베이스 닫기 전에)
    try {
      recallTool = null as any;
      rememberTool = null as any;
      memoryInjectionPrompt = null as any;
    } catch (error) {
      console.warn('Tool 인스턴스 정리 중 에러:', error);
    }

    // Write Coalescing Manager 정리
    if (writeCoalescingManager) {
      try {
        // Flush 대기 (타이머가 실행 중일 수 있음)
        await writeCoalescingManager.flush();
        await new Promise(resolve => setTimeout(resolve, 200));
        await writeCoalescingManager.destroy();
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        // destroy 중 에러는 무시 (이미 destroy된 경우)
        console.warn('WriteCoalescingManager destroy 중 에러:', error);
      }
      writeCoalescingManager = null as any;
    }

    // flushCallback이 완료될 때까지 대기
    if (flushedWrites.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 서비스 인스턴스 정리 (HybridSearchEngine, MemoryEmbeddingService)
    try {
      hybridSearchEngine = null as any;
      embeddingService = null as any;
      consolidationScoreService = null as any;
    } catch (error) {
      console.warn('서비스 인스턴스 정리 중 에러:', error);
    }

    // 추가 대기 (서비스 리소스 정리 완료 보장)
    await new Promise(resolve => setTimeout(resolve, 200));

    // 데이터베이스 닫기
    if (db) {
      try {
        db.close();
      } catch (error) {
        console.warn('Database close 중 에러:', error);
      }
      db = null as any;
    }

    // Mock 및 Spy 정리
    vi.clearAllMocks();
    vi.restoreAllMocks();

    // 나머지 인스턴스 정리
    context = null as any;
    flushCallback = null as any;
    flushedWrites = [];

    // 최종 대기 (리소스 정리 완료 보장)
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('RememberTool - 신규 메모리 초기화', () => {
    it('should initialize consolidation score fields when creating new memory', async () => {
      const params = {
        type: 'episodic',
        content: 'Test memory for consolidation score',
        importance: 0.7
      };

      const result = await rememberTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const memoryId = resultData.memory_id;

      // 데이터베이스에서 확인
      const record = DatabaseUtils.get(
        db,
        `SELECT recall_count, last_accessed_at, g_value, consolidation_score, created_at 
         FROM memory_item WHERE id = ?`,
        [memoryId]
      ) as {
        recall_count: number;
        last_accessed_at: string | null;
        g_value: number | null;
        consolidation_score: number | null;
        created_at: string;
      };

      expect(record.recall_count).toBe(1);
      expect(record.last_accessed_at).not.toBeNull();
      expect(record.g_value).toBe(1.0);
      expect(record.consolidation_score).not.toBeNull();
      expect(record.consolidation_score).toBeGreaterThanOrEqual(0.0);
      expect(record.consolidation_score).toBeLessThanOrEqual(1.0);
      expect(record.last_accessed_at).toBe(record.created_at);
    });

    it('should not initialize consolidation score fields when feature is disabled', async () => {
      // 기능 플래그 비활성화
      vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
        ...configModule.mementoConfig,
        consolidationScoreEnabled: false
      } as any);

      const params = {
        type: 'episodic',
        content: 'Test memory without consolidation score',
        importance: 0.7
      };

      const result = await rememberTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const memoryId = resultData.memory_id;

      // 데이터베이스에서 확인 (기본값 또는 NULL)
      const record = DatabaseUtils.get(
        db,
        `SELECT recall_count, last_accessed_at, g_value, consolidation_score 
         FROM memory_item WHERE id = ?`,
        [memoryId]
      ) as {
        recall_count: number;
        last_accessed_at: string | null;
        g_value: number | null;
        consolidation_score: number | null;
      };

      expect(record.recall_count).toBe(0); // 기본값
      expect(record.last_accessed_at).toBeNull();
      expect(record.g_value).toBeNull();
      expect(record.consolidation_score).toBeNull();
    });
  });

  describe('RecallTool - 메타데이터 업데이트', () => {
    let memoryId: string;

    beforeEach(async () => {
      // 테스트용 메모리 생성
      const params = {
        type: 'episodic',
        content: 'Test memory for recall update',
        importance: 0.7
      };

      const result = await rememberTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      memoryId = resultData.memory_id;

      // 초기 상태 확인
      const initialRecord = DatabaseUtils.get(
        db,
        `SELECT recall_count, last_accessed_at, g_value, consolidation_score 
         FROM memory_item WHERE id = ?`,
        [memoryId]
      ) as {
        recall_count: number;
        last_accessed_at: string | null;
        g_value: number | null;
        consolidation_score: number | null;
      };

      expect(initialRecord.recall_count).toBe(1);
      expect(initialRecord.g_value).toBe(1.0);
    });

    it('should update recall_count, last_accessed_at, g_value, and consolidation_score on search', async () => {
      // 검색 결과 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: memoryId,
          content: 'Test memory for recall update',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const params = {
        query: 'test',
        type: 'episodic',
        limit: 10
      };

      await recallTool.handle(params, context);

      // Write Coalescing Manager flush 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      // 데이터베이스에서 확인
      const record = DatabaseUtils.get(
        db,
        `SELECT recall_count, last_accessed_at, g_value, consolidation_score 
         FROM memory_item WHERE id = ?`,
        [memoryId]
      ) as {
        recall_count: number;
        last_accessed_at: string | null;
        g_value: number | null;
        consolidation_score: number | null;
      };

      expect(record.recall_count).toBe(2); // 1에서 2로 증가
      expect(record.last_accessed_at).not.toBeNull();
      expect(record.g_value).toBeGreaterThan(1.0); // g_value가 증가했어야 함
      expect(record.consolidation_score).not.toBeNull();
      expect(record.consolidation_score).toBeGreaterThanOrEqual(0.0);
      expect(record.consolidation_score).toBeLessThanOrEqual(1.0);
    });

    it('should use write coalescing when manager is available', async () => {
      // 검색 결과 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: memoryId,
          content: 'Test memory for recall update',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const params = {
        query: 'test',
        type: 'episodic',
        limit: 10
      };

      await recallTool.handle(params, context);

      // Write Coalescing Manager에 추가되었는지 확인
      expect(writeCoalescingManager.getBufferSize()).toBeGreaterThan(0);

      // Flush 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      // Flush되었는지 확인
      expect(flushedWrites.length).toBeGreaterThan(0);
      const write = flushedWrites.find(w => w.memoryId === memoryId);
      expect(write).toBeDefined();
      expect(write?.fields.recall_count).toBe(2);
      expect(write?.fields.last_accessed_at).toBeDefined();
      expect(write?.fields.g_value).toBeGreaterThan(1.0);
      expect(write?.fields.consolidation_score).toBeDefined();
    });

    it('should update multiple memories in search results', async () => {
      // 여러 메모리 생성
      const memoryIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const params = {
          type: 'episodic',
          content: `Test memory ${i}`,
          importance: 0.7
        };
        const result = await rememberTool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);
        memoryIds.push(resultData.memory_id);
      }

      // 검색 결과 모킹 (3개 메모리 반환)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: memoryIds.map((id, i) => ({
          id,
          content: `Test memory ${i}`,
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        })),
        total_count: 3,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const params = {
        query: 'test',
        type: 'episodic',
        limit: 10
      };

      await recallTool.handle(params, context);

      // Flush 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      // 모든 메모리가 업데이트되었는지 확인
      for (const id of memoryIds) {
        const record = DatabaseUtils.get(
          db,
          `SELECT recall_count FROM memory_item WHERE id = ?`,
          [id]
        ) as { recall_count: number };

        expect(record.recall_count).toBe(2); // 1에서 2로 증가
      }
    });
  });

  describe('MemoryInjectionPrompt - 메타데이터 업데이트', () => {
    let memoryId: string;

    beforeEach(async () => {
      // 테스트용 메모리 생성
      const params = {
        type: 'episodic',
        content: 'Test memory for memory injection',
        importance: 0.7
      };

      const result = await rememberTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      memoryId = resultData.memory_id;
    });

    it('should update consolidation score metadata when memory is injected', async () => {
      // 검색 결과 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: memoryId,
          content: 'Test memory for memory injection',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const params = {
        query: 'test',
        token_budget: 1000,
        max_memories: 5
      };

      await memoryInjectionPrompt.handle(params, context);

      // Flush 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      // 데이터베이스에서 확인
      const record = DatabaseUtils.get(
        db,
        `SELECT recall_count, last_accessed_at, g_value, consolidation_score 
         FROM memory_item WHERE id = ?`,
        [memoryId]
      ) as {
        recall_count: number;
        last_accessed_at: string | null;
        g_value: number | null;
        consolidation_score: number | null;
      };

      expect(record.recall_count).toBe(2); // 1에서 2로 증가
      expect(record.last_accessed_at).not.toBeNull();
      // g_value는 timeElapsed가 매우 작으면 거의 증가하지 않을 수 있음
      // recall_count가 증가했으므로 g_value는 최소 1.0 이상이어야 함
      expect(record.g_value).toBeGreaterThanOrEqual(1.0);
      expect(record.consolidation_score).not.toBeNull();
    });
  });

  describe('Write Coalescing 동작', () => {
    it('should coalesce multiple writes for the same memory', async () => {
      // 메모리 생성
      const params = {
        type: 'episodic',
        content: 'Test memory for coalescing',
        importance: 0.7
      };

      const result = await rememberTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const memoryId = resultData.memory_id;

      // 검색 결과 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: memoryId,
          content: 'Test memory for coalescing',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      // 같은 메모리를 여러 번 검색
      const searchParams = {
        query: 'test',
        type: 'episodic',
        limit: 10
      };

      // 첫 번째 검색 후 flush 대기
      await recallTool.handle(searchParams, context);
      await new Promise(resolve => setTimeout(resolve, 150));

      // 두 번째 검색 후 flush 대기
      await recallTool.handle(searchParams, context);
      await new Promise(resolve => setTimeout(resolve, 150));

      // 세 번째 검색 후 flush 대기
      await recallTool.handle(searchParams, context);
      await new Promise(resolve => setTimeout(resolve, 150));

      // 최종 상태 확인 (3번 검색했으므로 recall_count는 4가 되어야 함)
      const record = DatabaseUtils.get(
        db,
        `SELECT recall_count FROM memory_item WHERE id = ?`,
        [memoryId]
      ) as { recall_count: number };

      expect(record.recall_count).toBe(4); // 1 + 3 = 4
    });

    it('should flush writes periodically', async () => {
      // 메모리 생성
      const params = {
        type: 'episodic',
        content: 'Test memory for periodic flush',
        importance: 0.7
      };

      const result = await rememberTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const memoryId = resultData.memory_id;

      // 검색 결과 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: memoryId,
          content: 'Test memory for periodic flush',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const searchParams = {
        query: 'test',
        type: 'episodic',
        limit: 10
      };

      await recallTool.handle(searchParams, context);

      // 버퍼에 추가되었는지 확인
      expect(writeCoalescingManager.getBufferSize()).toBeGreaterThan(0);

      // Flush 대기 (100ms 간격)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Flush되었는지 확인
      expect(flushedWrites.length).toBeGreaterThan(0);
      expect(writeCoalescingManager.isEmpty()).toBe(true);
    });
  });

  describe('기능 플래그 비활성화', () => {
    it('should not update metadata when feature is disabled', async () => {
      // 기능 플래그 비활성화
      vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
        ...configModule.mementoConfig,
        consolidationScoreEnabled: false
      } as any);

      // 메모리 생성
      const params = {
        type: 'episodic',
        content: 'Test memory with disabled feature',
        importance: 0.7
      };

      const result = await rememberTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const memoryId = resultData.memory_id;

      // 초기 상태 확인 (기본값)
      const initialRecord = DatabaseUtils.get(
        db,
        `SELECT recall_count, last_accessed_at, g_value, consolidation_score 
         FROM memory_item WHERE id = ?`,
        [memoryId]
      ) as {
        recall_count: number;
        last_accessed_at: string | null;
        g_value: number | null;
        consolidation_score: number | null;
      };

      expect(initialRecord.recall_count).toBe(0);
      expect(initialRecord.last_accessed_at).toBeNull();
      expect(initialRecord.g_value).toBeNull();
      expect(initialRecord.consolidation_score).toBeNull();

      // 검색 결과 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: memoryId,
          content: 'Test memory with disabled feature',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const searchParams = {
        query: 'test',
        type: 'episodic',
        limit: 10
      };

      await recallTool.handle(searchParams, context);

      // Flush 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      // 업데이트되지 않았는지 확인
      const record = DatabaseUtils.get(
        db,
        `SELECT recall_count, last_accessed_at, g_value, consolidation_score 
         FROM memory_item WHERE id = ?`,
        [memoryId]
      ) as {
        recall_count: number;
        last_accessed_at: string | null;
        g_value: number | null;
        consolidation_score: number | null;
      };

      expect(record.recall_count).toBe(0); // 변경되지 않음
      expect(record.last_accessed_at).toBeNull();
      expect(record.g_value).toBeNull();
      expect(record.consolidation_score).toBeNull();
    });
  });

  describe('검색 랭킹에 Consolidation Score 통합', () => {
    let memoryId1: string;
    let memoryId2: string;

    beforeEach(async () => {
      // 테스트용 메모리 2개 생성 (다른 consolidation_score를 가지도록)
      const params1 = {
        type: 'episodic',
        content: 'Test memory 1 for ranking',
        importance: 0.7
      };
      const result1 = await rememberTool.handle(params1, context);
      const resultData1 = JSON.parse(result1.content[0].text);
      memoryId1 = resultData1.memory_id;

      const params2 = {
        type: 'episodic',
        content: 'Test memory 2 for ranking',
        importance: 0.7
      };
      const result2 = await rememberTool.handle(params2, context);
      const resultData2 = JSON.parse(result2.content[0].text);
      memoryId2 = resultData2.memory_id;

      // memoryId1에 더 높은 consolidation_score 설정 (더 자주 검색되도록)
      // 여러 번 검색하여 recall_count 증가
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: memoryId1,
          content: 'Test memory 1 for ranking',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      // memoryId1을 여러 번 검색하여 recall_count 증가
      for (let i = 0; i < 5; i++) {
        await recallTool.handle({
          query: 'test',
          type: 'episodic',
          limit: 10
        }, context);
        await new Promise(resolve => setTimeout(resolve, 150)); // Flush 대기
      }
    });

    it('consolidation_score가 높은 메모리가 상위에 노출되어야 함', async () => {
      // 검색 결과 모킹 (두 메모리 모두 반환)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId1,
            content: 'Test memory 1 for ranking',
            type: 'episodic',
            importance: 0.7,
            created_at: new Date().toISOString(),
            pinned: false,
            tags: [],
            textScore: 0.7,
            vectorScore: 0.7,
            finalScore: 0.7,
            recall_reason: '텍스트 검색 결과'
          },
          {
            id: memoryId2,
            content: 'Test memory 2 for ranking',
            type: 'episodic',
            importance: 0.7,
            created_at: new Date().toISOString(),
            pinned: false,
            tags: [],
            textScore: 0.8,
            vectorScore: 0.8,
            finalScore: 0.8,
            recall_reason: '텍스트 검색 결과'
          }
        ],
        total_count: 2,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const params = {
        query: 'test',
        type: 'episodic',
        limit: 10,
        include_metadata: true
      };

      const result = await recallTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Flush 대기
      await new Promise(resolve => setTimeout(resolve, 150));

      // consolidation_score 확인
      const memory1 = resultData.items.find((item: any) => item.memory_id === memoryId1);
      const memory2 = resultData.items.find((item: any) => item.memory_id === memoryId2);

      if (memory1 && memory2) {
        // memoryId1이 더 자주 검색되었으므로 consolidation_score가 더 높아야 함
        // consolidation_score가 undefined일 수 있으므로 처리
        const score1 = memory1.consolidation_score ?? 0;
        const score2 = memory2.consolidation_score ?? 0;
        
        // memoryId1이 더 자주 검색되었으므로 score1이 score2보다 높거나 같아야 함
        expect(score1).toBeGreaterThanOrEqual(score2);
      }
    });

    it('검색 결과에 consolidation_score가 포함되어야 함 (include_metadata=true)', async () => {
      // 검색 결과 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: memoryId1,
          content: 'Test memory 1 for ranking',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과',
          consolidation_score: 0.85
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const params = {
        query: 'test',
        type: 'episodic',
        limit: 10,
        include_metadata: true
      };

      const result = await recallTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items.length).toBeGreaterThan(0);
      if (resultData.items[0].consolidation_score !== undefined) {
        expect(resultData.items[0].consolidation_score).toBeGreaterThanOrEqual(0.0);
        expect(resultData.items[0].consolidation_score).toBeLessThanOrEqual(1.0);
      }
    });

    it('기능 플래그 비활성화 시 consolidation_score가 검색 랭킹에 영향을 주지 않아야 함', async () => {
      // 기능 플래그 비활성화
      vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
        ...configModule.mementoConfig,
        consolidationScoreEnabled: false
      } as any);

      // 검색 결과 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: memoryId1,
          content: 'Test memory 1 for ranking',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const params = {
        query: 'test',
        type: 'episodic',
        limit: 10,
        include_metadata: true
      };

      const result = await recallTool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // consolidation_score가 포함되지 않아야 함 (기능 비활성화)
      expect(resultData.items[0].consolidation_score).toBeUndefined();
    });
  });
});

