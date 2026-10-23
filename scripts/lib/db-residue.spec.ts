import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  applyDimensionsZeroCleanup,
  applyRuleRelationCleanup,
  buildDbResidueReport,
  previewDimensionsZeroCleanup,
  previewRuleRelationCleanup,
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

  describe('rule relation cleanup', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE memory_relation (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          metadata TEXT
        );
      `);
      const ins = db.prepare(`INSERT INTO memory_relation VALUES (?, ?, ?, ?, ?)`);
      ins.run('r1', 'a', 'b', 'related', '{"method":"rule"}');
      ins.run('r2', 'a', 'c', 'related', '{"method":"rule"}');
      ins.run('r3', 'a', 'd', 'supersedes', '{"method":"rule"}');
      ins.run('l1', 'b', 'c', 'related', '{"method":"llm"}');
      ins.run('n1', 'b', 'd', 'related', null);
      ins.run('n2', 'c', 'd', 'related', '{}');
    });

    const count = () =>
      (db.prepare(`SELECT COUNT(*) AS c FROM memory_relation`).get() as { c: number }).c;

    it('preview counts only rule rows per type and deletes nothing', () => {
      expect(previewRuleRelationCleanup(db)).toEqual({
        total: 3,
        by_type: { related: 2, supersedes: 1 },
      });
      expect(count()).toBe(6);
    });

    it('apply removes rule rows, keeps llm and no-method rows, and is idempotent', () => {
      expect(applyRuleRelationCleanup(db)).toBe(3);
      const left = db.prepare(`SELECT id FROM memory_relation ORDER BY id`).all();
      expect(left).toEqual([{ id: 'l1' }, { id: 'n1' }, { id: 'n2' }]);
      expect(applyRuleRelationCleanup(db)).toBe(0);
      expect(previewRuleRelationCleanup(db)).toEqual({ total: 0, by_type: {} });
    });
  });
});
