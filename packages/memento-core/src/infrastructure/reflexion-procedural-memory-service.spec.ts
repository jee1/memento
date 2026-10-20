import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import type { FailureEvent } from '../domains/monitoring/services/failure-detector.js';
import { ReflexionProceduralMemoryService } from './reflexion-procedural-memory-service.js';
import { createProceduralMemory } from './reflexion-procedural-memory-service/reflexion-procedural-create.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT,
      steps TEXT,
      task_goal TEXT,
      reflection_notes TEXT,
      importance REAL,
      privacy_scope TEXT,
      created_at TEXT,
      version INTEGER,
      version_series_id TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe('Reflexion procedural memory embeddings (#1391)', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('embeds an automatically created procedural memory', async () => {
    db = createDb();
    const embeddingService = {
      createAndStoreEmbedding: vi.fn().mockResolvedValue({ provider: 'tfidf' }),
    } as unknown as MemoryEmbeddingService;

    const memoryId = await createProceduralMemory(
      db,
      { task_goal: 'Recover the failed remember operation' },
      { lessons_learned: 'retry' },
      { id: 'failure' } as FailureEvent,
      undefined,
      embeddingService
    );

    expect(memoryId).toBeTruthy();
    expect(embeddingService.createAndStoreEmbedding).toHaveBeenCalledWith(
      db,
      memoryId,
      'Recover the failed remember operation',
      'procedural'
    );
  });

  it('updates procedural content and re-embeds the changed text', async () => {
    db = createDb();
    db.prepare(
      "INSERT INTO memory_item (id, type, content, task_goal) VALUES ('memory', 'procedural', 'old goal', 'old goal')"
    ).run();
    const embeddingService = {
      createAndStoreEmbedding: vi.fn().mockResolvedValue({ provider: 'tfidf' }),
    } as unknown as MemoryEmbeddingService;
    const service = new ReflexionProceduralMemoryService(db, embeddingService);

    await service.updateProceduralMemory(
      'memory',
      { task_goal: 'new goal' },
      'replace',
      {},
      { id: 'failure' } as FailureEvent
    );

    expect(db.prepare("SELECT content FROM memory_item WHERE id = 'memory'").get()).toEqual({
      content: 'new goal',
    });
    expect(embeddingService.createAndStoreEmbedding).toHaveBeenCalledWith(
      db,
      'memory',
      'new goal',
      'procedural'
    );
  });
});
