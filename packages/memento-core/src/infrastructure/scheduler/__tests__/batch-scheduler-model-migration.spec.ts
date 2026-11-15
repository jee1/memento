import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../../database/sqlite/init.js';
import { encodeFloat32Embedding } from '../../../shared/utils/embedding-serialization.js';
import { LOCAL_EMBEDDING_MODEL } from '../../../shared/config/embedding-models.js';
import { BatchScheduler } from '../batch-scheduler/batch-scheduler.js';

vi.mock('../handlers/batch-scheduler-embedding-handlers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../handlers/batch-scheduler-embedding-handlers.js')>()),
  resolveTargetProvider: () => 'minilm',
}));

const dirs: string[] = [];

async function dbWithModel(model: string): Promise<Database.Database> {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-model-migration-'));
  dirs.push(dir);
  const db = await initializeDatabase(join(dir, 'memory.db'));
  db.prepare("INSERT INTO memory_item (id, type, content, importance) VALUES ('m1', 'semantic', 'c', 0.5)").run();
  db.prepare(
    `INSERT INTO memory_embedding
       (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
     VALUES ('m1', 'minilm', 'native', ?, 384, ?, 384, 32, 1, 1, 'test')`
  ).run(encodeFloat32Embedding(new Array<number>(384).fill(0.05)), model);
  return db;
}

function runningScheduler(db: Database.Database) {
  const scheduler = new BatchScheduler();
  Object.assign(scheduler as unknown as { isRunning: boolean; db: Database.Database }, { isRunning: true, db });
  const runJob = vi.spyOn(scheduler, 'runJob').mockResolvedValue({
    jobType: 'embedding_reconciliation',
    startTime: new Date(),
    endTime: new Date(),
    duration: 0,
    success: true,
    processed: 1,
    errors: [],
    warnings: [],
    details: { candidates: 1, remaining: 0, budgetExhausted: false, failureLimitReached: false },
  });
  return { scheduler, runJob };
}

describe('BatchScheduler.startModelMigration (#1729)', () => {
  const dbs: Database.Database[] = [];
  afterEach(() => {
    dbs.splice(0).forEach((db) => db.close());
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it('옛 모델 행이 있으면 embedding_reconciliation 을 돌리고 끝나면 상태를 푼다', async () => {
    const db = await dbWithModel('old-model');
    dbs.push(db);
    const { scheduler, runJob } = runningScheduler(db);

    scheduler.startModelMigration();
    expect(scheduler.isModelMigrationRunning()).toBe(true);
    scheduler.startModelMigration();

    await vi.waitFor(() => expect(scheduler.isModelMigrationRunning()).toBe(false));
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(runJob).toHaveBeenCalledWith('embedding_reconciliation');
  });

  it('드리프트가 없거나 정합 잡이 일시정지면 돌지 않는다', async () => {
    const current = await dbWithModel(LOCAL_EMBEDDING_MODEL.storedName);
    const drifted = await dbWithModel('old-model');
    dbs.push(current, drifted);

    const idle = runningScheduler(current);
    idle.scheduler.startModelMigration();
    expect(idle.scheduler.isModelMigrationRunning()).toBe(false);

    const paused = runningScheduler(drifted);
    (paused.scheduler as unknown as { pausedJobs: Set<string> }).pausedJobs.add('embedding_reconciliation');
    paused.scheduler.startModelMigration();
    expect(paused.scheduler.isModelMigrationRunning()).toBe(false);

    expect(idle.runJob).not.toHaveBeenCalled();
    expect(paused.runJob).not.toHaveBeenCalled();
  });
});
