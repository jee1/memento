import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { AddWorkRecordMigration } from './057-add-work-record.js';

describe('057-add-work-record', () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it('adds work_record and is idempotent', async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL
      )
    `);
    const migration = new AddWorkRecordMigration();
    await migration.up(db);
    await migration.validateAfter(db);
    await migration.up(db);
    const columns = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === 'work_record')).toBe(true);
  });
});
