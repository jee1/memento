import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VEC_TABLES,
  buildVecTableDdl,
  buildVecTriggerSql,
  listExistingVecTables,
  recreateVecTriggers,
} from '../../vec-schema.js';
import { DropLegacyMemoryItemVecMigration } from './056-drop-legacy-memory-item-vec.js';

async function loadVecExtension(db: Database.Database): Promise<boolean> {
  try {
    const { getLoadablePath } = await import('sqlite-vec');
    db.loadExtension(getLoadablePath());
    return true;
  } catch {
    return false;
  }
}

function tableQueryable(db: Database.Database, name: string): boolean {
  try {
    db.prepare(`SELECT rowid FROM ${name} LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

function createEmbeddingTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_embedding (
      id INTEGER PRIMARY KEY,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL,
      projection_type TEXT NOT NULL DEFAULT 'native',
      embedding TEXT NOT NULL,
      dimensions INTEGER NOT NULL
    );
  `);
}

describe('056-drop-legacy-memory-item-vec', () => {
  let db: Database.Database;
  let tempRoot: string;
  let vecAvailable = false;

  beforeEach(async () => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'memento-056-'));
    db = new Database(path.join(tempRoot, 'memory.db'));
    vecAvailable = await loadVecExtension(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('drops memory_item_vec and rewrites triggers without it', async () => {
    if (!vecAvailable) return;

    createEmbeddingTable(db);
    db.exec(buildVecTableDdl({
      name: 'memory_item_vec',
      dimension: 384,
      predicates: [],
      filter: '',
    }));
    const minilm = VEC_TABLES.find(table => table.name === 'memory_item_vec_minilm');
    expect(minilm).toBeDefined();
    db.exec(buildVecTableDdl(minilm!));
    recreateVecTriggers(db, [
      ...listExistingVecTables(db),
      {
        name: 'memory_item_vec',
        dimension: 384,
        predicates: ["embedding_provider = 'tfidf'", 'dimensions = 384', "projection_type = 'native'"],
        filter: "embedding_provider = 'tfidf' AND dimensions = 384 AND projection_type = 'native'",
      },
    ]);

    const migration = new DropLegacyMemoryItemVecMigration();
    await migration.up(db);
    await migration.validateAfter(db);

    expect(tableQueryable(db, 'memory_item_vec')).toBe(false);
    expect(tableQueryable(db, 'memory_item_vec_minilm')).toBe(true);
    const trigger = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'memory_embedding_vec_insert'")
      .get() as { sql: string };
    expect(trigger.sql).not.toContain('INSERT INTO memory_item_vec(');
    expect(trigger.sql).toContain('INSERT INTO memory_item_vec_minilm(');
  });

  it('is idempotent when the legacy table is already gone', async () => {
    if (!vecAvailable) return;
    createEmbeddingTable(db);
    const minilm = VEC_TABLES.find(table => table.name === 'memory_item_vec_minilm')!;
    db.exec(buildVecTableDdl(minilm));
    const migration = new DropLegacyMemoryItemVecMigration();
    await migration.up(db);
    await migration.up(db);
    await migration.validateAfter(db);
    expect(tableQueryable(db, 'memory_item_vec_minilm')).toBe(true);
  });

  it('down() is irreversible', async () => {
    const migration = new DropLegacyMemoryItemVecMigration();
    await expect(migration.down(db)).rejects.toThrow(/irreversible/i);
  });

  it('schema.sql and VEC_TABLES do not create memory_item_vec', () => {
    const schemaPath = fileURLToPath(new URL('../../schema.sql', import.meta.url));
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).not.toContain('INSERT INTO memory_item_vec(');
    expect(schema).not.toContain('DELETE FROM memory_item_vec ');
    expect(schema).not.toContain(
      'CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec USING'
    );
    expect(VEC_TABLES.some(table => table.name === 'memory_item_vec')).toBe(false);
    expect(buildVecTriggerSql(VEC_TABLES).insert).not.toContain('INSERT INTO memory_item_vec(');
  });
});
