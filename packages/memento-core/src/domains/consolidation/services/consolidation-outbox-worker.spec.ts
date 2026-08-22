import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SleepConsolidationService } from './sleep-consolidation-service.js';
import { ConsolidationOutboxWorker } from './consolidation-outbox-worker.js';
import { applyConsolidationTestSchema } from '../__tests__/consolidation-test-schema.js';
import { EventOutboxMigration } from '../../../infrastructure/database/sqlite/migration/migrations/039-event-outbox.js';
import { EventOutboxService } from '../../telemetry/services/event-outbox-service.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';

function insertEpisodic(db: Database.Database, id: string, owner: string) {
  DatabaseUtils.run(
    db,
    `INSERT INTO memory_item (id, type, content, owner_id, created_at) VALUES (?, 'episodic', ?, ?, datetime('now', '-1 day'))`,
    [id, `body-${id}`, owner]
  );
}

function insertEmbedding(db: Database.Database, memoryId: string, vec: number[]) {
  DatabaseUtils.run(
    db,
    `INSERT INTO memory_embedding (memory_id, embedding, dim, embedding_provider) VALUES (?, ?, ?, 'tfidf')`,
    [memoryId, JSON.stringify(vec), vec.length]
  );
}

describe('consolidation outbox PoC (#659)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('CONSOLIDATION_SIMILARITY_THRESHOLD', '0.75');
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    db = new Database(':memory:');
    applyConsolidationTestSchema(db);
    await new EventOutboxMigration().up(db);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    db.close();
  });

  it('does nothing when the outbox feature flag is disabled', async () => {
    const emb = [1, 0, 0, 0];
    for (let i = 0; i < 10; i++) {
      insertEpisodic(db, `e${i}`, 'agent-x');
      insertEmbedding(db, `e${i}`, emb);
    }
    const { createRelationGraph } = await import('../../../infrastructure/relation-graph-factory.js');
    const svc = new SleepConsolidationService(db, { relationGraph: createRelationGraph(db) });
    const result = await svc.run({ ownerIdFilter: 'agent-x' });
    expect(result.semanticsCreated).toBe(1);

    const rows = new EventOutboxService(db).pending();
    expect(rows).toHaveLength(0);
  });

  it('enqueues consolidation.completed and lets a decoupled worker consume it', async () => {
    vi.stubEnv('MEMENTO_EVENT_OUTBOX_ENABLED', 'true');
    const emb = [1, 0, 0, 0];
    for (let i = 0; i < 10; i++) {
      insertEpisodic(db, `e${i}`, 'agent-x');
      insertEmbedding(db, `e${i}`, emb);
    }
    const { createRelationGraph } = await import('../../../infrastructure/relation-graph-factory.js');
    const svc = new SleepConsolidationService(db, { relationGraph: createRelationGraph(db) });
    const result = await svc.run({ ownerIdFilter: 'agent-x' });
    expect(result.semanticsCreated).toBe(1);

    const sem = DatabaseUtils.get(
      db,
      `SELECT id FROM memory_item WHERE type = 'semantic' LIMIT 1`
    ) as { id: string };

    const outbox = new EventOutboxService(db);
    const pendingBefore = outbox.pending();
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0]).toMatchObject({
      eventType: 'consolidation.completed',
      targetUri: `memento://agent-x/memory/${sem.id}`,
      ownerId: 'agent-x',
    });
    expect(pendingBefore[0]!.payload).toMatchObject({ semantic_id: sem.id, episodic_count: 10, merged: false });

    const handled: unknown[] = [];
    const worker = new ConsolidationOutboxWorker(input => {
      handled.push(input);
    });
    const publishResult = await outbox.publishPending(worker);

    expect(publishResult).toEqual({ published: 1, failed: 0 });
    expect(worker.handled).toBe(1);
    expect(handled).toEqual([
      {
        targetUri: `memento://agent-x/memory/${sem.id}`,
        ownerId: 'agent-x',
        payload: expect.objectContaining({ semantic_id: sem.id }),
      },
    ]);
    expect(outbox.pending()).toHaveLength(0);
  });

  it('ignores unrelated outbox event types', async () => {
    vi.stubEnv('MEMENTO_EVENT_OUTBOX_ENABLED', 'true');
    const outbox = new EventOutboxService(db);
    outbox.enqueue({
      eventType: 'memory.remembered',
      targetUri: 'memento://agent-x/memory/mem_1',
      ownerId: 'agent-x',
      payload: {},
      idempotencyKey: 'memory.remembered:mem_1',
    });

    const handled: unknown[] = [];
    const worker = new ConsolidationOutboxWorker(input => {
      handled.push(input);
    });
    const publishResult = await outbox.publishPending(worker);

    expect(publishResult).toEqual({ published: 1, failed: 0 });
    expect(worker.handled).toBe(0);
    expect(handled).toHaveLength(0);
  });
});
