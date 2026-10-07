import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { RememberTool } from '../remember-tool.js';
import type { ToolContext } from '../../../tools/types.js';
import { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../../services/memory-embedding-service.js';
import { getBatchScheduler, resetBatchScheduler } from '../../../../infrastructure/scheduler/batch-scheduler.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';

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
      triple_extraction_metadata TEXT DEFAULT NULL,
      version INTEGER NULL,
      version_series_id TEXT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
      num_times INTEGER NOT NULL DEFAULT 1,
      last_mentioned_at TIMESTAMP,
      source_session_id TEXT,
      confidence REAL,
      project_id TEXT NULL,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      deleted_at TEXT
    );
  `);
}

describe('RememberTool context.projectId (#1270)', () => {
  let db: Database.Database;
  let tool: RememberTool;
  let baseContext: ToolContext;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    const embeddingService = new MemoryEmbeddingService();
    const hybridSearchEngine = new HybridSearchEngine();
    tool = new RememberTool();

    resetBatchScheduler();
    const batchScheduler = getBatchScheduler();
    batchScheduler.start(db, null);

    baseContext = {
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
    db.close();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses context.projectId when project_id is omitted on a new save', async () => {
    const context = { ...baseContext, projectId: 'proj-a' };
    const result = await tool.handle({
      content: 'context project default',
      type: 'semantic',
    }, context);

    expect(result.isError).toBeFalsy();
    const row = db.prepare(
      'SELECT project_id FROM memory_item WHERE content = ?',
    ).get('context project default') as { project_id: string | null } | undefined;
    expect(row?.project_id).toBe('proj-a');
  });

  it('prefers explicit project_id over context.projectId', async () => {
    const context = { ...baseContext, projectId: 'proj-a' };
    await tool.handle({
      content: 'explicit project wins',
      type: 'semantic',
      project_id: 'proj-b',
    }, context);

    const row = db.prepare(
      'SELECT project_id FROM memory_item WHERE content = ?',
    ).get('explicit project wins') as { project_id: string | null } | undefined;
    expect(row?.project_id).toBe('proj-b');
  });

  it('stores NULL project_id when context.projectId is absent', async () => {
    await tool.handle({
      content: 'no context project',
      type: 'episodic',
    }, baseContext);

    const row = db.prepare(
      'SELECT project_id FROM memory_item WHERE content = ?',
    ).get('no context project') as { project_id: string | null } | undefined;
    expect(row?.project_id).toBeNull();
  });

  it('does not apply context.projectId on memory_id replace updates', async () => {
    db.prepare(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, project_id, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run('mem-null-project', 'episodic', 'original content', 0.5, 'private', null);

    const context = { ...baseContext, projectId: 'proj-a' };
    const result = await tool.handle({
      type: 'episodic',
      content: 'updated content',
      memory_id: 'mem-null-project',
      update_mode: 'replace',
    }, context);

    const data = JSON.parse(result.content[0].text);
    expect(data.updated).toBe(true);

    const row = db.prepare(
      'SELECT project_id, content FROM memory_item WHERE id = ?',
    ).get('mem-null-project') as { project_id: string | null; content: string };
    expect(row.project_id).toBeNull();
    expect(row.content).toBe('updated content');
  });
});
