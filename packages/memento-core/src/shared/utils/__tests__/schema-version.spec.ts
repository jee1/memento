import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readCurrentSchemaVersion } from '../schema-version.js';

describe('readCurrentSchemaVersion (#1332)', () => {
  it('returns null when memento_schema_version is missing', () => {
    expect(readCurrentSchemaVersion(new Database(':memory:'))).toBeNull();
  });

  it('returns the most recently applied version', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY, applied_at TIMESTAMP, migration_name TEXT NOT NULL)');
    db.prepare('INSERT INTO memento_schema_version VALUES (?, ?, ?)').run('36.0', '2026-01-01 00:00:00', 'a');
    db.prepare('INSERT INTO memento_schema_version VALUES (?, ?, ?)').run('37.0', '2026-02-01 00:00:00', 'b');
    expect(readCurrentSchemaVersion(db)).toBe('37.0');
  });
});
