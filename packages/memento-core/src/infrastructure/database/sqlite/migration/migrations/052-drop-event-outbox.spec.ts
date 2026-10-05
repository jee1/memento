import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DropEventOutboxMigration } from './052-drop-event-outbox.js';

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { name: string } | undefined;
  return Boolean(row);
}

function createEventOutboxFixtureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE event_outbox (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      target_uri TEXT NOT NULL,
      owner_id TEXT,
      payload_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_event_outbox_pending
      ON event_outbox(processed_at, available_at, created_at);
    CREATE INDEX idx_event_outbox_target_uri
      ON event_outbox(target_uri);
  `);
}

describe('052-drop-event-outbox', () => {
  let db: Database.Database;
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'memento-052-'));
    db = new Database(path.join(tempRoot, 'memory.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('drops event_outbox, both indexes, and existing rows', async () => {
    createEventOutboxFixtureSchema(db);
    db.prepare(`
      INSERT INTO event_outbox (id, event_type, target_uri, payload_json, idempotency_key)
      VALUES ('evt-1', 'memory.forgotten', 'memento://default/memory/mem-1', '{}', 'k1')
    `).run();
    db.prepare(`
      INSERT INTO memory_item (id, type, content)
      VALUES ('mem-1', 'episodic', 'preserved row')
    `).run();

    const migration = new DropEventOutboxMigration();
    await migration.validateBefore(db);
    await migration.up(db);
    await migration.validateAfter(db);

    expect(tableExists(db, 'event_outbox')).toBe(false);
    expect(indexExists(db, 'idx_event_outbox_pending')).toBe(false);
    expect(indexExists(db, 'idx_event_outbox_target_uri')).toBe(false);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM memory_item').get() as { count: number }).count,
    ).toBe(1);
  });

  it('is idempotent when event_outbox was never present', async () => {
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL
      );
    `);

    const migration = new DropEventOutboxMigration();
    await migration.up(db);
    await migration.validateAfter(db);
    await migration.up(db);
    await migration.validateAfter(db);
  });

  it('down() is irreversible', async () => {
    const migration = new DropEventOutboxMigration();
    await expect(migration.down(db)).rejects.toThrow(/irreversible/i);
  });

  it('reports metadata', () => {
    const migration = new DropEventOutboxMigration();
    expect(migration.version).toBe('52.0');
    expect(migration.name).toBe('drop-event-outbox');
  });
});
