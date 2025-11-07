import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';
import { RememberTool } from './remember-tool.js';
import type { ToolContext } from './types.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import * as configModule from '../config/index.js';

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
      expect(record.origin_source).toBeDefined();
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
          failure_type: 'deployment_error',
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
          expect.stringContaining('DEPRECATED')
        );
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

        await expect(tool.handle(params, context)).rejects.toThrow();
        // 에러 메시지에 "type" 또는 "파라미터"가 포함되어야 함
        try {
          await tool.handle(params, context);
          expect.fail('Should have thrown an error');
        } catch (error: any) {
          expect(error.message).toMatch(/type|파라미터|필수/i);
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
});

