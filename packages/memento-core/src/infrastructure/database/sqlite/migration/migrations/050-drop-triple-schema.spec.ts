import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DropTripleSchemaMigration } from './050-drop-triple-schema.js';
import { TripleExtractionFieldsMigration } from './030-triple-extraction-fields.js';
import { KgTripleTableMigration } from './018-kg-triple-table.js';
import { MigrationRunner } from '../migration-runner.js';
import { initializeDatabase } from '../../init.js';

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { name: string } | undefined;
  return Boolean(row);
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function createPre050FixtureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      source TEXT,
      reflection_notes TEXT,
      subject TEXT,
      predicate TEXT,
      object TEXT,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE TABLE memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_memory_item_triple ON memory_item(subject, predicate, object)
      WHERE type='semantic' AND subject IS NOT NULL AND predicate IS NOT NULL AND object IS NOT NULL;
  `);
  createFtsTriggers(db);
}

function createFtsTriggers(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
      content,
      tags,
      source,
      reflection_notes,
      content='memory_item',
      content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
      INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
      VALUES (new.rowid, new.content, new.tags, new.source, new.reflection_notes);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_item_fts_update AFTER UPDATE ON memory_item BEGIN
      INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
      VALUES('delete', old.rowid, old.content, old.tags, old.source, old.reflection_notes);
      INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
      VALUES (new.rowid, new.content, new.tags, new.source, new.reflection_notes);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_item_fts_delete AFTER DELETE ON memory_item BEGIN
      INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
      VALUES('delete', old.rowid, old.content, old.tags, old.source, old.reflection_notes);
    END;
  `);
}

