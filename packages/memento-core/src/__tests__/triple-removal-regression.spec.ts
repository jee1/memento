import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';
import { ZodError } from 'zod';
import { getExposedTools, getToolRegistry } from '../tools/index.js';
import { launchBackgroundAugmentation } from '../domains/memory/remember/remember-tool-augmentation.js';
import { REGISTERED_MANUAL_BATCH_JOB_TYPES } from '../infrastructure/scheduler/batch-scheduler/batch-scheduler-job-runners.js';
import { RememberTool } from '../domains/memory/remember/remember-tool.js';
import { getBatchScheduler, resetBatchScheduler } from '../infrastructure/scheduler/batch-scheduler.js';
import { createRelationGraph } from '../infrastructure/relation-graph-factory.js';
import { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import type { ToolContext } from '../tools/types.js';
import type { RememberToolHost } from '../domains/memory/remember/remember-tool-host.js';

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

describe('triple removal regression (#1237)', () => {
  it('tools/list exposure has no extract_triples', () => {
    const names = getExposedTools('full').map((tool) => tool.name);
    expect(names).not.toContain('extract_triples');
    expect(getToolRegistry().get('extract_triples')).toBeUndefined();
  });

  it('launchBackgroundAugmentation never enqueues triple_extraction jobs', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');

    const addJob = vi.fn(() => true);
    const host: RememberToolHost = {
      logInfo: vi.fn(),
      logWarning: vi.fn(),
    };
    const context: ToolContext = {
      db,
      services: {
        batchScheduler: {
          addJob,
          isJobQueued: () => false,
          isJobRunning: () => false,
          getStatus: () => ({ isRunning: true }),
        },
      },
    };

    launchBackgroundAugmentation(
      {
        dbRef: db,
        savedMemoryId: 'mem_test',
        savedMemoryType: 'episodic',
        content: 'episodic without triple pipeline',
        importance: 0.5,
      },
      context,
      host,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const tripleJobs = addJob.mock.calls.filter(([name]) =>
      String(name).startsWith('triple_extraction_'),
    );
    expect(tripleJobs).toHaveLength(0);
    db.close();
  });

  it('batch scheduler registry has no triple_extraction_batch', () => {
    expect(REGISTERED_MANUAL_BATCH_JOB_TYPES).not.toContain('triple_extraction_batch');
  });

  describe('RememberTool episodic save', () => {
    let db: Database.Database;
    let tool: RememberTool;
    let context: ToolContext;
    let addJobSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      db = new Database(':memory:');
      initializeRegressionDatabase(db);
      resetBatchScheduler();
      const batchScheduler = getBatchScheduler();
      batchScheduler.start(db, null);
      addJobSpy = vi.spyOn(batchScheduler, 'addJob');

      tool = new RememberTool();
      context = {
        db,
        services: {
          hybridSearchEngine: new HybridSearchEngine(),
          embeddingService: new MemoryEmbeddingService(),
          relationGraph: createRelationGraph(db),
          batchScheduler,
        },
      };
    });

    afterEach(async () => {
      const batchScheduler = getBatchScheduler();
      if (batchScheduler.getStatus().isRunning) {
        await batchScheduler.stop();
      }
      addJobSpy.mockRestore();
      resetBatchScheduler();
      db.close();
      vi.unstubAllEnvs();
    });

    it('saves episodic memory to DB without triple extraction jobs', async () => {
      const result = await tool.handle(
        {
          type: 'episodic',
          content: 'triple removal episodic regression',
          importance: 0.6,
        },
        context,
      );
      const resultData = JSON.parse(result.content[0]!.text);

      const row = DatabaseUtils.get(db, 'SELECT id, type, content FROM memory_item WHERE id = ?', [
        resultData.memory_id,
      ]);
      expect(row).toBeDefined();
      expect(row.type).toBe('episodic');
      expect(row.content).toBe('triple removal episodic regression');

      await new Promise((resolve) => setTimeout(resolve, 50));
      const tripleJobs = addJobSpy.mock.calls.filter(([name]) =>
        String(name).startsWith('triple_extraction_'),
      );
      expect(tripleJobs).toHaveLength(0);
    });

    it('ignores TRIPLE_EXTRACTION_ENABLED legacy env without triple jobs', async () => {
      vi.stubEnv('TRIPLE_EXTRACTION_ENABLED', 'true');

      const result = await tool.handle(
        {
          type: 'episodic',
          content: 'legacy env should not revive triple pipeline',
        },
        context,
      );
      const resultData = JSON.parse(result.content[0]!.text);
      const row = DatabaseUtils.get(db, 'SELECT id FROM memory_item WHERE id = ?', [resultData.memory_id]);
      expect(row).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 50));
      const tripleJobs = addJobSpy.mock.calls.filter(([name]) =>
        String(name).startsWith('triple_extraction_'),
      );
      expect(tripleJobs).toHaveLength(0);
    });

    it('rejects enable_triple_extraction legacy input without saving', async () => {
      await expect(
        tool.handle(
          {
            type: 'episodic',
            content: 'legacy enable_triple_extraction input',
            enable_triple_extraction: true,
          } as Record<string, unknown>,
          context,
        ),
      ).rejects.toThrow(ZodError);

      const rowCount = DatabaseUtils.get(db, 'SELECT COUNT(*) AS count FROM memory_item', []);
      expect(rowCount.count).toBe(0);

      const tripleJobs = addJobSpy.mock.calls.filter(([name]) =>
        String(name).startsWith('triple_extraction_'),
      );
      expect(tripleJobs).toHaveLength(0);
    });
  });
});
