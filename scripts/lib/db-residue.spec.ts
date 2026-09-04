import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  applyDimensionsZeroCleanup,
  buildDbResidueReport,
  previewDimensionsZeroCleanup,
} from './db-residue.js';

describe('db-residue helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT
      );
      CREATE TABLE memory_embedding (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        embedding_provider TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        embedding BLOB
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('report counts missing minilm semantic and dimensions zero', () => {
    db.prepare(`INSERT INTO memory_item VALUES ('mem_a', 'semantic', 'a')`).run();
    db.prepare(`INSERT INTO memory_item VALUES ('mem_b', 'episodic', 'b')`).run();
    db.prepare(
      `INSERT INTO memory_embedding VALUES ('emb_zero', 'mem_x', 'tfidf', 0, X'')`,
    ).run();

    const report = buildDbResidueReport(db);
    expect(report.missing_minilm_semantic.count).toBe(1);
    expect(report.dimensions_zero.count).toBe(1);
  });

  it('cleanup-embeddings apply removes only dimensions=0', () => {
    db.prepare(
      `INSERT INTO memory_embedding VALUES ('emb_zero', 'mem_x', 'tfidf', 0, X'')`,
    ).run();
    db.prepare(
      `INSERT INTO memory_embedding VALUES ('emb_ok', 'mem_y', 'minilm', 384, X'0102')`,
    ).run();

    expect(previewDimensionsZeroCleanup(db).count).toBe(1);
    expect(applyDimensionsZeroCleanup(db)).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM memory_embedding`).get() as { c: number }).c,
    ).toBe(1);
  });
});
