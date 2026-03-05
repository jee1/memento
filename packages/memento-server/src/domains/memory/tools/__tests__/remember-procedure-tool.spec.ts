/**
 * Remember Procedure Tool 테스트 (Issue #57 Phase 2)
 *
 * Given/When/Then 및 jsdoc으로 시나리오 표기.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RememberProcedureTool } from '../remember-procedure-tool.js';
import type { ToolContext } from '../../../../tools/types.js';
import { MemoryEmbeddingService } from '../../services/memory-embedding-service.js';
import { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { getBatchScheduler, resetBatchScheduler } from '../../../../infrastructure/scheduler/batch-scheduler.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';

/** 테스트용 DB 스키마 (RememberTool procedural 경로와 동일) */
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
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      consolidation_score REAL,
      g_value REAL,
      subject TEXT,
      predicate TEXT,
      object TEXT,
      triple_extracted BOOLEAN DEFAULT NULL,
      triple_extracted_status TEXT DEFAULT NULL,
      triple_extraction_metadata TEXT DEFAULT NULL,
      version INTEGER NULL,
      version_series_id TEXT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
      -- Fact metadata (Issue #88, migration 017)
      num_times INTEGER NOT NULL DEFAULT 1,
      last_mentioned_at TIMESTAMP,
      source_session_id TEXT,
      confidence REAL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_desc ON memory_item(consolidation_score DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2;
    CREATE INDEX IF NOT EXISTS idx_memory_item_triple_extracted ON memory_item(triple_extracted);
    CREATE INDEX IF NOT EXISTS idx_memory_item_triple_status ON memory_item(triple_extracted_status);

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

    CREATE TABLE IF NOT EXISTS memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      UNIQUE(source_id, target_id, relation_type)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_relation_source ON memory_relation(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relation_target ON memory_relation(target_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relation_type ON memory_relation(relation_type);

    CREATE TABLE IF NOT EXISTS relation_type_registry (
      type_name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      applicable_types TEXT,
      default_confidence REAL DEFAULT 0.7,
      search_boost REAL DEFAULT 1.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
    VALUES
      ('extracted_from', 'Structural', '추출 관계', '["episodic", "semantic"]', 0.7, 1.1),
      ('supported_by', 'Structural', '근거 관계', '["episodic", "semantic"]', 0.7, 1.1);
  `);
}

describe('RememberProcedureTool', () => {
  let db: Database.Database;
  let tool: RememberProcedureTool;
  let context: ToolContext;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    const embeddingService = new MemoryEmbeddingService();
    const hybridSearchEngine = new HybridSearchEngine();

    resetBatchScheduler();
    const batchScheduler = getBatchScheduler();
    batchScheduler.start(db, null);

    tool = new RememberProcedureTool();
    context = {
      db,
      services: {
        hybridSearchEngine,
        embeddingService,
        relationGraph: createRelationGraph(db),
      },
    };
  });

  afterEach(async () => {
    const batchScheduler = getBatchScheduler();
    if (batchScheduler.getStatus().isRunning) {
      await batchScheduler.stop();
    }
    resetBatchScheduler();
    if (db) db.close();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('초기화', () => {
    it('Given: 툴 인스턴스, When: getDefinition 호출하면, Then: name은 remember_procedure이고 required에 content 포함', () => {
      const def = tool.getDefinition();
      expect(def.name).toBe('remember_procedure');
      expect(def.inputSchema).toHaveProperty('required');
      expect((def.inputSchema as { required?: string[] }).required).toContain('content');
    });
  });

  describe('성공 시나리오', () => {
    /**
     * Given: 유효한 procedural 파라미터와 context(db, services)
     * When: handle 호출
     * Then: 성공 결과에 memory_id, type 'procedural' 반환 및 DB에 행 저장
     */
    it('Given: 유효한 procedural 파라미터와 context, When: handle 호출하면, Then: memory_id와 type procedural 반환', async () => {
      const params = {
        content: 'React 앱 배포 절차',
        task_goal: '프로덕션 배포',
        steps: JSON.stringify(['build', 'test', 'deploy']),
        workflow_name: '프론트 배포',
        skill_name: 'CI 배포',
        importance: 0.8,
      };

      const result = await tool.handle(params, context);
      const data = JSON.parse(result.content[0].text);

      expect(data.memory_id).toMatch(/^mem_\d+_[a-z0-9]+$/);
      expect(data.type).toBe('procedural');

      const row = DatabaseUtils.get(db, 'SELECT * FROM memory_item WHERE id = ?', [data.memory_id]);
      expect(row).toBeDefined();
      expect(row?.content).toBe('React 앱 배포 절차');
      expect(row?.type).toBe('procedural');
      expect(row?.workflow_name).toBe('프론트 배포');
      expect(row?.skill_name).toBe('CI 배포');
    });

    it('Given: owner_id 파라미터 또는 context.agentId, When: handle 호출하면, Then: memory_item에 owner_id 저장됨', async () => {
      const ctxWithAgent: ToolContext = { ...context, agentId: 'agent-proc' };
      const params = {
        content: '절차 내용',
        workflow_name: 'wf',
        skill_name: 'sk',
        owner_id: 'owner-from-params',
      };
      const result = await tool.handle(params, ctxWithAgent);
      const data = JSON.parse(result.content[0].text);
      expect(data.memory_id).toBeDefined();
      const row = DatabaseUtils.get(db, 'SELECT owner_id FROM memory_item WHERE id = ?', [
        data.memory_id,
      ]) as { owner_id: string | null };
      expect(row.owner_id).toBe('owner-from-params');
    });

    it('Given: process_id·session_id 파라미터 또는 context, When: handle 호출하면, Then: memory_item에 process_id·session_id 저장됨 (Issue #87)', async () => {
      const params = {
        content: 'Attribution 절차',
        workflow_name: 'wf-attribution',
        skill_name: 'sk-attribution',
        process_id: 'process-deploy',
        session_id: 'session-001',
      };
      const result = await tool.handle(params, context);
      const data = JSON.parse(result.content[0].text);
      expect(data.memory_id).toBeDefined();
      const row = DatabaseUtils.get(db, 'SELECT process_id, session_id FROM memory_item WHERE id = ?', [
        data.memory_id,
      ]) as { process_id: string | null; session_id: string | null };
      expect(row.process_id).toBe('process-deploy');
      expect(row.session_id).toBe('session-001');
    });
  });

  describe('검증 실패 시나리오', () => {
    /**
     * Given: content 누락
     * When: handle 호출
     * Then: invalid_params 에러
     */
    it('Given: content 누락, When: handle 호출하면, Then: invalid_params 에러', async () => {
      const result = await tool.handle({ workflow_name: 'wf', skill_name: 'sk' }, context);
      expect(result.error).toBe('invalid_params');
      expect(JSON.parse(result.content[0].text).message).toContain('content');
    });

    /**
     * Given: content 빈 문자열
     * When: handle 호출
     * Then: invalid_params 에러
     */
    it('Given: content 빈 문자열, When: handle 호출하면, Then: invalid_params 에러', async () => {
      const result = await tool.handle({ content: '   ' }, context);
      expect(result.error).toBe('invalid_params');
    });

    /**
     * Given: workflow_name이 빈 문자열 (검증 규칙 위반)
     * When: handle 호출
     * Then: validation_failed 에러
     */
    it('Given: workflow_name 빈 문자열, When: handle 호출하면, Then: validation_failed 에러', async () => {
      const result = await tool.handle(
        { content: '절차 내용', workflow_name: '', skill_name: 'skill' },
        context
      );
      expect(result.error).toBe('validation_failed');
      expect(JSON.parse(result.content[0].text).message).toContain('workflow_name');
    });

    /**
     * Given: skill_name이 빈 문자열
     * When: handle 호출
     * Then: validation_failed 에러
     */
    it('Given: skill_name 빈 문자열, When: handle 호출하면, Then: validation_failed 에러', async () => {
      const result = await tool.handle(
        { content: '절차 내용', workflow_name: 'wf', skill_name: '' },
        context
      );
      expect(result.error).toBe('validation_failed');
      expect(JSON.parse(result.content[0].text).message).toContain('skill_name');
    });

    /**
     * Given: reflection_notes가 스키마 위반(필수 필드 누락)
     * When: handle 호출
     * Then: validation_failed 에러
     */
    it('Given: reflection_notes 스키마 위반, When: handle 호출하면, Then: validation_failed 에러', async () => {
      const result = await tool.handle(
        {
          content: '절차 내용',
          reflection_notes: JSON.stringify({
            failure_description: 'missing failure_type',
            timestamp: new Date().toISOString(),
          }),
        },
        context
      );
      expect(result.error).toBe('validation_failed');
      expect(JSON.parse(result.content[0].text).message).toMatch(/reflection_notes|스키마|검증/);
    });
  });

  describe('인프라 실패 시나리오', () => {
    /**
     * Given: context에 db 없음
     * When: handle 호출
     * Then: database_unavailable 에러
     */
    it('Given: context에 db 없음, When: handle 호출하면, Then: database_unavailable 에러', async () => {
      const result = await tool.handle(
        { content: '절차 내용' },
        { db: undefined, services: {} }
      );
      expect(result.error).toBe('database_unavailable');
    });
  });
});
