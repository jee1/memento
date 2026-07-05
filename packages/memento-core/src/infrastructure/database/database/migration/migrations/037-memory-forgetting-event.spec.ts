import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryForgettingEventMigration } from './037-memory-forgetting-event.js';

describe('MemoryForgettingEventMigration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('creates memory_forgetting_event table and indexes', async () => {
    await new MemoryForgettingEventMigration().up(db);
    await new MemoryForgettingEventMigration().validateAfter(db);

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_forgetting_event'`)
      .get();
    expect(table).toBeDefined();
  });
});