function ftsMatchCount(db: Database.Database, term: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM memory_item_fts
       WHERE memory_item_fts MATCH ?`,
    )
    .get(term) as { count: number };
  return row.count;
}

async function apply018And030(db: Database.Database): Promise<void> {
  await new KgTripleTableMigration().up(db);
  await new TripleExtractionFieldsMigration().up(db);
}

function injectExecFailureAfter(
  db: Database.Database,
  predicate: (sql: string) => boolean,
): void {
  const originalExec = db.exec.bind(db);
  db.exec = (sql: string) => {
    originalExec(sql);
    if (predicate(sql)) {
      throw new Error('injected mid-050 failure');
    }
  };
}

describe('050-drop-triple-schema', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `memento-050-${Date.now()}-${Math.random()}.db`);
    db = new Database(dbPath);
    createPre050FixtureSchema(db);
  });

  afterEach(() => {
    db.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('drops kg_triple, triple extraction columns, and SPO columns on upgrade from 018+030 fixture', async () => {
    await apply018And030(db);

    db.exec(`
      INSERT INTO memory_item (id, type, content, subject, predicate, object, triple_extracted, triple_extracted_status, triple_extraction_metadata)
      VALUES ('mem-1', 'semantic', 'preserved fts keyword alpha', '시스템', 'uses', '기능', 1, 'success', '{}');
      INSERT INTO memory_item (id, type, content)
      VALUES ('mem-2', 'episodic', 'episodic preserved');
    `);
    db.exec(`
      INSERT INTO kg_triple (id, subject, predicate, object, representative_memory_id)
      VALUES ('kg-1', 'a', 'b', 'c', 'mem-1');
    `);
    db.exec(`
      INSERT INTO memory_relation (source_id, target_id, relation_type)
      VALUES ('mem-2', 'mem-1', 'derived_from');
    `);

    expect(ftsMatchCount(db, 'alpha')).toBe(1);

    const migration = new DropTripleSchemaMigration();
    await migration.validateBefore(db);
    await migration.up(db);
    await migration.validateAfter(db);

    expect(tableExists(db, 'kg_triple')).toBe(false);

    const columns = (db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(columns).not.toContain('triple_extracted');
    expect(columns).not.toContain('triple_extracted_status');
    expect(columns).not.toContain('triple_extraction_metadata');
    expect(columns).not.toContain('subject');
    expect(columns).not.toContain('predicate');
    expect(columns).not.toContain('object');
    expect(indexExists(db, 'idx_memory_item_triple')).toBe(false);

    const semantic = db.prepare('SELECT content FROM memory_item WHERE id = ?').get('mem-1') as { content: string };
    const episodic = db.prepare('SELECT content FROM memory_item WHERE id = ?').get('mem-2') as { content: string };
    expect(semantic.content).toBe('preserved fts keyword alpha');
    expect(episodic.content).toBe('episodic preserved');
    expect(ftsMatchCount(db, 'alpha')).toBe(1);

    const relation = db.prepare('SELECT relation_type FROM memory_relation WHERE source_id = ?').get('mem-2') as {
      relation_type: string;
    };
    expect(relation.relation_type).toBe('derived_from');

    const integrity = db.pragma('integrity_check', { simple: true }) as string;
    const fk = db.pragma('foreign_key_check') as unknown[];
    expect(integrity).toBe('ok');
    expect(fk).toEqual([]);
  });

  it('MigrationRunner rolls back real 050 when up() fails mid-DDL', async () => {
    await apply018And030(db);
    db.exec(`
      INSERT INTO memory_item (id, type, content, subject, predicate, object, triple_extracted)
      VALUES ('mem-rollback', 'semantic', 'rollback keyword beta', 'a', 'b', 'c', 1);
    `);
    db.exec(`
      INSERT INTO kg_triple (id, subject, predicate, object, representative_memory_id)
      VALUES ('kg-rollback', 'a', 'b', 'c', 'mem-rollback');
    `);

    injectExecFailureAfter(db, (sql) => sql.includes('DROP COLUMN triple_extracted'));

    const runner = new MigrationRunner(db);
    const result = await runner.runMigration(new DropTripleSchemaMigration(), {
      autoRollback: true,
      createBackup: false,
      validate: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('injected mid-050 failure');
    expect(tableExists(db, 'kg_triple')).toBe(true);
    expect(columnExists(db, 'memory_item', 'subject')).toBe(true);
    expect(columnExists(db, 'memory_item', 'triple_extracted')).toBe(true);
    expect(indexExists(db, 'idx_memory_item_triple')).toBe(true);
    expect(ftsMatchCount(db, 'beta')).toBe(1);
  });

  it('down() is irreversible', async () => {
    const migration = new DropTripleSchemaMigration();
    await expect(migration.down(db)).rejects.toThrow(/irreversible/i);
  });

  it('is idempotent when run twice after a successful upgrade', async () => {
    await apply018And030(db);
    const migration = new DropTripleSchemaMigration();
    await migration.up(db);
    await migration.validateAfter(db);
    await migration.up(db);
    await migration.validateAfter(db);
  });

  it('reports metadata', () => {
    const migration = new DropTripleSchemaMigration();
    expect(migration.version).toBe('50.0');
    expect(migration.name).toBe('drop-triple-schema');
  });
});

describe('050-drop-triple-schema fresh initializeDatabase', () => {
  let dbPath: string;
  let db: Database.Database;

  afterEach(() => {
    if (db) {
      db.close();
    }
    try {
      if (dbPath) {
        fs.unlinkSync(dbPath);
      }
    } catch {
      // ignore
    }
  });

  it('initializeDatabase() fresh install omits triple/SPO schema', async () => {
    dbPath = path.join(os.tmpdir(), `memento-fresh-050-${Date.now()}.db`);
    db = await initializeDatabase(dbPath);

    expect(tableExists(db, 'kg_triple')).toBe(false);
    const columns = (db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(columns).not.toContain('triple_extracted');
    expect(columns).not.toContain('triple_extracted_status');
    expect(columns).not.toContain('triple_extraction_metadata');
    expect(columns).not.toContain('subject');
    expect(columns).not.toContain('predicate');
    expect(columns).not.toContain('object');
    expect(indexExists(db, 'idx_memory_item_triple')).toBe(false);
  });
});
