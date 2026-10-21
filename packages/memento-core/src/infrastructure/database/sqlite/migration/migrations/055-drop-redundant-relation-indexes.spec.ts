import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DropRedundantRelationIndexesMigration } from './055-drop-redundant-relation-indexes.js';

const DROPPED_INDEXES = [
  'idx_memory_relation_source',
  'idx_memory_relation_target',
  'idx_memory_relation_type',
  'idx_memory_relation_confidence',
] as const;

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { name: string } | undefined;
  return Boolean(row);
}

function createRelationFixture(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at TEXT,
      updated_at TEXT,
      metadata TEXT,
      UNIQUE(source_id, target_id, relation_type)
    );
    CREATE INDEX idx_memory_relation_source ON memory_relation(source_id);
    CREATE INDEX idx_memory_relation_target ON memory_relation(target_id);
    CREATE INDEX idx_memory_relation_type ON memory_relation(relation_type);
    CREATE INDEX idx_memory_relation_confidence ON memory_relation(confidence);
    CREATE INDEX idx_memory_relation_source_type ON memory_relation(source_id, relation_type);
    CREATE INDEX idx_memory_relation_target_type ON memory_relation(target_id, relation_type);
  `);
}

function plan(db: Database.Database, sql: string): string {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
    .map(row => (row as { detail: string }).detail)
    .join(' | ');
}

describe('055-drop-redundant-relation-indexes', () => {
  let db: Database.Database;
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'memento-055-'));
    db = new Database(path.join(tempRoot, 'memory.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('drops the four redundant indexes and keeps relation rows', async () => {
    createRelationFixture(db);
    db.prepare(`
      INSERT INTO memory_relation (source_id, target_id, relation_type, confidence)
      VALUES ('mem-a', 'mem-b', 'FOLLOWS', 0.9)
    `).run();

    const migration = new DropRedundantRelationIndexesMigration();
    await migration.validateBefore(db);
    await migration.up(db);
    await migration.validateAfter(db);

    for (const indexName of DROPPED_INDEXES) {
      expect(indexExists(db, indexName)).toBe(false);
    }
    expect(indexExists(db, 'idx_memory_relation_source_type')).toBe(true);
    expect(indexExists(db, 'idx_memory_relation_target_type')).toBe(true);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM memory_relation').get() as { count: number }).count,
    ).toBe(1);
  });

  it('keeps index lookups for source, target, and type-qualified queries', async () => {
    createRelationFixture(db);
    const insert = db.prepare(`
      INSERT INTO memory_relation (source_id, target_id, relation_type, confidence)
      VALUES (?, ?, ?, ?)
    `);
    const types = ['FOLLOWS', 'CAUSES', 'REFERENCES', 'DEPENDS_ON'];
    const seed = db.transaction(() => {
      for (let i = 0; i < 4000; i++) {
        insert.run(`s${i % 800}`, `t${i % 900}`, types[i % types.length], (i % 100) / 100);
      }
    });
    seed();
    db.exec('ANALYZE');

    const migration = new DropRedundantRelationIndexesMigration();
    await migration.up(db);

    const queries = [
      `SELECT * FROM memory_relation WHERE source_id = 's1'`,
      `SELECT * FROM memory_relation WHERE target_id = 't1'`,
      `SELECT * FROM memory_relation WHERE source_id = 's1' AND relation_type = 'FOLLOWS'`,
      `SELECT * FROM memory_relation WHERE target_id = 't1' AND relation_type = 'CAUSES'`,
      `SELECT * FROM memory_relation WHERE source_id = 's1' AND target_id = 't1' AND relation_type = 'FOLLOWS'`,
      `SELECT * FROM memory_relation WHERE source_id = 's1' OR target_id = 's1'`,
    ];
    for (const sql of queries) {
      const detail = plan(db, sql);
      expect(detail).toContain('USING INDEX');
      expect(detail).not.toContain('SCAN memory_relation');
    }
  });

  it('is idempotent when the indexes are already gone', async () => {
    createRelationFixture(db);
    const migration = new DropRedundantRelationIndexesMigration();
    await migration.up(db);
    await migration.up(db);
    await migration.validateAfter(db);
    expect(indexExists(db, 'idx_memory_relation_source')).toBe(false);
  });

  it('down() recreates the dropped indexes', async () => {
    createRelationFixture(db);
    const migration = new DropRedundantRelationIndexesMigration();
    await migration.up(db);
    await migration.down(db);
    for (const indexName of DROPPED_INDEXES) {
      expect(indexExists(db, indexName)).toBe(true);
    }
  });

  it('schema.sql does not create the dropped indexes', () => {
    const schemaPath = fileURLToPath(new URL('../../schema.sql', import.meta.url));
    const schema = readFileSync(schemaPath, 'utf8');
    for (const indexName of DROPPED_INDEXES) {
      expect(schema).not.toContain(`CREATE INDEX IF NOT EXISTS ${indexName} ON`);
    }
    expect(schema).toContain('idx_memory_relation_source_type');
    expect(schema).toContain('idx_memory_relation_target_type');
  });
});
