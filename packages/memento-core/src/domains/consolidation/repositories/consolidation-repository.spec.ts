import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ConsolidationRepository } from './consolidation-repository.js';
import { applyConsolidationTestSchema } from '../__tests__/consolidation-test-schema.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';

describe('ConsolidationRepository', () => {
  let db: Database.Database;
  let repo: ConsolidationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    applyConsolidationTestSchema(db);
    repo = new ConsolidationRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('findEpisodicCandidates excludes consolidated and pinned', () => {
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, pinned, is_consolidated, created_at)
      VALUES ('e1', 'episodic', 'a', 0, 0, datetime('now', '-1 day'))`);
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, pinned, is_consolidated, created_at)
      VALUES ('e2', 'episodic', 'b', 1, 0, datetime('now', '-1 day'))`);
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, pinned, is_consolidated, created_at)
      VALUES ('e3', 'episodic', 'c', 0, 1, datetime('now', '-1 day'))`);
    const rows = repo.findEpisodicCandidates(null, 30);
    expect(rows.map(r => r.id)).toEqual(['e1']);
  });

  it('findEpisodicCandidates filters by ownerIdFilter', () => {
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, owner_id, created_at)
      VALUES ('a', 'episodic', 'x', 'o1', datetime('now', '-1 day'))`);
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, owner_id, created_at)
      VALUES ('b', 'episodic', 'y', 'o2', datetime('now', '-1 day'))`);
    const rows = repo.findEpisodicCandidates('o1', 30);
    expect(rows.map(r => r.id)).toEqual(['a']);
  });

  it('markEpisodicsConsolidated sets flag and caps importance', () => {
    DatabaseUtils.run(db, `INSERT INTO memory_item (id, type, content, importance, created_at)
      VALUES ('e1', 'episodic', 'x', 0.9, datetime('now'))`);
    repo.markEpisodicsConsolidated(['e1'], 0.1);
    const row = DatabaseUtils.get(db, 'SELECT is_consolidated, importance FROM memory_item WHERE id = ?', [
      'e1'
    ]) as { is_consolidated: number; importance: number };
    expect(Boolean(row.is_consolidated)).toBe(true);
    expect(row.importance).toBeLessThanOrEqual(0.1);
  });
});
