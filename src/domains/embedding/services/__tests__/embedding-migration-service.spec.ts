import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { embeddingMigrationService } from './embedding-migration-service.js';
import { migrationMonitorService } from '../../../services/migration-monitor-service.js';
import type { MigrationProgress, MigrationProgressEvent } from '../../../types/migration.types.js';

function createSchema(db: Database.Database): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL,
      projection_type TEXT NOT NULL DEFAULT 'native',
      embedding TEXT NOT NULL,
      dim INTEGER NOT NULL,
      model TEXT,
      dimensions INTEGER NOT NULL,
      precision INTEGER DEFAULT 32,
      normalized INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      created_by TEXT DEFAULT 'system',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(memory_id, embedding_provider, projection_type)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_provider_from TEXT NOT NULL,
      plan_provider_to TEXT NOT NULL,
      plan_target_dimensions INTEGER NOT NULL,
      plan_projection_type TEXT NOT NULL,
      plan_normalization TEXT NOT NULL,
      plan_batch_size INTEGER NOT NULL,
      plan_dry_run INTEGER NOT NULL DEFAULT 0,
      plan_resume_from_id TEXT,
      plan_target_model TEXT,
      plan_created_by TEXT,
      start_time TIMESTAMP NOT NULL,
      end_time TIMESTAMP NOT NULL,
      processed INTEGER NOT NULL,
      succeeded INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      success INTEGER NOT NULL,
      next_resume_from_id TEXT,
      error_count INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT,
      rollback_entries_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedMemoryItem(db: Database.Database, memoryId: string): void {
  db.prepare('INSERT OR IGNORE INTO memory_item (id) VALUES (?)').run(memoryId);
}

