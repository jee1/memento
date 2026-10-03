import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { ToolInputValidationError } from '../../../../shared/errors/tool-input-validation-error.js';
import { RememberTool } from '../remember-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import { getVectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../../services/memory-embedding-service.js';
import { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import * as configModule from '../../../../shared/config/index.js';
import * as environmentCheck from '../../../../shared/utils/environment-check.js';
import { getBatchScheduler, resetBatchScheduler } from '../../../../infrastructure/scheduler/batch-scheduler.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';

/**
 * 테스트용 데이터베이스 초기화
 */
function initializeTestDatabase(db: Database.Database): void {
  // memory_item 테이블 생성 (마이그레이션 필드 포함)
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
      -- Procedural Memory Enhancement (v7.0) 필드
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT,
      -- Consolidation Score 필드
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      consolidation_score REAL,
      g_value REAL,
      -- AriGraph Pipeline 필드
      subject TEXT,
      predicate TEXT,
      object TEXT,
      triple_extraction_metadata TEXT DEFAULT NULL,
      -- Procedural Version Management (Issue #57)
      version INTEGER NULL,
      version_series_id TEXT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
      -- Fact metadata (Issue #88)
      num_times INTEGER NOT NULL DEFAULT 1,
      last_mentioned_at TIMESTAMP,
      source_session_id TEXT,
      confidence REAL,
      -- Project-scoped memory (Issue #81)
      project_id TEXT NULL,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_desc ON memory_item(consolidation_score DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2;

    CREATE TABLE IF NOT EXISTS core_memory (
      core_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      always_load BOOLEAN NOT NULL DEFAULT 0,
      origin_source TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_core_memory_version ON core_memory(version);
    UPDATE core_memory SET version = 1 WHERE version = 0;

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

describe('RememberTool', () => {
  let db: Database.Database;
  let tool: RememberTool;
  let context: ToolContext;
  let hybridSearchEngine: HybridSearchEngine;
  let embeddingService: MemoryEmbeddingService;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    embeddingService = new MemoryEmbeddingService();
    hybridSearchEngine = new HybridSearchEngine();

    tool = new RememberTool();

    // BatchScheduler 초기화 (AriGraph Pipeline 테스트용)
    resetBatchScheduler();
    const batchScheduler = getBatchScheduler();
    batchScheduler.start(db, null);

    context = {
      db,
      services: {
        hybridSearchEngine,
        embeddingService,
        relationGraph: createRelationGraph(db)
      }
    };
  });

  afterEach(async () => {
    // BatchScheduler 정리
    const batchScheduler = getBatchScheduler();
    if (batchScheduler.getStatus().isRunning) {
      await batchScheduler.stop();
    }
    resetBatchScheduler();

    if (db) {
      db.close();
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('초기화', () => {
    it('should create tool with correct name and description', () => {
      const definition = tool.getDefinition();
      expect(definition.name).toBe('remember');
      expect(definition.description).toBe('새로운 기억을 저장합니다');
    });

    it('should have correct input schema with new fields', () => {
      const definition = tool.getDefinition();
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('type');
      expect(definition.inputSchema.properties).toHaveProperty('key');
      expect(definition.inputSchema.properties).toHaveProperty('value');
      expect(definition.inputSchema.properties).toHaveProperty('always_load');
      expect(definition.inputSchema.properties).toHaveProperty('immutable');
      expect(definition.inputSchema.properties).toHaveProperty('task_goal');
      expect(definition.inputSchema.properties).toHaveProperty('steps');
      expect(definition.inputSchema.properties).toHaveProperty('reflection_notes');
    });
  });

  describe('Core Memory 저장', () => {
    it('should create core memory with key and value', async () => {
      const params = {
        type: 'core',
        key: 'persona',
        value: 'I am a helpful assistant',
        always_load: true
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.memory_id).toMatch(/^core_\d+_[a-z0-9]+$/);
      expect(resultData.type).toBe('core');

      // 데이터베이스에서 확인
      const record = DatabaseUtils.get(db, 'SELECT * FROM core_memory WHERE key = ?', ['persona']);
      expect(record).toBeDefined();
      expect(record.key).toBe('persona');
      expect(record.value).toBe('I am a helpful assistant');
      expect(record.always_load).toBe(1);
      expect(record.origin_source).toBeDefined();
    });

    it('should create core memory with origin_source', async () => {
      const params = {
        type: 'core',
        key: 'instructions',
        value: 'Always be polite',
        always_load: false
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      const record = DatabaseUtils.get(db, 'SELECT * FROM core_memory WHERE key = ?', ['instructions']);
      const originSource = JSON.parse(record.origin_source);
      
      expect(originSource.tool).toBe('remember');
      expect(originSource.caller).toBe('user');
      expect(originSource.context.type).toBe('core');
      expect(originSource.context.has_key).toBe(true);
      expect(originSource.context.has_value).toBe(true);
    });

    it('should fail when key is missing for core memory', async () => {
      const params = {
        type: 'core',
        value: 'Some value'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should fail when value is missing for core memory', async () => {
      const params = {
        type: 'core',
        key: 'some_key'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });

  describe('Knowledge Vault 저장', () => {
    it('should create knowledge vault with key and value', async () => {
      const params = {
        type: 'vault',
        key: 'user_rules',
        value: 'Never share personal information',
        immutable: true
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.memory_id).toMatch(/^vault_\d+_[a-z0-9]+$/);
      expect(resultData.type).toBe('vault');

      // 데이터베이스에서 확인
      const record = DatabaseUtils.get(db, 'SELECT * FROM knowledge_vault WHERE key = ?', ['user_rules']);
      expect(record).toBeDefined();
      expect(record.key).toBe('user_rules');
      expect(record.value).toBe('Never share personal information');
      expect(record.immutable).toBe(1);
      expect(record.origin_source).toBeDefined();
    });

    it('should create knowledge vault with origin_source', async () => {
      const params = {
        type: 'vault',
        key: 'api_keys',
        value: 'encrypted_key_data',
        immutable: true
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      const record = DatabaseUtils.get(db, 'SELECT * FROM knowledge_vault WHERE key = ?', ['api_keys']);
      const originSource = JSON.parse(record.origin_source);
      
      expect(originSource.tool).toBe('remember');
      expect(originSource.caller).toBe('user');
      expect(originSource.context.type).toBe('vault');
    });

    it('should fail when key is missing for vault', async () => {
      const params = {
        type: 'vault',
        value: 'Some value'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should fail when value is missing for vault', async () => {
      const params = {
        type: 'vault',
        key: 'some_key'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });

  describe('Episodic Memory 저장', () => {
    it('should create episodic memory with content', async () => {
      const params = {
        type: 'episodic',
        content: 'I learned about React hooks today',
        importance: 0.7,
        tags: ['react', 'learning']
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.memory_id).toMatch(/^mem_\d+_[a-z0-9]+$/);
      expect(resultData.type).toBe('episodic');

      // 데이터베이스에서 확인
      const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
      expect(record).toBeDefined();
      expect(record.content).toBe('I learned about React hooks today');
      expect(record.type).toBe('episodic');
      expect(record.importance).toBe(0.7);
      expect(record.origin_source).toBeDefined();
    });

    it('should fail when content is missing for episodic memory', async () => {
      const params = {
        type: 'episodic',
        importance: 0.5
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });

  describe('Semantic Memory 저장', () => {
    it('should create semantic memory with content', async () => {
      const params = {
        type: 'semantic',
        content: 'React is a JavaScript library for building user interfaces',
        importance: 0.9,
        source: 'documentation'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.memory_id).toMatch(/^mem_\d+_[a-z0-9]+$/);
      expect(resultData.type).toBe('semantic');

      const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
      expect(record.content).toBe('React is a JavaScript library for building user interfaces');
      expect(record.type).toBe('semantic');
      expect(record.source).toBe('agent:documentation');
      expect(record.origin_source).toBeDefined();
    });

    it('bare workflow source를 agent:로 정규화해 저장한다 (#696)', async () => {
      const params = {
        type: 'episodic',
        content: 'CEO heartbeat completed',
        source: 'paperclip-ceo-heartbeat',
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const record = DatabaseUtils.get(db, 'SELECT source FROM memory_item WHERE id = ?', [
        resultData.memory_id,
      ]) as { source: string };

      expect(record.source).toBe('agent:paperclip-ceo-heartbeat');
    });

    it('Given: semantic remember 호출 시, When: Fact 메타 미지정, Then: num_times=1·last_mentioned_at·source_session_id·confidence 기본 저장 (Issue #88)', async () => {
      const params = {
        type: 'semantic',
        content: 'Fact metadata test content',
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const row = DatabaseUtils.get(db, 'SELECT num_times, last_mentioned_at, source_session_id, confidence FROM memory_item WHERE id = ?', [
        resultData.memory_id,
      ]) as { num_times: number; last_mentioned_at: string | null; source_session_id: string | null; confidence: number | null };
      expect(row.num_times).toBe(1);
      expect(row.last_mentioned_at).toBeDefined();
      expect(row.source_session_id).toBeNull();
      expect(row.confidence).toBeNull();
    });

    it('Given: importance·privacy_scope 미제공, When: remember 호출 시, Then: DB에 Zod default(importance=0.5, privacy_scope=private) 저장 (regression #582)', async () => {
      const result = await tool.handle({ type: 'semantic', content: 'default fields regression test' }, context);
      const resultData = JSON.parse(result.content[0].text);
      const row = DatabaseUtils.get(db, 'SELECT importance, privacy_scope FROM memory_item WHERE id = ?', [resultData.memory_id]) as { importance: number; privacy_scope: string };
      expect(row.importance).toBe(0.5);
      expect(row.privacy_scope).toBe('private');
    });

    it('Given: semantic remember에 Fact 메타 지정, When: remember 호출 시, Then: num_times·last_mentioned_at·source_session_id·confidence 저장됨 (Issue #88)', async () => {
      const params = {
        type: 'semantic',
        content: 'Fact meta explicit test',
        num_times: 3,
        last_mentioned_at: '2026-02-08T00:00:00.000Z',
        source_session_id: 'sess-88',
        confidence: 0.85,
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const row = DatabaseUtils.get(db, 'SELECT num_times, last_mentioned_at, source_session_id, confidence FROM memory_item WHERE id = ?', [
        resultData.memory_id,
      ]) as { num_times: number; last_mentioned_at: string | null; source_session_id: string | null; confidence: number | null };
      expect(row.num_times).toBe(3);
      expect(row.last_mentioned_at).toBe('2026-02-08T00:00:00.000Z');
      expect(row.source_session_id).toBe('sess-88');
      expect(row.confidence).toBe(0.85);
    });
  });

  describe('owner_id (multi-agent, Issue #57 Phase 2 D)', () => {
    it('Given: owner_id 파라미터 제공, When: remember 호출 시, Then: memory_item에 owner_id 저장됨', async () => {
      const params = {
        type: 'episodic',
        content: 'Owner test content',
        owner_id: 'agent-alpha',
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const row = DatabaseUtils.get(db, 'SELECT owner_id FROM memory_item WHERE id = ?', [
        resultData.memory_id,
      ]) as { owner_id: string | null };
      expect(row.owner_id).toBe('agent-alpha');
    });

    it('Given: context.agentId만 제공, When: remember 호출 시, Then: memory_item에 owner_id가 agentId로 저장됨', async () => {
      const ctxWithAgent: ToolContext = { ...context, agentId: 'agent-beta' };
      const params = { type: 'episodic', content: 'Context agent test' };
      const result = await tool.handle(params, ctxWithAgent);
      const resultData = JSON.parse(result.content[0].text);
      const row = DatabaseUtils.get(db, 'SELECT owner_id FROM memory_item WHERE id = ?', [
        resultData.memory_id,
      ]) as { owner_id: string | null };
      expect(row.owner_id).toBe('agent-beta');
    });
  });

  describe('process_id, session_id (Memori Attribution, Issue #87)', () => {
    it('Given: process_id·session_id 파라미터 제공, When: remember 호출 시, Then: memory_item에 process_id·session_id 저장됨', async () => {
      const params = {
        type: 'episodic',
        content: 'Attribution test content',
        process_id: 'process-deploy',
        session_id: 'session-abc-123',
      };
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);
      const row = DatabaseUtils.get(db, 'SELECT process_id, session_id FROM memory_item WHERE id = ?', [
        resultData.memory_id,
      ]) as { process_id: string | null; session_id: string | null };
      expect(row.process_id).toBe('process-deploy');
      expect(row.session_id).toBe('session-abc-123');
    });

    it('Given: context.processId·context.sessionId만 제공, When: remember 호출 시, Then: memory_item에 context 값 저장됨', async () => {
      const ctxAttribution: ToolContext = {
        ...context,
        processId: 'process-code-review',
        sessionId: 'session-xyz-456',
      };
      const params = { type: 'episodic', content: 'Context attribution test' };
      const result = await tool.handle(params, ctxAttribution);
      const resultData = JSON.parse(result.content[0].text);
      const row = DatabaseUtils.get(db, 'SELECT process_id, session_id FROM memory_item WHERE id = ?', [
        resultData.memory_id,
      ]) as { process_id: string | null; session_id: string | null };
      expect(row.process_id).toBe('process-code-review');
      expect(row.session_id).toBe('session-xyz-456');
    });
  });

  describe('Procedural Memory 저장', () => {
    it('should create procedural memory with task_goal, steps, and reflection_notes', async () => {
      const params = {
        type: 'procedural',
        content: 'How to deploy a React app',
        task_goal: 'Deploy React application to production',
        steps: JSON.stringify(['build', 'test', 'deploy']),
        reflection_notes: JSON.stringify({
          failure_type: 'tool_error',
          failure_description: 'Deployment failed due to missing environment variables',
          timestamp: new Date().toISOString(),
          lessons_learned: 'Always check environment variables'
        }),
        importance: 0.8
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.memory_id).toMatch(/^mem_\d+_[a-z0-9]+$/);
      expect(resultData.type).toBe('procedural');

      const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
      expect(record.task_goal).toBe('Deploy React application to production');
      expect(record.steps).toBe(JSON.stringify(['build', 'test', 'deploy']));
      expect(record.reflection_notes).toBeDefined();
      expect(record.origin_source).toBeDefined();
    });

    it('should create procedural memory without optional fields', async () => {
      const params = {
        type: 'procedural',
        content: 'Simple procedure',
        importance: 0.5
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
      expect(record.task_goal).toBeNull();
      expect(record.steps).toBeNull();
      expect(record.reflection_notes).toBeNull();
    });
  });

  describe('Working Memory 저장', () => {
    it('should create working memory with content', async () => {
      const params = {
        type: 'working',
        content: 'Current task: Fix bug in login flow',
        importance: 0.6
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.memory_id).toMatch(/^mem_\d+_[a-z0-9]+$/);
      expect(resultData.type).toBe('working');

      const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
      expect(record.content).toBe('Current task: Fix bug in login flow');
      expect(record.type).toBe('working');
    });
  });

  describe('origin_source 자동 생성', () => {
    it('should generate origin_source for all memory types', async () => {
      const testCases = [
        { type: 'core', key: 'test_key', value: 'test_value' },
        { type: 'vault', key: 'test_key2', value: 'test_value2' },
        { type: 'episodic', content: 'test content' },
        { type: 'semantic', content: 'test content' },
        { type: 'procedural', content: 'test content' },
        { type: 'working', content: 'test content' }
      ];

      for (const testCase of testCases) {
        const result = await tool.handle(testCase, context);
        const resultData = JSON.parse(result.content[0].text);
        
        let record;
        if (testCase.type === 'core') {
          record = DatabaseUtils.get(db, 'SELECT * FROM core_memory WHERE key = ?', [testCase.key]);
        } else if (testCase.type === 'vault') {
          record = DatabaseUtils.get(db, 'SELECT * FROM knowledge_vault WHERE key = ?', [testCase.key]);
        } else {
          record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
        }

        expect(record.origin_source).toBeDefined();
        const originSource = JSON.parse(record.origin_source);
        expect(originSource.tool).toBe('remember');
        expect(originSource.caller).toBe('user');
        expect(originSource.context.type).toBe(testCase.type);
      }
    });
  });

  describe('조건부 필수 검증', () => {
    it('should reject core memory without key', async () => {
      const params = {
        type: 'core',
        value: 'some value'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should reject core memory without value', async () => {
      const params = {
        type: 'core',
        key: 'some_key'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should reject vault without key', async () => {
      const params = {
        type: 'vault',
        value: 'some value'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should reject vault without value', async () => {
      const params = {
        type: 'vault',
        key: 'some_key'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should reject memory_item types without content', async () => {
      const types = ['episodic', 'semantic', 'procedural', 'working'];
      
      for (const type of types) {
        const params = { type };
        await expect(tool.handle(params, context)).rejects.toThrow();
      }
    });
  });

  describe('에러 처리', () => {
    it('should handle database errors gracefully', async () => {
      const params = {
        type: 'core',
        key: 'test',
        value: 'test'
      };

      // 데이터베이스 닫기
      db.close();

      await expect(tool.handle(params, context)).rejects.toThrow();
    });

    it('should handle invalid type gracefully', async () => {
      const params = {
        type: 'invalid_type',
        content: 'test'
      };

      await expect(tool.handle(params, context)).rejects.toThrow();
    });
  });

  describe('type 파라미터 롤아웃', () => {
    describe('warn 모드', () => {
      beforeEach(() => {
        vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
          ...configModule.mementoConfig,
          typeParamMode: 'warn'
        } as any);
      });

      it('should use default type and log warning when type is missing', async () => {
        const params = {
          content: 'Test content'
        };

        const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.memory_id).toBeDefined();
        expect(logWarningSpy).toHaveBeenCalledWith(
          expect.stringContaining('type')
        );
        expect(logWarningSpy).toHaveBeenCalledWith(
          expect.stringContaining('episodic')
        );

        // 데이터베이스에서 확인 (기본값 episodic로 저장되었는지)
        const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
        expect(record.type).toBe('episodic');
      });

      it('should not log warning when type is provided', async () => {
        const params = {
          type: 'semantic',
          content: 'Test content'
        };

        const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

        await tool.handle(params, context);

        // type이 제공된 경우 경고가 출력되지 않아야 함
        const warningCalls = logWarningSpy.mock.calls.filter(call => 
          call[0]?.includes('type') && call[0]?.includes('파라미터')
        );
        expect(warningCalls.length).toBe(0);
      });
    });

    describe('deprecate 모드', () => {
      beforeEach(() => {
        vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
          ...configModule.mementoConfig,
          typeParamMode: 'deprecate'
        } as any);
      });

      it('should use default type and log deprecation warning when type is missing', async () => {
        const params = {
          content: 'Test content'
        };

        const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.memory_id).toBeDefined();
        expect(logWarningSpy).toHaveBeenCalledWith(
          expect.stringContaining('마이그레이션')
        );
      });
    });

    describe('error 모드', () => {
      beforeEach(() => {
        vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
          ...configModule.mementoConfig,
          typeParamMode: 'error'
        } as any);
      });

      it('should throw error when type is missing', async () => {
        const params = {
          content: 'Test content'
        };

        await expect(tool.handle(params, context)).rejects.toThrow(ToolInputValidationError);
        try {
          await tool.handle(params, context);
          expect.fail('Should have thrown an error');
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(ToolInputValidationError);
          expect((error as Error).name).toBe('ToolInputValidationError');
          expect((error as Error).message).toMatch(/type|파라미터|필수/i);
        }
      });

      it('should work normally when type is provided', async () => {
        const params = {
          type: 'episodic',
          content: 'Test content'
        };

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.memory_id).toBeDefined();
        expect(resultData.type).toBe('episodic');
      });

      // #811 FR-007 / T011: backtick·regex-like content hypothesized to cause -32603
      it('accepts content with backticks and regex-like chars (backtick hypothesis smoke)', async () => {
        const params = {
          type: 'episodic',
          content: 'Use `mapToolExecutionErrorToJsonRpc` with /pattern.*/ and `${template}`'
        };

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);
        expect(resultData.memory_id).toBeDefined();
      });
    });

    describe('origin_source에 롤아웃 정보 포함', () => {
      beforeEach(() => {
        vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
          ...configModule.mementoConfig,
          typeParamMode: 'warn'
        } as any);
      });

      it('should include type_param_mode and type_was_defaulted in origin_source', async () => {
        const params = {
          content: 'Test content'
        };

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
        const originSource = JSON.parse(record.origin_source);

        expect(originSource.context.type_param_mode).toBe('warn');
        expect(originSource.context.type_was_defaulted).toBe(true);
      });

      it('should set type_was_defaulted to false when type is provided', async () => {
        const params = {
          type: 'semantic',
          content: 'Test content'
        };

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
        const originSource = JSON.parse(record.origin_source);

        expect(originSource.context.type_param_mode).toBe('warn');
        expect(originSource.context.type_was_defaulted).toBe(false);
      });
    });
  });

  describe('reflection_notes 처리', () => {
    const createValidReflectionNote = (overrides: Partial<any> = {}) => ({
      failure_type: 'tool_error',
      failure_description: 'Test error',
      timestamp: new Date().toISOString(),
      ...overrides
    });

    describe('JSON 검증', () => {
      it('should validate reflection_notes JSON format', async () => {
        const params = {
          type: 'procedural',
          content: 'Test procedure',
          task_goal: 'Test task',
          reflection_notes: JSON.stringify(createValidReflectionNote())
        };

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.memory_id).toBeDefined();
        const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
        expect(record.reflection_notes).toBeDefined();
      });

      it('should reject invalid JSON format', async () => {
        const params = {
          type: 'procedural',
          content: 'Test procedure',
          task_goal: 'Test task',
          reflection_notes: '{ invalid json }'
        };

        await expect(tool.handle(params, context)).rejects.toThrow(/JSON 파싱 실패/);
      });

      it('should accept array format', async () => {
        const params = {
          type: 'procedural',
          content: 'Test procedure',
          task_goal: 'Test task',
          reflection_notes: JSON.stringify([
            createValidReflectionNote({ timestamp: '2025-01-01T00:00:00Z' }),
            createValidReflectionNote({ timestamp: '2025-01-02T00:00:00Z' })
          ])
        };

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.memory_id).toBeDefined();
        const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
        const parsed = JSON.parse(record.reflection_notes);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(2);
      });
    });

    describe('스키마 검증', () => {
      it('should reject reflection_notes with missing required fields', async () => {
        const params = {
          type: 'procedural',
          content: 'Test procedure',
          task_goal: 'Test task',
          reflection_notes: JSON.stringify({
            failure_description: 'Missing failure_type'
            // failure_type과 timestamp 누락
          })
        };

        await expect(tool.handle(params, context)).rejects.toThrow(/스키마 검증 실패/);
      });

      it('should reject reflection_notes with invalid failure_type', async () => {
        const params = {
          type: 'procedural',
          content: 'Test procedure',
          task_goal: 'Test task',
          reflection_notes: JSON.stringify({
            failure_type: 'invalid_type',
            failure_description: 'Test',
            timestamp: new Date().toISOString()
          })
        };

        await expect(tool.handle(params, context)).rejects.toThrow(/스키마 검증 실패/);
      });

      it('should reject reflection_notes with invalid timestamp format', async () => {
        const params = {
          type: 'procedural',
          content: 'Test procedure',
          task_goal: 'Test task',
          reflection_notes: JSON.stringify({
            failure_type: 'tool_error',
            failure_description: 'Test',
            timestamp: 'invalid-date'
          })
        };

        await expect(tool.handle(params, context)).rejects.toThrow(/스키마 검증 실패/);
      });

      it('should accept valid reflection_notes with all fields', async () => {
        const params = {
          type: 'procedural',
          content: 'Test procedure',
          task_goal: 'Test task',
          reflection_notes: JSON.stringify({
            failure_type: 'user_feedback',
            failure_description: 'User reported issue',
            timestamp: new Date().toISOString(),
            original_task: 'Complete task X',
            lessons_learned: 'Need better error handling',
            suggested_improvements: 'Add retry logic',
            phase: 'manual'
          })
        };

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.memory_id).toBeDefined();
        const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
        const parsed = JSON.parse(record.reflection_notes);
        expect(parsed.failure_type).toBe('user_feedback');
        expect(parsed.original_task).toBe('Complete task X');
      });
    });

    describe('병합 로직', () => {
      it('should merge reflection_notes when existing record has same task_goal', async () => {
        // 첫 번째 기록 저장
        const firstParams = {
          type: 'procedural',
          content: 'First procedure',
          task_goal: 'Same task',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-01-01T00:00:00Z',
            failure_description: 'First error'
          }))
        };

        const firstResult = await tool.handle(firstParams, context);
        const firstData = JSON.parse(firstResult.content[0].text);

        // 두 번째 기록 저장 (같은 task_goal)
        const secondParams = {
          type: 'procedural',
          content: 'Second procedure',
          task_goal: 'Same task',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-01-02T00:00:00Z',
            failure_description: 'Second error'
          }))
        };

        const secondResult = await tool.handle(secondParams, context);
        const secondData = JSON.parse(secondResult.content[0].text);

        // 두 번째 기록의 reflection_notes가 병합되었는지 확인
        const secondRecord = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [secondData.memory_id]);
        const parsed = JSON.parse(secondRecord.reflection_notes);
        
        // 배열로 병합되었는지 확인
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].failure_description).toBe('First error');
        expect(parsed[1].failure_description).toBe('Second error');
      });

      it('should not merge when task_goal is different', async () => {
        // 첫 번째 기록 저장
        const firstParams = {
          type: 'procedural',
          content: 'First procedure',
          task_goal: 'Task A',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-01-01T00:00:00Z'
          }))
        };

        await tool.handle(firstParams, context);

        // 두 번째 기록 저장 (다른 task_goal)
        const secondParams = {
          type: 'procedural',
          content: 'Second procedure',
          task_goal: 'Task B',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-01-02T00:00:00Z'
          }))
        };

        const secondResult = await tool.handle(secondParams, context);
        const secondData = JSON.parse(secondResult.content[0].text);

        // 두 번째 기록의 reflection_notes가 병합되지 않았는지 확인
        const secondRecord = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [secondData.memory_id]);
        const parsed = JSON.parse(secondRecord.reflection_notes);
        
        // 단일 객체로 저장되었는지 확인 (병합되지 않음)
        expect(Array.isArray(parsed)).toBe(false);
        expect(parsed.failure_description).toBe('Test error');
      });

      it('should merge single object with existing array', async () => {
        // 첫 번째 기록 저장 (배열 형식)
        const firstParams = {
          type: 'procedural',
          content: 'First procedure',
          task_goal: 'Same task',
          reflection_notes: JSON.stringify([
            createValidReflectionNote({ timestamp: '2025-01-01T00:00:00Z' }),
            createValidReflectionNote({ timestamp: '2025-01-02T00:00:00Z' })
          ])
        };

        await tool.handle(firstParams, context);

        // 두 번째 기록 저장 (단일 객체)
        const secondParams = {
          type: 'procedural',
          content: 'Second procedure',
          task_goal: 'Same task',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-01-03T00:00:00Z'
          }))
        };

        const secondResult = await tool.handle(secondParams, context);
        const secondData = JSON.parse(secondResult.content[0].text);

        // 병합 결과 확인
        const secondRecord = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [secondData.memory_id]);
        const parsed = JSON.parse(secondRecord.reflection_notes);
        
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(3);
      });
    });

    describe('배열 크기 제한', () => {
      it('should limit array size to 100 items (FIFO)', async () => {
        // 100개의 reflection_notes가 있는 기존 기록 생성
        // 유효한 날짜 범위 내에서 생성 (1월은 31일까지만)
        const existingNotes = Array.from({ length: 100 }, (_, i) => {
          const day = (i % 31) + 1; // 1-31 사이의 날짜
          const month = Math.floor(i / 31) + 1; // 월 증가
          return createValidReflectionNote({ 
            timestamp: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`,
            failure_description: `Error ${i}`
          });
        });

        const firstParams = {
          type: 'procedural',
          content: 'First procedure',
          task_goal: 'Same task',
          reflection_notes: JSON.stringify(existingNotes)
        };

        await tool.handle(firstParams, context);

        // 새로운 reflection_notes 추가
        const secondParams = {
          type: 'procedural',
          content: 'Second procedure',
          task_goal: 'Same task',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-02-01T00:00:00Z',
            failure_description: 'New error'
          }))
        };

        const secondResult = await tool.handle(secondParams, context);
        const secondData = JSON.parse(secondResult.content[0].text);

        // 배열 크기가 100개로 제한되었는지 확인
        const secondRecord = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [secondData.memory_id]);
        const parsed = JSON.parse(secondRecord.reflection_notes);
        
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeLessThanOrEqual(100);
        // 새로운 항목이 포함되어야 함
        expect(parsed.some((n: any) => n.failure_description === 'New error')).toBe(true);
      });
    });

    describe('type이 procedural이 아닌 경우', () => {
      it('should not validate reflection_notes for non-procedural types', async () => {
        // 잘못된 reflection_notes를 제공하지만, episodic 타입이므로 검증하지 않음
        const params = {
          type: 'episodic',
          content: 'Test content',
          reflection_notes: '{ invalid json }'
        };

        // 에러가 발생하지 않아야 함 (검증하지 않으므로)
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.memory_id).toBeDefined();
      });

      it('should ignore reflection_notes for non-procedural types', async () => {
        // 첫 번째 기록 저장 (procedural)
        const firstParams = {
          type: 'procedural',
          content: 'First procedure',
          task_goal: 'Same task',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-01-01T00:00:00Z'
          }))
        };

        await tool.handle(firstParams, context);

        // 두 번째 기록 저장 (episodic, procedural이 아니므로 reflection_notes 무시)
        const secondParams = {
          type: 'episodic',
          content: 'Second content',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-01-02T00:00:00Z'
          }))
        };

        const secondResult = await tool.handle(secondParams, context);
        const secondData = JSON.parse(secondResult.content[0].text);

        // episodic 타입이므로 reflection_notes가 무시되어야 함 (null)
        const secondRecord = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [secondData.memory_id]);
        
        // reflection_notes가 null이어야 함 (non-procedural 타입에서는 무시)
        expect(secondRecord.reflection_notes).toBeNull();
      });
    });

    describe('공통 유틸리티 함수 사용', () => {
      it('should use mergeReflectionNotes utility for merging', async () => {
        // 첫 번째 기록 저장
        const firstParams = {
          type: 'procedural',
          content: 'First procedure',
          task_goal: 'Same task',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-01-01T00:00:00Z'
          }))
        };

        await tool.handle(firstParams, context);

        // 두 번째 기록 저장
        const secondParams = {
          type: 'procedural',
          content: 'Second procedure',
          task_goal: 'Same task',
          reflection_notes: JSON.stringify(createValidReflectionNote({ 
            timestamp: '2025-01-02T00:00:00Z'
          }))
        };

        const secondResult = await tool.handle(secondParams, context);
        const secondData = JSON.parse(secondResult.content[0].text);

        // 병합이 올바르게 수행되었는지 확인 (공통 유틸리티 함수 사용)
        const secondRecord = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [secondData.memory_id]);
        const parsed = JSON.parse(secondRecord.reflection_notes);
        
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(2);
      });
    });

    describe('Procedural Memory Enhancement (v7.0)', () => {
      beforeEach(() => {
        // Consolidation Score System 활성화 (g_value, recall_count 테스트를 위해 필요)
        vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
          ...configModule.mementoConfig,
          consolidationScoreEnabled: true
        } as any);
      });

      describe('새 필드 저장', () => {
        it('should save workflow_name, skill_name, and trigger_conditions', async () => {
          // Given: workflow_name, skill_name, trigger_conditions가 포함된 파라미터
          const params = {
            type: 'procedural',
            content: 'Test procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            trigger_conditions: JSON.stringify({ event: 'migration_start', condition: 'backup_required' })
          };

          // When: remember Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: 새 필드가 저장되어야 함
          const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [resultData.memory_id]);
          expect(record.workflow_name).toBe('데이터 마이그레이션');
          expect(record.skill_name).toBe('스키마 백업');
          expect(record.trigger_conditions).toBe(JSON.stringify({ event: 'migration_start', condition: 'backup_required' }));
        });

        it('should validate trigger_conditions as JSON object', async () => {
          // Given: 유효하지 않은 trigger_conditions (배열)
          const params = {
            type: 'procedural',
            content: 'Test procedure',
            trigger_conditions: JSON.stringify([1, 2, 3]) // 배열은 허용되지 않음
          };

          // When/Then: 에러가 발생해야 함
          await expect(tool.handle(params, context)).rejects.toThrow('trigger_conditions must be a valid JSON object');
        });

        it('should reject empty workflow_name', async () => {
          // Given: 빈 문자열 workflow_name
          const params = {
            type: 'procedural',
            content: 'Test procedure',
            workflow_name: '   ' // 빈 문자열
          };

          // When/Then: 에러가 발생해야 함
          await expect(tool.handle(params, context)).rejects.toThrow('workflow_name cannot be an empty string');
        });

        it('should reject empty skill_name', async () => {
          // Given: 빈 문자열 skill_name
          const params = {
            type: 'procedural',
            content: 'Test procedure',
            skill_name: '' // 빈 문자열
          };

          // When/Then: 에러가 발생해야 함
          await expect(tool.handle(params, context)).rejects.toThrow('skill_name cannot be an empty string');
        });
      });

      describe('업데이트 모드: replace', () => {
        it('should replace existing procedural memory when update_mode is replace', async () => {
          // Given: 기존 procedural memory 생성
          const firstParams = {
            type: 'procedural',
            content: 'Original procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step1', 'step2'])
          };

          const firstResult = await tool.handle(firstParams, context);
          const firstData = JSON.parse(firstResult.content[0].text);
          const originalId = firstData.memory_id;

          // When: replace 모드로 업데이트
          const secondParams = {
            type: 'procedural',
            content: 'Updated procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step3', 'step4']),
            update_mode: 'replace'
          };

          const secondResult = await tool.handle(secondParams, context);
          const secondData = JSON.parse(secondResult.content[0].text);

          // Then: 같은 ID로 업데이트되어야 함
          expect(secondData.memory_id).toBe(originalId);
          const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [originalId]);
          expect(record.content).toBe('Updated procedure');
          expect(record.steps).toBe(JSON.stringify(['step3', 'step4']));
        });

        it('should preserve recall_count and g_value when update_mode is replace', async () => {
          // Given: 기존 procedural memory 생성 및 recall_count/g_value 설정
          const firstParams = {
            type: 'procedural',
            content: 'Original procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step1', 'step2'])
          };

          const firstResult = await tool.handle(firstParams, context);
          const firstData = JSON.parse(firstResult.content[0].text);
          const originalId = firstData.memory_id;

          // 기존 recall_count와 g_value 설정
          DatabaseUtils.run(db, `
            UPDATE memory_item 
            SET recall_count = 5, g_value = 0.8, last_accessed_at = ?
            WHERE id = ?
          `, [new Date().toISOString(), originalId]);

          const originalRecord = DatabaseUtils.get(db, 'SELECT recall_count, g_value, last_accessed_at FROM memory_item WHERE id = ?', [originalId]);
          expect(originalRecord.recall_count).toBe(5);
          expect(originalRecord.g_value).toBe(0.8);

          // When: replace 모드로 업데이트
          const secondParams = {
            type: 'procedural',
            content: 'Updated procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step3', 'step4']),
            update_mode: 'replace'
          };

          await tool.handle(secondParams, context);

          // Then: recall_count는 1 증가하고, g_value는 보존되어야 함
          const updatedRecord = DatabaseUtils.get(db, 'SELECT recall_count, g_value, last_accessed_at FROM memory_item WHERE id = ?', [originalId]);
          expect(updatedRecord.recall_count).toBe(6); // 5 + 1
          expect(updatedRecord.g_value).toBe(0.8); // 보존됨
          expect(updatedRecord.last_accessed_at).toBeDefined(); // 업데이트됨
        });
      });

      describe('업데이트 모드: incremental', () => {
        it('should merge steps when update_mode is incremental', async () => {
          // Given: 기존 procedural memory 생성
          const firstParams = {
            type: 'procedural',
            content: 'Original procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step1', 'step2'])
          };

          const firstResult = await tool.handle(firstParams, context);
          const firstData = JSON.parse(firstResult.content[0].text);
          const originalId = firstData.memory_id;

          // When: incremental 모드로 업데이트
          const secondParams = {
            type: 'procedural',
            content: 'Updated procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step3', 'step4']),
            update_mode: 'incremental'
          };

          const secondResult = await tool.handle(secondParams, context);
          const secondData = JSON.parse(secondResult.content[0].text);

          // Then: 같은 ID로 업데이트되고 steps가 병합되어야 함
          expect(secondData.memory_id).toBe(originalId);
          const record = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [originalId]);
          const mergedSteps = JSON.parse(record.steps);
          expect(mergedSteps).toEqual(['step1', 'step2', 'step3', 'step4']);
        });

        it('should preserve recall_count and g_value when update_mode is incremental', async () => {
          // Given: 기존 procedural memory 생성 및 recall_count/g_value 설정
          const firstParams = {
            type: 'procedural',
            content: 'Original procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step1', 'step2'])
          };

          const firstResult = await tool.handle(firstParams, context);
          const firstData = JSON.parse(firstResult.content[0].text);
          const originalId = firstData.memory_id;

          // 기존 recall_count와 g_value 설정
          DatabaseUtils.run(db, `
            UPDATE memory_item 
            SET recall_count = 3, g_value = 0.6, last_accessed_at = ?
            WHERE id = ?
          `, [new Date().toISOString(), originalId]);

          const originalRecord = DatabaseUtils.get(db, 'SELECT recall_count, g_value, last_accessed_at FROM memory_item WHERE id = ?', [originalId]);
          expect(originalRecord.recall_count).toBe(3);
          expect(originalRecord.g_value).toBe(0.6);

          // When: incremental 모드로 업데이트
          const secondParams = {
            type: 'procedural',
            content: 'Updated procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step3', 'step4']),
            update_mode: 'incremental'
          };

          await tool.handle(secondParams, context);

          // Then: recall_count는 1 증가하고, g_value는 보존되어야 함
          const updatedRecord = DatabaseUtils.get(db, 'SELECT recall_count, g_value, last_accessed_at FROM memory_item WHERE id = ?', [originalId]);
          expect(updatedRecord.recall_count).toBe(4); // 3 + 1
          expect(updatedRecord.g_value).toBe(0.6); // 보존됨
          expect(updatedRecord.last_accessed_at).toBeDefined(); // 업데이트됨
        });

        it('should accumulate recall_count correctly on multiple incremental updates', async () => {
          // Given: 기존 procedural memory 생성
          const firstParams = {
            type: 'procedural',
            content: 'Original procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step1'])
          };

          const firstResult = await tool.handle(firstParams, context);
          const firstData = JSON.parse(firstResult.content[0].text);
          const originalId = firstData.memory_id;

          // 초기 recall_count 확인
          let record = DatabaseUtils.get(db, 'SELECT recall_count, g_value FROM memory_item WHERE id = ?', [originalId]);
          expect(record.recall_count).toBe(1); // 첫 저장 시 1

          // When: 첫 번째 incremental 업데이트
          await tool.handle({
            type: 'procedural',
            content: 'Updated procedure 1',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step2']),
            update_mode: 'incremental'
          }, context);

          // Then: recall_count가 2가 되어야 함
          record = DatabaseUtils.get(db, 'SELECT recall_count, g_value FROM memory_item WHERE id = ?', [originalId]);
          expect(record.recall_count).toBe(2); // 1 + 1

          // When: 두 번째 incremental 업데이트
          await tool.handle({
            type: 'procedural',
            content: 'Updated procedure 2',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step3']),
            update_mode: 'incremental'
          }, context);

          // Then: recall_count가 3이 되어야 함
          record = DatabaseUtils.get(db, 'SELECT recall_count, g_value FROM memory_item WHERE id = ?', [originalId]);
          expect(record.recall_count).toBe(3); // 2 + 1
          expect(record.g_value).toBeDefined(); // g_value는 보존되어야 함
        });
      });

      describe('업데이트 모드 없음', () => {
        it('should create new memory when update_mode is not specified even if existing memory exists', async () => {
          // Given: 기존 procedural memory 생성
          const firstParams = {
            type: 'procedural',
            content: 'Original procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step1', 'step2'])
          };

          const firstResult = await tool.handle(firstParams, context);
          const firstData = JSON.parse(firstResult.content[0].text);
          const originalId = firstData.memory_id;

          // 기존 recall_count와 g_value 설정
          DatabaseUtils.run(db, `
            UPDATE memory_item 
            SET recall_count = 10, g_value = 0.9, last_accessed_at = ?
            WHERE id = ?
          `, [new Date().toISOString(), originalId]);

          // When: update_mode 없이 동일한 workflow_name과 skill_name으로 저장
          const secondParams = {
            type: 'procedural',
            content: 'New procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step3', 'step4'])
            // update_mode 없음
          };

          const secondResult = await tool.handle(secondParams, context);
          const secondData = JSON.parse(secondResult.content[0].text);
          const newId = secondData.memory_id;

          // Then: 새 메모리가 생성되어야 함 (기존 메모리와 다른 ID)
          expect(newId).not.toBe(originalId);

          // 기존 메모리는 그대로 유지되어야 함
          const originalRecord = DatabaseUtils.get(db, 'SELECT recall_count, g_value FROM memory_item WHERE id = ?', [originalId]);
          expect(originalRecord.recall_count).toBe(10); // 기존 값 유지
          expect(originalRecord.g_value).toBe(0.9); // 기존 값 유지

          // 새 메모리는 기본값을 가져야 함
          const newRecord = DatabaseUtils.get(db, 'SELECT recall_count, g_value FROM memory_item WHERE id = ?', [newId]);
          expect(newRecord.recall_count).toBe(1); // 새 메모리는 1
          expect(newRecord.g_value).toBe(1.0); // 새 메모리는 1.0
        });

        it('should preserve existing memory when update_mode is not specified (policy: no overwrite without explicit mode)', async () => {
          // Given: 기존 procedural memory 생성 및 여러 번 접근
          const firstParams = {
            type: 'procedural',
            content: 'Original procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step1', 'step2'])
          };

          const firstResult = await tool.handle(firstParams, context);
          const firstData = JSON.parse(firstResult.content[0].text);
          const originalId = firstData.memory_id;

          // 기존 메모리에 여러 번 접근하여 recall_count 증가
          DatabaseUtils.run(db, `
            UPDATE memory_item 
            SET recall_count = 5, g_value = 0.7, last_accessed_at = ?
            WHERE id = ?
          `, [new Date().toISOString(), originalId]);

          // When: update_mode 없이 동일한 workflow_name/skill_name으로 저장
          // (의도: 명시적으로 update_mode를 지정하지 않으면 덮어쓰지 않음)
          const secondParams = {
            type: 'procedural',
            content: 'Different procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step5', 'step6'])
            // update_mode 없음 - 명시적으로 지정하지 않으면 새로 저장
          };

          const secondResult = await tool.handle(secondParams, context);
          const secondData = JSON.parse(secondResult.content[0].text);
          const newId = secondData.memory_id;

          // Then: 기존 메모리는 변경되지 않아야 함 (덮어쓰기 방지)
          const originalRecord = DatabaseUtils.get(db, `
            SELECT id, content, recall_count, g_value, workflow_name, skill_name 
            FROM memory_item 
            WHERE id = ?
          `, [originalId]);
          
          expect(originalRecord.id).toBe(originalId);
          expect(originalRecord.content).toBe('Original procedure'); // 기존 내용 유지
          expect(originalRecord.recall_count).toBe(5); // 기존 recall_count 유지
          expect(originalRecord.g_value).toBe(0.7); // 기존 g_value 유지
          expect(originalRecord.workflow_name).toBe('데이터 마이그레이션');
          expect(originalRecord.skill_name).toBe('스키마 백업');

          // 새 메모리는 별도로 생성되어야 함
          const newRecord = DatabaseUtils.get(db, `
            SELECT id, content, recall_count, g_value 
            FROM memory_item 
            WHERE id = ?
          `, [newId]);
          
          expect(newRecord.id).toBe(newId);
          expect(newRecord.content).toBe('Different procedure'); // 새 내용
          expect(newRecord.recall_count).toBe(1); // 새 메모리는 기본값
          expect(newRecord.g_value).toBe(1.0); // 새 메모리는 기본값

          // 두 메모리가 모두 존재해야 함
          const allMemories = DatabaseUtils.all(db, `
            SELECT id, content, workflow_name, skill_name 
            FROM memory_item 
            WHERE workflow_name = ? AND skill_name = ?
            ORDER BY created_at
          `, ['데이터 마이그레이션', '스키마 백업']);
          
          expect(allMemories.length).toBe(2); // 기존 메모리 + 새 메모리
        });

        it('should require explicit update_mode to overwrite existing procedural memory', async () => {
          // Given: 기존 procedural memory 생성
          const firstParams = {
            type: 'procedural',
            content: 'Original procedure',
            workflow_name: 'API 배포',
            skill_name: '배포 스크립트',
            steps: JSON.stringify(['deploy1', 'deploy2'])
          };

          await tool.handle(firstParams, context);

          // When: update_mode 없이 동일한 workflow_name/skill_name으로 저장 시도
          const secondParams = {
            type: 'procedural',
            content: 'Updated procedure',
            workflow_name: 'API 배포',
            skill_name: '배포 스크립트',
            steps: JSON.stringify(['deploy3', 'deploy4'])
            // update_mode 없음
          };

          const secondResult = await tool.handle(secondParams, context);
          const secondData = JSON.parse(secondResult.content[0].text);

          // Then: 새 메모리가 생성되어야 함 (덮어쓰지 않음)
          // 기존 메모리를 찾아서 확인
          const existingMemories = DatabaseUtils.all(db, `
            SELECT id, content, workflow_name, skill_name 
            FROM memory_item 
            WHERE workflow_name = ? AND skill_name = ?
            ORDER BY created_at
          `, ['API 배포', '배포 스크립트']);

          expect(existingMemories.length).toBe(2); // 기존 + 새 메모리
          expect(existingMemories[0].content).toBe('Original procedure'); // 첫 번째는 기존
          expect(existingMemories[1].content).toBe('Updated procedure'); // 두 번째는 새 메모리
          expect(existingMemories[1].id).toBe(secondData.memory_id);
        });
      });

      describe('업데이트 모드: versioned', () => {
        it('should create new version and link with version_of relation', async () => {
          // Given: memory_link 테이블 생성
          db.exec(`
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
          `);

          // Given: 기존 procedural memory 생성
          const firstParams = {
            type: 'procedural',
            content: 'Original procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step1', 'step2'])
          };

          const firstResult = await tool.handle(firstParams, context);
          const firstData = JSON.parse(firstResult.content[0].text);
          const originalId = firstData.memory_id;

          // When: versioned 모드로 새 버전 생성
          const secondParams = {
            type: 'procedural',
            content: 'New version procedure',
            workflow_name: '데이터 마이그레이션',
            skill_name: '스키마 백업',
            steps: JSON.stringify(['step1', 'step2', 'step3']),
            update_mode: 'versioned'
          };

          const secondResult = await tool.handle(secondParams, context);
          const secondData = JSON.parse(secondResult.content[0].text);
          const newId = secondData.memory_id;

          // Then: 새 레코드가 생성되고 version_of 관계가 추가되어야 함
          expect(newId).not.toBe(originalId);
          const link = DatabaseUtils.get(db, `
            SELECT * FROM memory_link 
            WHERE source_id = ? AND target_id = ? AND relation_type = 'version_of'
          `, [newId, originalId]);
          expect(link).toBeDefined();
        });
      });
    });
  });

  describe('project_id (Project-scoped Memory, Issue #81)', () => {
    it('stores project_id when provided', async () => {
      const result = await tool.handle({
        content: 'PostgreSQL을 사용한다',
        type: 'semantic',
        project_id: 'test-project'
      }, context);

      expect(result.isError).toBeFalsy();
      const row = db.prepare(
        `SELECT project_id FROM memory_item WHERE content = ?`
      ).get('PostgreSQL을 사용한다') as { project_id: string | null } | undefined;
      expect(row?.project_id).toBe('test-project');
    });

    it('stores NULL project_id when not provided', async () => {
      const result = await tool.handle({
        content: '프로젝트 없는 기억',
        type: 'episodic'
      }, context);

      expect(result.isError).toBeFalsy();
      const row = db.prepare(
        `SELECT project_id FROM memory_item WHERE content = ?`
      ).get('프로젝트 없는 기억') as { project_id: string | null } | undefined;
      expect(row?.project_id).toBeNull();
    });
  });

});

