import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SupersedePointerIndexMigration } from './062-supersede-pointer-index.js';
import { hasActiveSupersedePointers } from '../../../../../shared/utils/memory-filter-sql.js';
import { MigrationDetector } from '../migration-detector.js';

describe('062-supersede-pointer-index', () => {
  it('uses an empty partial index before approval and observes apply/delete/restore without a cache', async () => {
    const db = new Database(':memory:');
    try {
      db.exec(`CREATE TABLE memory_item (id TEXT PRIMARY KEY, superseded_by TEXT, is_deleted INTEGER DEFAULT 0);
        INSERT INTO memory_item (id) VALUES ('old'), ('target')`);
      const migration = new SupersedePointerIndexMigration();
      await migration.validateBefore(db);
      await migration.up(db);
      await migration.up(db);
      await migration.validateAfter(db);
      const index = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_memory_item_superseded_by'").get() as { sql: string };
      expect(index.sql).toMatch(/WHERE superseded_by IS NOT NULL/i);
      expect(hasActiveSupersedePointers(db)).toBe(false);
      const prepare = db.prepare.bind(db);
      const statements: string[] = [];
      const observedDb = { prepare: (sql: string) => { statements.push(sql); return prepare(sql); } } as Database.Database;
      hasActiveSupersedePointers(observedDb);
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${statements[0]}`).all() as Array<{ detail: string }>;
      expect(plan.some(row => row.detail.includes('idx_memory_item_superseded_by'))).toBe(true);
      expect(plan.some(row => /SCAN mi\b/.test(row.detail))).toBe(false);
      db.exec("UPDATE memory_item SET superseded_by = 'target' WHERE id = 'old'");
      expect(hasActiveSupersedePointers(db)).toBe(true);
      db.exec("UPDATE memory_item SET is_deleted = 1 WHERE id = 'target'");
      expect(hasActiveSupersedePointers(db)).toBe(false);
      db.exec("UPDATE memory_item SET is_deleted = 0 WHERE id = 'target'");
      expect(hasActiveSupersedePointers(db)).toBe(true);
      db.exec("UPDATE memory_item SET superseded_by = NULL WHERE id = 'old'");
      expect(hasActiveSupersedePointers(db)).toBe(false);
      await migration.down(db);
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_memory_item_superseded_by'").get()).toBeUndefined();
    } finally { db.close(); }
  });

  it('is registered by discovery at version 62.0 and matches the bundled schema index', async () => {
    const migration = new SupersedePointerIndexMigration();
    expect(migration.version).toBe('62.0');
    const found = await new MigrationDetector().detectAllMigrations();
    expect(found.some(entry => entry.migration.version === '62.0' && entry.migration.name === migration.name)).toBe(true);
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    expect(schema).toMatch(/CREATE INDEX IF NOT EXISTS idx_memory_item_superseded_by\s+ON memory_item\(superseded_by\)\s+WHERE superseded_by IS NOT NULL;/);
  });
});
