import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { hashMemoryContent } from '../../../shared/utils/memory-content-hash.js';
import { MemoryEmbeddingContentHashMigration } from '../../database/sqlite/migration/migrations/054-memory-embedding-content-hash.js';
import { getEmbeddingModelFilter } from '../../../shared/config/embedding-models.js';
import { runModelMigrationLoop } from './model-migration-loop.js';
import {
  EmbeddingReconciliationBatchJob,
  RECONCILIATION_CONSECUTIVE_FAILURE_LIMIT,
  countModelDrift,
} from './embedding-reconciliation-batch-job.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL,
      projection_type TEXT NOT NULL DEFAULT 'native',
      content_hash TEXT,
      model TEXT,
      UNIQUE(memory_id, embedding_provider, projection_type)
    );
  `);
  return db;
}

function insertEmbedding(
  db: Database.Database,
  memoryId: string,
  contentHash: string,
  provider = 'tfidf',
  projectionType = 'native',
  model: string | null = getEmbeddingModelFilter(provider)
): void {
  db.prepare(
    `INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, content_hash, model)
     VALUES (?, ?, ?, ?, ?)`
  ).run(memoryId, provider, projectionType, contentHash, model);
}

function seedMemories(db: Database.Database, count: number): void {
  const insert = db.prepare("INSERT INTO memory_item (id, content, type) VALUES (?, ?, 'semantic')");
  for (let i = 0; i < count; i++) {
    const id = `m${String(i).padStart(5, '0')}`;
    insert.run(id, `content ${id}`);
  }
}

/** 지금 모델 native 행으로 바꿔 쓰는 가짜 저장기. 실패시킬 id 는 null 을 돌려준다. */
function currentModelWriter(db: Database.Database, failIds = new Set<string>()) {
  return vi.fn(async (_db: unknown, memoryId: string, content: string) => {
    if (failIds.has(memoryId)) return null;
    db.prepare('DELETE FROM memory_embedding WHERE memory_id = ?').run(memoryId);
    insertEmbedding(db, memoryId, hashMemoryContent(content), 'minilm', 'native');
    return { provider: 'minilm' };
  });
}

describe('EmbeddingReconciliationBatchJob', () => {
  it('reconciles all active memories in one cycle and excludes deleted memories', async () => {
    const db = createDb();
    try {
      const migration = new MemoryEmbeddingContentHashMigration();
      await migration.up(db);
      db.prepare("INSERT INTO memory_item (id, content, type) VALUES ('one', 'one', 'semantic'), ('two', 'two', 'procedural'), ('gone', 'gone', 'semantic')").run();
      db.prepare("UPDATE memory_item SET is_deleted = 1 WHERE id = 'gone'").run();

      const createAndStoreEmbedding = vi.fn(async (_db, memoryId: string, content: string) => {
        insertEmbedding(db, memoryId, hashMemoryContent(content));
        return { provider: 'tfidf' };
      });
      const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'tfidf');

      const result = await job.run();

      expect(result.success).toBe(true);
      expect(result.processed).toBe(2);
      expect(createAndStoreEmbedding).toHaveBeenCalledTimes(2);
      // 지정한 제공자만 쓴다(#1729). 다섯째 인자가 strict 제공자다.
      expect(createAndStoreEmbedding.mock.calls.map((call) => call[4])).toEqual(['tfidf', 'tfidf']);
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embedding').get()).toEqual({ n: 2 });
    } finally {
      db.close();
    }
  });

  it('retries a failed re-embedding in the next cycle after content changes', async () => {
    const db = createDb();
    try {
      const migration = new MemoryEmbeddingContentHashMigration();
      await migration.up(db);
      db.prepare("INSERT INTO memory_item (id, content, type) VALUES ('memory', 'old content', 'procedural')").run();
      insertEmbedding(db, 'memory', hashMemoryContent('old content'));

      db.prepare("UPDATE memory_item SET content = 'new content' WHERE id = 'memory'").run();
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embedding').get()).toEqual({ n: 0 });

      const createAndStoreEmbedding = vi.fn()
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(async (_db, memoryId: string, content: string) => {
          insertEmbedding(db, memoryId, hashMemoryContent(content));
          return { provider: 'tfidf' };
        });
      const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'tfidf');

      const failedCycle = await job.run();
      expect(failedCycle.success).toBe(false);
      expect(failedCycle.details).toEqual({ candidates: 1, remaining: 1, budgetExhausted: false, failureLimitReached: false });
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embedding').get()).toEqual({ n: 0 });

      const retryCycle = await job.run();
      expect(retryCycle.success).toBe(true);
      expect(retryCycle.details).toEqual({ candidates: 1, remaining: 0, budgetExhausted: false, failureLimitReached: false });
      expect(db.prepare('SELECT content_hash FROM memory_embedding').get()).toEqual({
        content_hash: hashMemoryContent('new content'),
      });
      expect(createAndStoreEmbedding).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });

  it('keeps the existing native row when re-embedding returns no result', async () => {
    const db = createDb();
    try {
      db.prepare("INSERT INTO memory_item (id, content, type) VALUES ('memory', 'content', 'semantic')").run();
      insertEmbedding(db, 'memory', 'stale-hash');
      const createAndStoreEmbedding = vi.fn(async () => null);
      const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'tfidf');

      const result = await job.run();

      expect(result.success).toBe(false);
      expect(db.prepare('SELECT embedding_provider, content_hash FROM memory_embedding').all()).toEqual([
        { embedding_provider: 'tfidf', content_hash: 'stale-hash' },
      ]);
    } finally {
      db.close();
    }
  });

  it('re-embeds memories whose current native row belongs to another provider', async () => {
    const db = createDb();
    try {
      db.prepare("INSERT INTO memory_item (id, content, type) VALUES ('fallback', 'fb', 'semantic'), ('ready', 'rd', 'semantic')").run();
      insertEmbedding(db, 'fallback', hashMemoryContent('fb'), 'tfidf');
      insertEmbedding(db, 'ready', hashMemoryContent('rd'), 'minilm');
      const createAndStoreEmbedding = vi.fn(async () => ({ provider: 'minilm' }));
      const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'minilm');

      await job.run();

      expect(createAndStoreEmbedding).toHaveBeenCalledTimes(1);
      expect(createAndStoreEmbedding).toHaveBeenCalledWith(db, 'fallback', 'fb', 'semantic', 'minilm');
    } finally {
      db.close();
    }
  });

  it('regenerates window rows when only they are stale', async () => {
    const db = createDb();
    try {
      db.prepare("INSERT INTO memory_item (id, content, type) VALUES ('memory', 'content', 'semantic')").run();
      insertEmbedding(db, 'memory', hashMemoryContent('content'), 'minilm', 'native');
      insertEmbedding(db, 'memory', 'stale-hash', 'minilm', 'window:0');
      const createAndStoreEmbedding = vi.fn(async () => ({ provider: 'minilm' }));
      const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'minilm');

      await job.run();

      expect(createAndStoreEmbedding).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  describe('모델 이주 (#1729)', () => {
    it('native 나 창 행이 옛 모델이면 후보다. 지금 모델 행만 있으면 후보가 아니다', async () => {
      const db = createDb();
      try {
        db.prepare("INSERT INTO memory_item (id, content, type) VALUES ('old-native', 'a', 'semantic'), ('old-window', 'b', 'semantic'), ('current', 'c', 'semantic')").run();
        insertEmbedding(db, 'old-native', hashMemoryContent('a'), 'minilm', 'native', 'old-model');
        insertEmbedding(db, 'old-window', hashMemoryContent('b'), 'minilm', 'native');
        insertEmbedding(db, 'old-window', hashMemoryContent('b'), 'minilm', 'window:0', 'old-model');
        insertEmbedding(db, 'current', hashMemoryContent('c'), 'minilm', 'native');
        insertEmbedding(db, 'current', hashMemoryContent('c'), 'minilm', 'window:0');
        const createAndStoreEmbedding = vi.fn(async () => ({ provider: 'minilm' }));

        await new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'minilm').run();

        expect(createAndStoreEmbedding.mock.calls.map((call) => call[1]).sort()).toEqual(['old-native', 'old-window']);
        expect(countModelDrift(db, 'minilm')).toEqual({ drifted: 2, active: 3 });
        expect(countModelDrift(db, 'tfidf')).toEqual({ drifted: 0, active: 3 });
      } finally {
        db.close();
      }
    });

    it('시간 예산이 다 되면 새 후보를 잡지 않고 남은 수를 돌려준다', async () => {
      const db = createDb();
      try {
        seedMemories(db, 5);
        let clock = 0;
        const now = () => clock;
        const writer = currentModelWriter(db);
        const createAndStoreEmbedding = vi.fn(async (...args: Parameters<typeof writer>) => {
          clock += 100;
          return writer(...args);
        });

        const result = await new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'minilm')
          .run(1000, { timeBudgetMs: 250, now });

        expect(result.processed).toBe(3);
        expect(result.details).toMatchObject({ remaining: 2, budgetExhausted: true, failureLimitReached: false });
      } finally {
        db.close();
      }
    });

    it(`연속 실패가 ${RECONCILIATION_CONSECUTIVE_FAILURE_LIMIT}건이면 실행을 멈춘다`, async () => {
      const db = createDb();
      try {
        seedMemories(db, 30);
        const ids = (db.prepare('SELECT id FROM memory_item').all() as Array<{ id: string }>).map((row) => row.id);
        const createAndStoreEmbedding = currentModelWriter(db, new Set(ids));

        const result = await new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'minilm').run();

        expect(createAndStoreEmbedding).toHaveBeenCalledTimes(RECONCILIATION_CONSECUTIVE_FAILURE_LIMIT);
        expect(result.success).toBe(false);
        expect(result.details).toMatchObject({ remaining: 30, failureLimitReached: true });
      } finally {
        db.close();
      }
    });

    it('로컬 제공자가 매번 throw 해도 상한에서 멈춘다', async () => {
      const db = createDb();
      try {
        seedMemories(db, 30);
        const createAndStoreEmbedding = vi.fn(async () => {
          throw new Error('model load failed');
        });

        const result = await new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'minilm').run();

        expect(createAndStoreEmbedding).toHaveBeenCalledTimes(RECONCILIATION_CONSECUTIVE_FAILURE_LIMIT);
        expect(result.details).toMatchObject({ failureLimitReached: true });
      } finally {
        db.close();
      }
    });
  });

  describe('모델 이주 반복 (#1729)', () => {
    function seedOldModel(db: Database.Database, count: number): void {
      seedMemories(db, count);
      for (const { id, content } of db.prepare('SELECT id, content FROM memory_item').all() as Array<{ id: string; content: string }>) {
        insertEmbedding(db, id, hashMemoryContent(content), 'minilm', 'native', 'old-model');
      }
    }

    it('옛 모델 행이 3,000건을 넘어도 1,000건 실행을 잇달아 돌려 후보 0 에서 멈춘다', async () => {
      const db = createDb();
      try {
        seedOldModel(db, 3200);
        const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding: currentModelWriter(db) } as never, 'minilm');

        const summary = await runModelMigrationLoop({ runOnce: () => job.run(1000), shouldContinue: () => true });

        expect(summary).toEqual({ runs: 4, processed: 3200, remaining: 0, stoppedBy: 'done' });
        expect(countModelDrift(db, 'minilm').drifted).toBe(0);
      } finally {
        db.close();
      }
    });

    it('시간 예산을 줄이면 실행마다 예산 안에서 멈추고 반복이 이어서 끝낸다', async () => {
      const db = createDb();
      try {
        seedOldModel(db, 1000);
        let clock = 0;
        const writer = currentModelWriter(db);
        const job = new EmbeddingReconciliationBatchJob(db, {
          createAndStoreEmbedding: async (...args: Parameters<typeof writer>) => {
            clock += 10;
            return writer(...args);
          },
        } as never, 'minilm');
        const perRun: number[] = [];

        const summary = await runModelMigrationLoop({
          runOnce: async () => {
            const start = clock;
            const result = await job.run(1000, { timeBudgetMs: 3000, now: () => clock });
            perRun.push(clock - start);
            return result;
          },
          shouldContinue: () => true,
        });

        expect(summary.stoppedBy).toBe('done');
        expect(summary.processed).toBe(1000);
        expect(perRun.length).toBeGreaterThan(1);
        expect(Math.max(...perRun)).toBeLessThanOrEqual(3000);
      } finally {
        db.close();
      }
    });

    it('중간에 멈춰도 다음 반복이 남은 것을 이어서 끝낸다', async () => {
      const db = createDb();
      try {
        seedOldModel(db, 2500);
        const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding: currentModelWriter(db) } as never, 'minilm');
        let runs = 0;

        const first = await runModelMigrationLoop({ runOnce: () => job.run(1000), shouldContinue: () => runs++ < 1 });
        expect(first).toMatchObject({ runs: 1, remaining: 1500, stoppedBy: 'stopped' });

        const second = await runModelMigrationLoop({ runOnce: () => job.run(1000), shouldContinue: () => true });
        expect(second).toMatchObject({ runs: 2, remaining: 0, stoppedBy: 'done' });
      } finally {
        db.close();
      }
    });

    it('드리프트가 없으면 한 번 보고 처리 0 으로 멈춘다', async () => {
      const db = createDb();
      try {
        seedMemories(db, 3);
        for (const { id, content } of db.prepare('SELECT id, content FROM memory_item').all() as Array<{ id: string; content: string }>) {
          insertEmbedding(db, id, hashMemoryContent(content), 'minilm', 'native');
        }
        const createAndStoreEmbedding = currentModelWriter(db);
        const job = new EmbeddingReconciliationBatchJob(db, { createAndStoreEmbedding } as never, 'minilm');

        const summary = await runModelMigrationLoop({ runOnce: () => job.run(1000), shouldContinue: () => true });

        expect(summary).toEqual({ runs: 1, processed: 0, remaining: 0, stoppedBy: 'done' });
        expect(createAndStoreEmbedding).not.toHaveBeenCalled();
      } finally {
        db.close();
      }
    });

    it('계속 실패하는 기억만 남으면 처리 0 실행에서 멈춘다', async () => {
      const db = createDb();
      try {
        seedOldModel(db, 5);
        const job = new EmbeddingReconciliationBatchJob(db, {
          createAndStoreEmbedding: currentModelWriter(db, new Set(['m00003'])),
        } as never, 'minilm');

        const summary = await runModelMigrationLoop({ runOnce: () => job.run(1000), shouldContinue: () => true });

        expect(summary).toEqual({ runs: 2, processed: 4, remaining: 1, stoppedBy: 'no_progress' });
      } finally {
        db.close();
      }
    });
  });
});
