/**
 * Migration 047 테스트 — memory_item created_at·last_accessed_at ISO 정규화
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { NormalizeTimestampFormatMigration } from './047-normalize-timestamp-format.js';

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function createMemoryItemTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      created_at TEXT,
      last_accessed_at TEXT
    )
  `);
}

function julianday(db: Database.Database, column: 'created_at' | 'last_accessed_at', id: string): number {
  return (
    db
      .prepare(`SELECT julianday(${column}) as jd FROM memory_item WHERE id = ?`)
      .get(id) as { jd: number }
  ).jd;
}

describe('Migration 047 - normalize timestamp format', () => {
  let db: Database.Database;
  let migration: NormalizeTimestampFormatMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemTable(db);
    migration = new NormalizeTimestampFormatMigration();
  });

  afterEach(() => {
    db.close();
  });

  it('converts space-format created_at and last_accessed_at to ISO', async () => {
    db.exec(`
      INSERT INTO memory_item (id, type, content, created_at, last_accessed_at) VALUES
        ('space-created', 'episodic', 'a', '2025-09-23 01:10:19', '2025-09-23 02:20:30'),
        ('iso-created', 'episodic', 'b', '2025-09-23T02:10:19.000Z', '2025-09-23T03:20:30.000Z')
    `);

    await migration.up(db);

    const spaceRow = db
      .prepare('SELECT created_at, last_accessed_at FROM memory_item WHERE id = ?')
      .get('space-created') as { created_at: string; last_accessed_at: string };
    expect(spaceRow.created_at).toBe('2025-09-23T01:10:19.000Z');
    expect(spaceRow.last_accessed_at).toBe('2025-09-23T02:20:30.000Z');
    expect(spaceRow.created_at).toMatch(ISO_PATTERN);
    expect(spaceRow.last_accessed_at).toMatch(ISO_PATTERN);
    expect(spaceRow.created_at.length).toBe(24);

    const isoRow = db
      .prepare('SELECT created_at, last_accessed_at FROM memory_item WHERE id = ?')
      .get('iso-created') as { created_at: string; last_accessed_at: string };
    expect(isoRow.created_at).toBe('2025-09-23T02:10:19.000Z');
    expect(isoRow.last_accessed_at).toBe('2025-09-23T03:20:30.000Z');
  });

  it('preserves julianday across conversion (no time shift)', async () => {
    db.exec(`
      INSERT INTO memory_item (id, type, content, created_at, last_accessed_at) VALUES
        ('jd-check', 'episodic', 'x', '2025-09-23 01:10:19', '2025-09-23 02:20:30')
    `);
    const beforeCreated = julianday(db, 'created_at', 'jd-check');
    const beforeLastAccessed = julianday(db, 'last_accessed_at', 'jd-check');

    await migration.up(db);

    expect(julianday(db, 'created_at', 'jd-check')).toBe(beforeCreated);
    expect(julianday(db, 'last_accessed_at', 'jd-check')).toBe(beforeLastAccessed);
  });

  it('is idempotent — running up() twice yields the same values', async () => {
    db.exec(`
      INSERT INTO memory_item (id, type, content, created_at, last_accessed_at) VALUES
        ('idem', 'episodic', 'x', '2025-09-23 01:10:19', '2025-09-23 02:20:30')
    `);

    await migration.up(db);
    const afterFirst = db
      .prepare('SELECT created_at, last_accessed_at FROM memory_item WHERE id = ?')
      .get('idem') as { created_at: string; last_accessed_at: string };

    await migration.up(db);
    const afterSecond = db
      .prepare('SELECT created_at, last_accessed_at FROM memory_item WHERE id = ?')
      .get('idem') as { created_at: string; last_accessed_at: string };

    expect(afterSecond).toEqual(afterFirst);
  });

  it('validateAfter passes when no space-format timestamps remain', async () => {
    await migration.up(db);
    await expect(migration.validateAfter(db)).resolves.not.toThrow();
  });

  it('validateAfter throws when space-format created_at remains', async () => {
    db.exec(`
      INSERT INTO memory_item (id, type, content, created_at) VALUES
        ('bad', 'episodic', 'x', '2025-09-23 01:10:19')
    `);
    await expect(migration.validateAfter(db)).rejects.toThrow(/space-format created_at/);
  });
});
