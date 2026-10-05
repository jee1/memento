import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';
import { mementoConfig } from '../shared/config/index.js';
import { getBatchScheduler, resetBatchScheduler } from '../infrastructure/scheduler/batch-scheduler.js';
import { createRelationGraph } from '../infrastructure/relation-graph-factory.js';
import { createHybridSearchEngine, type HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import { RememberTool } from '../domains/memory/remember/remember-tool.js';
import { RecallTool } from '../domains/memory/recall/recall-tool.js';
import type { ToolContext } from '../tools/types.js';

function initializeRegressionDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
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
      version INTEGER NULL,
      version_series_id TEXT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
      project_id TEXT NULL,
      num_times INTEGER NOT NULL DEFAULT 1,
      last_mentioned_at TIMESTAMP,
      source_session_id TEXT,
      confidence REAL,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, relation_type)
    );

    CREATE TABLE IF NOT EXISTS relation_type_registry (
      type_name TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      description TEXT,
      applicable_types TEXT,
      default_confidence REAL DEFAULT 0.7,
      search_boost REAL DEFAULT 1.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getConsolidationColumns(
  db: Database.Database,
  memoryId: string,
): { consolidation_score: number | null; g_value: number | null } {
  return DatabaseUtils.get(
    db,
    'SELECT consolidation_score, g_value FROM memory_item WHERE id = ?',
    [memoryId],
  ) as { consolidation_score: number | null; g_value: number | null };
}

function assertConsolidationColumnsNull(db: Database.Database, memoryId: string): void {
  const row = getConsolidationColumns(db, memoryId);
  expect(row.consolidation_score).toBeNull();
  expect(row.g_value).toBeNull();
}

describe('consolidation score removal regression (#1244)', () => {
  let db: Database.Database;
  let rememberTool: RememberTool;
  let recallTool: RecallTool;
  let context: ToolContext;
  let hybridSearchEngine: HybridSearchEngine;
  let embeddingService: MemoryEmbeddingService;
  let savedAutoSetAnchorDefault: boolean;

  beforeEach(() => {
    savedAutoSetAnchorDefault = mementoConfig.autoSetAnchorDefault;
    mementoConfig.autoSetAnchorDefault = false;

    db = new Database(':memory:');
    initializeRegressionDatabase(db);
    resetBatchScheduler();
    const batchScheduler = getBatchScheduler();
    batchScheduler.start(db, null);

    rememberTool = new RememberTool();
    recallTool = new RecallTool();
    embeddingService = new MemoryEmbeddingService();
    hybridSearchEngine = createHybridSearchEngine(undefined, embeddingService);
    vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
    context = {
      db,
      services: {
        hybridSearchEngine,
        embeddingService,
        relationGraph: createRelationGraph(db),
        batchScheduler,
      },
    };
  });

  afterEach(async () => {
    mementoConfig.autoSetAnchorDefault = savedAutoSetAnchorDefault;
    const batchScheduler = getBatchScheduler();
    if (batchScheduler.getStatus().isRunning) {
      await batchScheduler.stop();
    }
    resetBatchScheduler();
    db.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('episodic remember leaves consolidation_score and g_value NULL', async () => {
    const content = `consolidation score removal remember ${Date.now()}`;
    const result = await rememberTool.handle(
      {
        type: 'episodic',
        content,
        importance: 0.6,
      },
      context,
    );
    const resultData = JSON.parse(result.content[0]!.text);

    assertConsolidationColumnsNull(db, resultData.memory_id);
  });

  it('replace update leaves consolidation_score and g_value NULL', async () => {
    const initialContent = `consolidation score removal update ${Date.now()}`;
    const createResult = await rememberTool.handle(
      {
        type: 'episodic',
        content: initialContent,
      },
      context,
    );
    const memoryId = JSON.parse(createResult.content[0]!.text).memory_id as string;

    const updatedContent = `${initialContent} replaced`;
    await rememberTool.handle(
      {
        type: 'episodic',
        memory_id: memoryId,
        update_mode: 'replace',
        content: updatedContent,
      },
      context,
    );

    assertConsolidationColumnsNull(db, memoryId);
  });

  it('recall after remember leaves consolidation_score and g_value NULL', async () => {
    const content = `consolidation score removal recall regression ${Date.now()}`;
    const rememberResult = await rememberTool.handle(
      {
        type: 'episodic',
        content,
      },
      context,
    );
    const memoryId = JSON.parse(rememberResult.content[0]!.text).memory_id as string;
    const row = DatabaseUtils.get(
      db,
      'SELECT type, content, importance, created_at FROM memory_item WHERE id = ?',
      [memoryId],
    ) as { type: string; content: string; importance: number; created_at: string };

    vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
      items: [
        {
          id: memoryId,
          memory_id: memoryId,
          type: row.type,
          content: row.content,
          importance: row.importance,
          created_at: row.created_at,
          final_score: 0.9,
        },
      ],
      total_count: 1,
      query_time: 1,
      text_count: 1,
      vector_count: 0,
    });

    const recallResult = await recallTool.handle(
      {
        query: 'consolidation score removal recall regression',
        type: 'episodic',
      },
      context,
    );
    const recallData = JSON.parse(recallResult.content[0]!.text);
    const returnedIds = (recallData.items ?? []).map(
      (item: { memory_id?: string; id?: string }) => item.memory_id ?? item.id,
    );

    expect(returnedIds).toContain(memoryId);
    assertConsolidationColumnsNull(db, memoryId);
  });

  it('mementoConfig has no consolidationScoreEnabled key', () => {
    expect('consolidationScoreEnabled' in mementoConfig).toBe(false);
  });
});
