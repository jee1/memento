import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DropConsolidationScoreColumnsMigration } from './051-drop-consolidation-score-columns.js';
import { initializeDatabase } from '../../init.js';
import { mementoConfig } from '../../../../../shared/config/index.js';

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

function createPre051FixtureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      consolidation_score REAL,
      g_value REAL,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE INDEX idx_memory_item_consol_desc ON memory_item(consolidation_score DESC);
    CREATE INDEX idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2;
  `);
}

function createPost051FixtureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      is_deleted INTEGER DEFAULT 0
    );
  `);
}

describe('051-drop-consolidation-score-columns', () => {
  let db: Database.Database;
  let tempRoot: string;
  let dbPath: string;
  let previousDbPath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'memento-051-'));
    dbPath = path.join(tempRoot, 'memory.db');
    previousDbPath = mementoConfig.dbPath;
    mementoConfig.dbPath = dbPath;
    db = new Database(dbPath);
    createPre051FixtureSchema(db);
  });

  afterEach(() => {
    mementoConfig.dbPath = previousDbPath;
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('drops consolidation_score, g_value, and consol indexes while preserving recall_count and last_accessed_at', async () => {
    db.exec(`
      INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, consolidation_score, g_value)
      VALUES ('mem-1', 'episodic', 'preserved row one', 5, '2026-01-01T00:00:00Z', 0.75, 1.5);
      INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, consolidation_score, g_value)
      VALUES ('mem-2', 'semantic', 'preserved row two', 12, '2026-02-15T12:30:00Z', 0.42, 2.0);
    `);

    const migration = new DropConsolidationScoreColumnsMigration();
    await migration.validateBefore(db);
    await migration.up(db);
    await migration.validateAfter(db);

    const columns = (db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(columns).not.toContain('consolidation_score');
    expect(columns).not.toContain('g_value');
    expect(columns).toContain('recall_count');
    expect(columns).toContain('last_accessed_at');
    expect(indexExists(db, 'idx_memory_item_consol_desc')).toBe(false);
    expect(indexExists(db, 'idx_memory_item_consol_active')).toBe(false);

    const row1 = db
      .prepare('SELECT recall_count, last_accessed_at FROM memory_item WHERE id = ?')
      .get('mem-1') as { recall_count: number; last_accessed_at: string };
    const row2 = db
      .prepare('SELECT recall_count, last_accessed_at FROM memory_item WHERE id = ?')
      .get('mem-2') as { recall_count: number; last_accessed_at: string };
    expect(row1.recall_count).toBe(5);
    expect(row1.last_accessed_at).toBe('2026-01-01T00:00:00Z');
    expect(row2.recall_count).toBe(12);
    expect(row2.last_accessed_at).toBe('2026-02-15T12:30:00Z');

    expect((db.prepare('SELECT COUNT(*) AS count FROM memory_item').get() as { count: number }).count).toBe(2);

    const integrity = db.pragma('integrity_check', { simple: true }) as string;
    expect(integrity).toBe('ok');
  });

  it('is idempotent when consolidation columns were never present', async () => {
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });

    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'memento-051-idempotent-'));
    dbPath = path.join(tempRoot, 'memory.db');
    mementoConfig.dbPath = dbPath;
    db = new Database(dbPath);
    createPost051FixtureSchema(db);

    const migration = new DropConsolidationScoreColumnsMigration();
    await migration.up(db);
    await migration.validateAfter(db);
    await migration.up(db);
    await migration.validateAfter(db);
  });

  it('down() is irreversible', async () => {
    const migration = new DropConsolidationScoreColumnsMigration();
    await expect(migration.down(db)).rejects.toThrow(/irreversible/i);
  });

  it('reports metadata', () => {
    const migration = new DropConsolidationScoreColumnsMigration();
    expect(migration.version).toBe('51.0');
    expect(migration.name).toBe('drop-consolidation-score-columns');
  });
});

describe('051-drop-consolidation-score-columns fresh initializeDatabase', () => {
  let tempRoot: string;
  let dbPath: string;
  let db: Database.Database;
  let previousDbPath: string;

  afterEach(() => {
    mementoConfig.dbPath = previousDbPath;
    if (db) {
      db.close();
    }
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('initializeDatabase() fresh install omits consolidation_score and g_value', async () => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'memento-fresh-051-'));
    dbPath = path.join(tempRoot, 'memory.db');
    previousDbPath = mementoConfig.dbPath;
    mementoConfig.dbPath = dbPath;

    db = await initializeDatabase(dbPath);

    const columns = (db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(columns).not.toContain('consolidation_score');
    expect(columns).not.toContain('g_value');
    expect(columns).toContain('recall_count');
    expect(columns).toContain('last_accessed_at');
    expect(indexExists(db, 'idx_memory_item_consol_desc')).toBe(false);
    expect(indexExists(db, 'idx_memory_item_consol_active')).toBe(false);
  });
});