describe('EmbeddingMigrationService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a basic migration plan with defaults', () => {
    const plan = embeddingMigrationService.createPlan('minilm', 'openai');

    expect(plan.sourceProvider).toBe('minilm');
    expect(plan.targetProvider).toBe('openai');
    expect(plan.targetDimensions).toBeGreaterThan(0);
    expect(plan.normalization).toBe('none');
    expect(plan.batchSize).toBeGreaterThan(0);
    expect(plan.autoRollbackOnFailure).toBe(true);
  });

  it('reprojects embeddings to the target provider and inserts new rows', async () => {
    const memoryId = 'memory-001';
    seedMemoryItem(db, memoryId);

    const legacyVector = Array.from({ length: 384 }, (_, idx) => (idx + 1) / 384);

    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      memoryId,
      'minilm',
      'native',
      JSON.stringify(legacyVector),
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    const plan = embeddingMigrationService.createPlan('minilm', 'openai');
    const result = await embeddingMigrationService.execute(db, plan);

    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.rollbackEntries).toHaveLength(1);
    expect(result.rolledBack).toBe(false);

    const migrated = db
      .prepare('SELECT embedding_provider, projection_type, embedding, dimensions FROM memory_embedding WHERE memory_id = ? AND embedding_provider = ?')
      .get(memoryId, 'openai');

    expect(migrated).toBeDefined();
    const migratedVector: number[] = JSON.parse(migrated.embedding);
    expect(migratedVector).toHaveLength(plan.targetDimensions);
    expect(migrated.projection_type).toBe('zero_pad');
    expect(migrated.dimensions).toBe(plan.targetDimensions);

    const original = db
      .prepare('SELECT embedding FROM memory_embedding WHERE memory_id = ? AND embedding_provider = ?')
      .get(memoryId, 'minilm');
    expect(original).toBeDefined();

    embeddingMigrationService.rollback(db, result.rollbackEntries);

    const remaining = db
      .prepare('SELECT COUNT(*) AS cnt FROM memory_embedding WHERE embedding_provider = ?')
      .get('openai') as { cnt: number };
    expect(remaining.cnt).toBe(0);

    const historyCount = db.prepare('SELECT COUNT(*) AS cnt FROM migration_history').get() as { cnt: number };
    expect(historyCount.cnt).toBe(1);
  });

  it('skips database writes when dryRun is enabled', async () => {
    const memoryId = 'memory-002';
    seedMemoryItem(db, memoryId);

    const vector = Array.from({ length: 384 }, () => Math.random());
    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      memoryId,
      'minilm',
      'native',
      JSON.stringify(vector),
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    const plan = embeddingMigrationService.createPlan('minilm', 'openai', { dryRun: true });
    const result = await embeddingMigrationService.execute(db, plan);

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.rollbackEntries).toHaveLength(0);
    expect(result.rolledBack).toBe(false);

    const migratedCount = db
      .prepare('SELECT COUNT(*) AS count FROM memory_embedding WHERE embedding_provider = ?')
      .get('openai');
    expect(migratedCount.count).toBe(0);

    const historyCount = db.prepare('SELECT COUNT(*) AS cnt FROM migration_history').get() as { cnt: number };
    expect(historyCount.cnt).toBe(0);
  });

  it('lists migration targets with reprojection indicators', () => {
    const memoryId = 'memory-003';
    seedMemoryItem(db, memoryId);

    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      memoryId,
      'minilm',
      'native',
      JSON.stringify(Array.from({ length: 384 }, () => 0.01)),
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    const plan = embeddingMigrationService.createPlan('minilm', 'openai');
    const targets = embeddingMigrationService.listTargets(db, plan, 10);

    expect(targets).toHaveLength(1);
    const target = targets[0];
    expect(target.memoryId).toBe(memoryId);
    expect(target.needsProviderSwitch).toBe(true);
    expect(target.needsReprojection).toBe(true);
    expect(target.targetDimensions).toBe(plan.targetDimensions);
  });

  it('restores previous target rows on rollback', async () => {
    const memoryId = 'memory-rollback';
    seedMemoryItem(db, memoryId);

    const legacy = Array.from({ length: 384 }, (_, idx) => idx / 384);
    const existingTarget = Array.from({ length: 1536 }, () => 0.5);

    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      memoryId,
      'minilm',
      'native',
      JSON.stringify(legacy),
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      memoryId,
      'openai',
      'native',
      JSON.stringify(existingTarget),
      1536,
      'openai-original',
      1536,
      32,
      1,
      1,
      'seed-target'
    );

    const plan = embeddingMigrationService.createPlan('minilm', 'openai');
    const result = await embeddingMigrationService.execute(db, plan);

    expect(result.rollbackEntries).toHaveLength(1);
    const migrated = db
      .prepare('SELECT projection_type, model FROM memory_embedding WHERE memory_id = ? AND embedding_provider = ? AND projection_type = ?')
      .get(memoryId, 'openai', 'zero_pad');
    expect(migrated).toBeDefined();
    expect(migrated.model).toBe('compat-openai');

    embeddingMigrationService.rollback(db, result.rollbackEntries);

    const restoredNative = db
      .prepare('SELECT embedding, model, precision, normalized FROM memory_embedding WHERE memory_id = ? AND embedding_provider = ? AND projection_type = ?')
      .get(memoryId, 'openai', 'native');
    expect(restoredNative).toBeDefined();
    expect(restoredNative.model).toBe('openai-original');
    expect(JSON.parse(restoredNative.embedding)).toEqual(existingTarget);

    const rolledBackRow = db
      .prepare('SELECT 1 FROM memory_embedding WHERE memory_id = ? AND embedding_provider = ? AND projection_type = ?')
      .get(memoryId, 'openai', 'zero_pad');
    expect(rolledBackRow).toBeUndefined();

    const historyCount = db.prepare('SELECT COUNT(*) AS cnt FROM migration_history').get() as { cnt: number };
    expect(historyCount.cnt).toBe(1);
  });

  it('emits progress updates through monitor callback', async () => {
    const memoryId = 'memory-004';
    seedMemoryItem(db, memoryId);

    const vector = Array.from({ length: 384 }, () => 0.02);
    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      memoryId,
      'minilm',
      'native',
      JSON.stringify(vector),
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    const updates: Array<Readonly<MigrationProgress>> = [];

    const plan = embeddingMigrationService.createPlan('minilm', 'openai', { batchSize: 1 });
    await embeddingMigrationService.execute(db, plan, {
      onProgress: snapshot => {
        updates.push(snapshot);
      },
      reportEvery: 1,
      stepDescription: 'Test migration'
    });

    expect(updates.length).toBeGreaterThan(2);
    const first = updates[0];
    const last = updates.at(-1)!;

    expect(first.total).toBe(1);
    expect(first.currentStep?.description).toBe('Test migration');
    expect(last.succeeded).toBe(1);
    expect(last.currentStep).toBeUndefined();
    expect(last.stepHistory.at(-1)?.status).toBe('completed');
  });

  it('publishes progress to migration monitor service when runId is provided', async () => {
    const memoryId = 'memory-005';
    const runId = 'run-monitor';
    seedMemoryItem(db, memoryId);

    const vector = Array.from({ length: 384 }, () => 0.05);
    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      memoryId,
      'minilm',
      'native',
      JSON.stringify(vector),
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    const events: MigrationProgressEvent[] = [];
    const unsubscribe = migrationMonitorService.subscribe(runId, event => {
      events.push(event);
    });

    const plan = embeddingMigrationService.createPlan('minilm', 'openai');
    const result = await embeddingMigrationService.execute(db, plan, {
      runId,
      reportEvery: 1
    });

    unsubscribe();
    migrationMonitorService.clear(runId);

    expect(result.success).toBe(true);
    expect(events.length).toBeGreaterThan(1);
    const last = events.at(-1)!;
    expect(last.status).toBe('completed');
    expect(last.progress.succeeded).toBe(result.succeeded);
    expect(last.progress.failed).toBe(0);
    expect(last.progress.currentStep).toBeUndefined();
  });

  it('rolls back automatically on failure when autoRollbackOnFailure is enabled', async () => {
    const firstId = 'memory-success';
    const secondId = 'memory-fail';
    seedMemoryItem(db, firstId);
    seedMemoryItem(db, secondId);

    const goodVector = Array.from({ length: 384 }, (_, idx) => (idx + 1) / 384);
    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      firstId,
      'minilm',
      'native',
      JSON.stringify(goodVector),
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      secondId,
      'minilm',
      'native',
      'not-a-json-vector',
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    const plan = embeddingMigrationService.createPlan('minilm', 'openai', { batchSize: 1 });
    const result = await embeddingMigrationService.execute(db, plan);

    expect(result.success).toBe(false);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.rolledBack).toBe(true);
    expect(result.rollbackEntries).toHaveLength(1);
    expect(result.errors?.length).toBeGreaterThanOrEqual(1);

    const migratedCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM memory_embedding WHERE embedding_provider = ?')
      .get('openai') as { cnt: number };
    expect(migratedCount.cnt).toBe(0);
  });

  it('retains inserted rows when autoRollbackOnFailure is disabled', async () => {
    const firstId = 'memory-success-no-rollback';
    const secondId = 'memory-fail-no-rollback';
    seedMemoryItem(db, firstId);
    seedMemoryItem(db, secondId);

    const vector = Array.from({ length: 384 }, () => 0.25);
    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      firstId,
      'minilm',
      'native',
      JSON.stringify(vector),
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      secondId,
      'minilm',
      'native',
      'invalid-json',
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    const plan = embeddingMigrationService.createPlan('minilm', 'openai', {
      batchSize: 1,
      autoRollbackOnFailure: false
    });
    const result = await embeddingMigrationService.execute(db, plan);

    expect(plan.autoRollbackOnFailure).toBe(false);
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(false);

    const migrated = db
      .prepare('SELECT COUNT(*) AS cnt FROM memory_embedding WHERE embedding_provider = ? AND projection_type = ?')
      .get('openai', 'zero_pad') as { cnt: number };
    expect(migrated.cnt).toBe(1);
  });

  it('lists migration history records', async () => {
    const memoryId = 'memory-history';
    seedMemoryItem(db, memoryId);

    const vector = Array.from({ length: 384 }, (_, idx) => (idx + 1) / 384);
    db.prepare(
      `
        INSERT INTO memory_embedding (
          memory_id,
          embedding_provider,
          projection_type,
          embedding,
          dim,
          model,
          dimensions,
          precision,
          normalized,
          version,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      memoryId,
      'minilm',
      'native',
      JSON.stringify(vector),
      384,
      'minilm-test',
      384,
      32,
      0,
      1,
      'seed'
    );

    const plan = embeddingMigrationService.createPlan('minilm', 'openai');
    const result = await embeddingMigrationService.execute(db, plan);
    expect(result.success).toBe(true);

    const history = embeddingMigrationService.listHistory(db);
    expect(history).toHaveLength(1);

    const record = history[0];
    expect(record.plan.sourceProvider).toBe('minilm');
    expect(record.plan.targetProvider).toBe('openai');
    expect(record.plan.dryRun).toBe(false);
    expect(record.result.processed).toBe(1);
    expect(record.result.rollbackEntries).toHaveLength(1);
    expect(record.result.rollbackEntries[0].operation).toBe('delete');
    expect(record.result.rolledBack).toBe(false);
    expect(record.errorCount).toBe(0);
    expect(record.result.errors).toBeUndefined();
    expect(record.createdAt).toBeInstanceOf(Date);
  });
});
