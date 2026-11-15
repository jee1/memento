import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeDatabase } from '../../../database/sqlite/init.js';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { LOCAL_EMBEDDING_MODEL } from '../../../../shared/config/embedding-models.js';
import { runSleepConsolidationBatch } from '../batch-scheduler-sleep-telemetry-handlers.js';
import type { BatchSchedulerRunContext } from '../batch-scheduler-run-context.js';

vi.mock('../batch-scheduler-embedding-handlers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../batch-scheduler-embedding-handlers.js')>()),
  resolveTargetProvider: () => 'minilm',
}));

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function seed(drifted: number): Promise<Database.Database> {
  const dir = mkdtempSync(join(tmpdir(), 'sleep-model-drift-'));
  dirs.push(dir);
  const db = await initializeDatabase(join(dir, 'memory.db'));
  const vector = encodeFloat32Embedding(new Array<number>(384).fill(0.05));
  for (let i = 0; i < 100; i++) {
    const id = `m${i}`;
    db.prepare("INSERT INTO memory_item (id, type, content, importance) VALUES (?, 'episodic', 'c', 0.5)").run(id);
    db.prepare(
      `INSERT INTO memory_embedding
         (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
       VALUES (?, 'minilm', 'native', ?, 384, ?, 384, 32, 1, 1, 'test')`
    ).run(id, vector, i < drifted ? 'old-model' : LOCAL_EMBEDDING_MODEL.storedName);
  }
  return db;
}

function context(db: Database.Database) {
  const execute = vi.fn(async () => ({
    jobType: 'sleep_consolidation_batch',
    startTime: new Date(),
    endTime: new Date(),
    duration: 0,
    success: true,
    processed: 1,
    errors: [],
    warnings: [],
  }));
  const ctx = {
    db,
    sleepConsolidationService: {},
    sleepConsolidationBatchJob: { current: { execute } },
    lastExecution: new Map(),
    totalExecutions: new Map(),
    log: vi.fn(),
  } as unknown as BatchSchedulerRunContext;
  return { ctx, execute };
}

describe('Sleep consolidation 모델 드리프트 조건 (#1729)', () => {
  it('드리프트가 활성 기억의 1% 를 넘으면 건너뛰고 이유를 warnings 에 남긴다', async () => {
    const db = await seed(2);
    const { ctx, execute } = context(db);

    const result = await runSleepConsolidationBatch(ctx);

    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, processed: 0, warnings: ['모델 드리프트 2건(2.0%) 때문에 건너뜀'] });
    db.close();
  });

  it('1% 이하면 돈다. 실패로 남은 기억 몇 건이 consolidation 을 영구히 멈추지 않는다', async () => {
    const db = await seed(1);
    const { ctx, execute } = context(db);

    const result = await runSleepConsolidationBatch(ctx);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
    db.close();
  });
});
