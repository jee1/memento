import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { RecallTool } from '../recall-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import { HybridSearchEngine } from '../../../algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../../memory-embedding-service.js';

/**
 * 테스트용 데이터베이스 초기화
 */
function initializeTestDatabase(db: Database.Database): void {
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
      origin_source TEXT,
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS core_memory (
      core_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      always_load BOOLEAN NOT NULL DEFAULT 0,
      origin_source TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key)
    );

    CREATE TABLE IF NOT EXISTS knowledge_vault (
      vault_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      immutable BOOLEAN NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      previous_version_id TEXT,
      admin_override BOOLEAN NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP,
      origin_source TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key, version)
    );

    CREATE INDEX IF NOT EXISTS idx_core_memory_agent_id ON core_memory(agent_id);
    CREATE INDEX IF NOT EXISTS idx_core_memory_key ON core_memory(key);
    CREATE INDEX IF NOT EXISTS idx_knowledge_vault_agent_id ON knowledge_vault(agent_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_vault_key ON knowledge_vault(key);
  `);
}

describe('RecallTool', () => {
  let db: Database.Database;
  let tool: RecallTool;
  let context: ToolContext;
  let hybridSearchEngine: HybridSearchEngine;
  let embeddingService: MemoryEmbeddingService;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    embeddingService = new MemoryEmbeddingService();
    hybridSearchEngine = new HybridSearchEngine();

    tool = new RecallTool();

    context = {
      db,
      services: {
        hybridSearchEngine,
        embeddingService
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
      const definition = tool.getDefinition();
      expect(definition.name).toBe('recall');
      expect(definition.description).toBe('관련 기억을 검색합니다');
    });

    it('should have correct input schema with new fields', () => {
      const definition = tool.getDefinition();
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('type');
      expect(definition.inputSchema.properties).toHaveProperty('key');
      expect(definition.inputSchema.properties).toHaveProperty('agent_id');
      expect(definition.inputSchema.properties.memory_types.items.enum).toContain('core');
      expect(definition.inputSchema.properties.memory_types.items.enum).toContain('vault');
    });
  });

  describe('Core Memory 조회', () => {
    beforeEach(() => {
      // 테스트 데이터 준비
      const originSource = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'core' }
      });

      DatabaseUtils.run(db, `
        INSERT INTO core_memory (core_id, agent_id, key, value, always_load, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['core_123', 'default', 'persona', 'I am helpful', 1, originSource]);

      DatabaseUtils.run(db, `
        INSERT INTO core_memory (core_id, agent_id, key, value, always_load, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['core_456', 'default', 'instructions', 'Be polite', 0, originSource]);
    });

    it('should retrieve all core memories when type=core and no key', async () => {
      const params = {
        type: 'core'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(2);
      expect(resultData.items[0].type).toBe('core');
      expect(resultData.items[0]).toHaveProperty('memory_id');
      expect(resultData.items[0]).toHaveProperty('key');
      expect(resultData.items[0]).toHaveProperty('value');
      expect(resultData.items[0]).toHaveProperty('origin_source');
    });

    it('should retrieve specific core memory when type=core and key provided', async () => {
      const params = {
        type: 'core',
        key: 'persona'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].key).toBe('persona');
      expect(resultData.items[0].value).toBe('I am helpful');
      expect(resultData.items[0].origin_source).toBeDefined();
    });

    it('should return empty array when key not found', async () => {
      const params = {
        type: 'core',
        key: 'nonexistent'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(0);
    });

    it('should ignore query parameter when type=core', async () => {
      const params = {
        type: 'core',
        query: 'should be ignored',
        key: 'persona'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.search_type).toBe('direct');
    });

    it('should include origin_source in response', async () => {
      const params = {
        type: 'core',
        key: 'persona'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items[0].origin_source).toBeDefined();
      expect(resultData.items[0].origin_source.tool).toBe('remember');
      expect(resultData.items[0].origin_source.caller).toBe('user');
    });
  });

  describe('Knowledge Vault 조회', () => {
    beforeEach(() => {
      const originSource = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'vault' }
      });

      DatabaseUtils.run(db, `
        INSERT INTO knowledge_vault (vault_id, agent_id, key, value, immutable, version, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['vault_123', 'default', 'user_rules', 'Never share personal info', 1, 1, originSource]);

      DatabaseUtils.run(db, `
        INSERT INTO knowledge_vault (vault_id, agent_id, key, value, immutable, version, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['vault_456', 'default', 'api_keys', 'encrypted_data', 1, 1, originSource]);
    });

    it('should retrieve all vault items when type=vault and no key', async () => {
      const params = {
        type: 'vault'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(2);
      expect(resultData.items[0].type).toBe('vault');
      expect(resultData.items[0]).toHaveProperty('memory_id');
      expect(resultData.items[0]).toHaveProperty('key');
      expect(resultData.items[0]).toHaveProperty('value');
      expect(resultData.items[0]).toHaveProperty('origin_source');
    });

    it('should retrieve specific vault item when type=vault and key provided', async () => {
      const params = {
        type: 'vault',
        key: 'user_rules'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].key).toBe('user_rules');
      expect(resultData.items[0].value).toBe('Never share personal info');
      expect(resultData.items[0].origin_source).toBeDefined();
    });

    it('should ignore query parameter when type=vault', async () => {
      const params = {
        type: 'vault',
        query: 'should be ignored',
        key: 'user_rules'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.search_type).toBe('direct');
    });

    it('should include origin_source in response', async () => {
      const params = {
        type: 'vault',
        key: 'user_rules'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items[0].origin_source).toBeDefined();
      expect(resultData.items[0].origin_source.tool).toBe('remember');
    });
  });

  describe('Memory Item 검색', () => {
    beforeEach(() => {
      const originSource = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'episodic' }
      });

      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem_1', 'episodic', 'I learned React hooks', 0.7, 'private', originSource]);

      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem_2', 'semantic', 'React is a library', 0.9, 'private', originSource]);

      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, origin_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem_3', 'procedural', 'How to deploy', 0.8, 'private', originSource]);
    });

    it('should require query parameter for memory_item search', async () => {
      const params = {
        type: 'episodic'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should filter by type parameter', async () => {
      const params = {
        type: 'episodic',
        query: 'React'
      };

      // hybridSearchEngine.search를 모킹
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: 'mem_1',
          content: 'I learned React hooks',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          origin_source: JSON.stringify({
            tool: 'remember',
            caller: 'user',
            timestamp: new Date().toISOString(),
            context: { type: 'episodic' }
          }),
          textScore: 0.8,
          vectorScore: 0.7,
          finalScore: 0.75,
          recall_reason: '텍스트 검색 결과'
        }],
        total_count: 1,
        query_time: 10
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].type).toBe('episodic');
    });

    it('should filter memory_types array and remove core/vault', async () => {
      const params = {
        query: 'test',
        memory_types: ['episodic', 'core', 'vault']
      };

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 5
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle(params, context);

      // memory_types에서 core/vault가 제거되었는지 확인
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: ['episodic']
          })
        })
      );
    });

    it('should include origin_source in memory_item search results', async () => {
      const originSource = JSON.stringify({
        tool: 'remember',
        caller: 'user',
        timestamp: new Date().toISOString(),
        context: { type: 'episodic' }
      });

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [{
          id: 'mem_1',
          content: 'I learned React hooks',
          type: 'episodic',
          importance: 0.7,
          created_at: new Date().toISOString(),
          pinned: false,
          tags: [],
          origin_source: originSource,
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
        query: 'React',
        type: 'episodic',
        include_metadata: true
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items[0].origin_source).toBeDefined();
      expect(resultData.items[0].origin_source.tool).toBe('remember');
      expect(resultData.items[0].origin_source.caller).toBe('user');
    });

    it('should use type parameter over memory_types when both provided', async () => {
      const params = {
        query: 'test',
        type: 'episodic',
        memory_types: ['semantic', 'procedural']
      };

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 5
      });

      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);

      await tool.handle(params, context);

      // type 파라미터가 우선 적용되었는지 확인
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          filters: expect.objectContaining({
            type: ['episodic']
          })
        })
      );
    });
  });

  describe('에러 처리', () => {
    it('should handle database errors gracefully', async () => {
      const params = {
        type: 'core'
      };

      db.close();

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should handle missing hybridSearchEngine for memory_item search', async () => {
      const params = {
        query: 'test',
        type: 'episodic'
      };

      context.services.hybridSearchEngine = undefined;

      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });

  describe('Provider 필터링 기능', () => {
    beforeEach(() => {
      // Mock hybridSearchEngine 메서드들
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 10
      });
      vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
    });

    it('단일 provider 필터 - 지정된 provider만 검색', async () => {
      // Given: provider_filter로 minilm만 지정
      const params = {
        query: 'test query',
        type: 'episodic',
        provider_filter: ['minilm']
      };

      // When: recall 도구 실행
      const result = await tool.handle(params, context);

      // Then: provider_filter가 HybridSearchQuery에 전달되어야 함
      expect(result).toBeDefined();
      if (result && typeof result === 'object' && 'content' in result) {
        // ToolResult가 content를 포함하는 경우
        expect(hybridSearchEngine.search).toHaveBeenCalledWith(
          db,
          expect.objectContaining({
            query: 'test query',
            provider_filter: ['minilm']
          })
        );
      } else {
        // ToolResult가 success 필드를 포함하는 경우
        expect((result as any).success).toBe(true);
        expect(hybridSearchEngine.search).toHaveBeenCalledWith(
          db,
          expect.objectContaining({
            query: 'test query',
            provider_filter: ['minilm']
          })
        );
      }
    });

    it('다중 provider 필터 - 여러 provider 지정', async () => {
      // Given: provider_filter로 minilm과 openai 지정
      const params = {
        query: 'test query',
        type: 'episodic',
        provider_filter: ['minilm', 'openai']
      };

      // When: recall 도구 실행
      const result = await tool.handle(params, context);

      // Then: provider_filter가 HybridSearchQuery에 전달되어야 함
      expect(result).toBeDefined();
      expect(hybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          query: 'test query',
          provider_filter: ['minilm', 'openai']
        })
      );
    });

    it('필터 없음 케이스 - provider_filter 미지정 시 모든 provider 검색', async () => {
      // Given: provider_filter 없이 검색
      const params = {
        query: 'test query',
        type: 'episodic'
      };

      // When: recall 도구 실행
      const result = await tool.handle(params, context);

      // Then: provider_filter가 undefined이거나 전달되지 않아야 함
      expect(result).toBeDefined();
      expect(hybridSearchEngine.search).toHaveBeenCalled();
      const searchCall = (hybridSearchEngine.search as any).mock.calls[0];
      const searchQuery = searchCall[1];
      // provider_filter가 없거나 undefined여야 함 (모든 provider 검색)
      expect(searchQuery.provider_filter).toBeUndefined();
    });

    it('provider_filter 스키마 검증 - 유효하지 않은 provider 거부', async () => {
      // Given: 유효하지 않은 provider 포함
      const params = {
        query: 'test query',
        type: 'episodic',
        provider_filter: ['invalid_provider', 'minilm']
      };

      // When/Then: 스키마 검증 실패
      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });

  describe('reflection_notes 조회', () => {
    const createValidReflectionNote = (overrides: Partial<any> = {}) => ({
      failure_type: 'tool_error',
      failure_description: 'Test error',
      timestamp: new Date().toISOString(),
      ...overrides
    });

    beforeEach(() => {
      // 테스트용 procedural memory 데이터 생성
      const reflectionNote1 = createValidReflectionNote({ 
        timestamp: '2025-01-01T00:00:00Z',
        failure_description: 'Error 1'
      });
      const reflectionNote2 = createValidReflectionNote({ 
        timestamp: '2025-01-02T00:00:00Z',
        failure_description: 'Error 2'
      });

      // reflection_notes가 있는 procedural memory
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'proc_1',
        'procedural',
        'Test procedure 1',
        'Task A',
        JSON.stringify(['step1', 'step2']),
        JSON.stringify(reflectionNote1),
        0.8,
        'private',
        new Date().toISOString()
      ]);

      // reflection_notes가 배열인 procedural memory
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'proc_2',
        'procedural',
        'Test procedure 2',
        'Task B',
        JSON.stringify(['step1']),
        JSON.stringify([reflectionNote1, reflectionNote2]),
        0.7,
        'private',
        new Date().toISOString()
      ]);

      // reflection_notes가 없는 procedural memory
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'proc_3',
        'procedural',
        'Test procedure 3',
        'Task C',
        JSON.stringify(['step1']),
        null,
        0.6,
        'private',
        new Date().toISOString()
      ]);

      // episodic memory (reflection_notes 없음)
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        'epi_1',
        'episodic',
        'Test episodic memory',
        0.5,
        'private',
        new Date().toISOString()
      ]);

      // FTS5 인덱스 생성 (검색을 위해 필요)
      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
            content,
            tags,
            reflection_notes,
            content=memory_item,
            content_rowid=rowid
          );
        `);
        
        // FTS5 인덱스에 데이터 삽입
        db.exec(`
          INSERT INTO memory_item_fts(rowid, content, tags, reflection_notes)
          SELECT rowid, content, tags, reflection_notes FROM memory_item;
        `);
      } catch (error) {
        // FTS5 테이블이 이미 존재하거나 생성 실패 시 무시
      }
    });

    describe('includeMetadata가 true일 때 reflection_notes 포함', () => {
      it('should include reflection_notes when includeMetadata is true', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(createValidReflectionNote({ 
                timestamp: '2025-01-01T00:00:00Z',
                failure_description: 'Error 1'
              })),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBeGreaterThan(0);
        
        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(proceduralItem.reflection_notes).not.toBeNull();
      });

      it('should not include reflection_notes when includeMetadata is false', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: false,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              reflection_notes: JSON.stringify(createValidReflectionNote()),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.items).toBeDefined();
        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeUndefined();
      });
    });

    describe('Procedural Memory 조회 시 reflection_notes 자동 포함', () => {
      it('should automatically include reflection_notes for procedural memory', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(createValidReflectionNote()),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(proceduralItem.task_goal).toBe('Task A');
        expect(proceduralItem.steps).toBeDefined();
      });

      it('should not include reflection_notes for non-procedural memory', async () => {
        const params = {
          query: 'Test episodic',
          type: 'episodic',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'epi_1',
              content: 'Test episodic memory',
              type: 'episodic',
              importance: 0.5,
              created_at: new Date().toISOString(),
              finalScore: 0.8,
              textScore: 0.5,
              vectorScore: 0.3,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const episodicItem = resultData.items.find((item: any) => item.type === 'episodic');
        expect(episodicItem).toBeDefined();
        expect(episodicItem.reflection_notes).toBeUndefined();
        expect(episodicItem.task_goal).toBeUndefined();
        expect(episodicItem.steps).toBeUndefined();
      });
    });

    describe('reflection_notes JSON 파싱', () => {
      it('should parse reflection_notes from string to object', async () => {
        const reflectionNote = createValidReflectionNote({ 
          timestamp: '2025-01-01T00:00:00Z',
          failure_description: 'Error 1'
        });

        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(reflectionNote),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(typeof proceduralItem.reflection_notes).toBe('object');
        expect(proceduralItem.reflection_notes.failure_type).toBe('tool_error');
        expect(proceduralItem.reflection_notes.failure_description).toBe('Error 1');
      });

      it('should parse reflection_notes from string to array', async () => {
        const reflectionNotes = [
          createValidReflectionNote({ timestamp: '2025-01-01T00:00:00Z', failure_description: 'Error 1' }),
          createValidReflectionNote({ timestamp: '2025-01-02T00:00:00Z', failure_description: 'Error 2' })
        ];

        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_2',
              content: 'Test procedure 2',
              type: 'procedural',
              importance: 0.7,
              created_at: new Date().toISOString(),
              task_goal: 'Task B',
              steps: JSON.stringify(['step1']),
              reflection_notes: JSON.stringify(reflectionNotes),
              finalScore: 0.8,
              textScore: 0.5,
              vectorScore: 0.3,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(Array.isArray(proceduralItem.reflection_notes)).toBe(true);
        expect(proceduralItem.reflection_notes).toHaveLength(2);
        expect(proceduralItem.reflection_notes[0].failure_description).toBe('Error 1');
        expect(proceduralItem.reflection_notes[1].failure_description).toBe('Error 2');
      });

      it('should return original string when JSON parsing fails', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: '{ invalid json }',
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(typeof proceduralItem.reflection_notes).toBe('string');
        expect(proceduralItem.reflection_notes).toBe('{ invalid json }');
      });

      it('should return null when reflection_notes is null', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_3',
              content: 'Test procedure 3',
              type: 'procedural',
              importance: 0.6,
              created_at: new Date().toISOString(),
              task_goal: 'Task C',
              steps: JSON.stringify(['step1']),
              reflection_notes: null,
              finalScore: 0.7,
              textScore: 0.5,
              vectorScore: 0.2,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeNull();
      });
    });

    describe('has_reflection_notes 필터링', () => {
      it('should filter memories with reflection_notes when has_reflection_notes is true', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          has_reflection_notes: true,
          include_metadata: true,
          limit: 10
        };

        // has_reflection_notes 필터가 적용되어야 함
        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(createValidReflectionNote()),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // has_reflection_notes 필터가 search 호출에 전달되었는지 확인
        expect(hybridSearchEngine.search).toHaveBeenCalled();
        const searchCall = (hybridSearchEngine.search as any).mock.calls[0];
        const searchQuery = searchCall[1];
        expect(searchQuery.filters?.has_reflection_notes).toBe(true);
      });

      it('should filter memories without reflection_notes when has_reflection_notes is false', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          has_reflection_notes: false,
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_3',
              content: 'Test procedure 3',
              type: 'procedural',
              importance: 0.6,
              created_at: new Date().toISOString(),
              task_goal: 'Task C',
              steps: JSON.stringify(['step1']),
              reflection_notes: null,
              finalScore: 0.7,
              textScore: 0.5,
              vectorScore: 0.2,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // has_reflection_notes 필터가 search 호출에 전달되었는지 확인
        expect(hybridSearchEngine.search).toHaveBeenCalled();
        const searchCall = (hybridSearchEngine.search as any).mock.calls[0];
        const searchQuery = searchCall[1];
        expect(searchQuery.filters?.has_reflection_notes).toBe(false);
      });
    });
  });
});

