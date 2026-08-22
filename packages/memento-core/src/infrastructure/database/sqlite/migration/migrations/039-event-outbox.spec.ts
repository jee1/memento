import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { EventOutboxMigration } from './039-event-outbox.js';

describe('EventOutboxMigration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
  });

  afterEach(() => db.close());

  it('creates durable event and pending-delivery indexes', async () => {
    const migration = new EventOutboxMigration();
    await migration.up(db);
    await expect(migration.validateAfter(db)).resolves.toBeUndefined();

    const columns = db.prepare('PRAGMA table_info(event_outbox)').all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'event_type', 'target_uri', 'payload_json', 'idempotency_key', 'attempts', 'available_at', 'processed_at',
    ]));
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_event_outbox_pending'").get()).toBeTruthy();
  });
});
