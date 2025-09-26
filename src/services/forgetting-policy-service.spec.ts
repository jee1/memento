import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ForgettingPolicyService } from './forgetting-policy-service.js';
import { DatabaseUtils } from '../utils/database.js';

const daysAgo = (days: number): string => {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString();
};

const closeDatabase = (db: Database.Database): void => {
  db.close();
};

describe('ForgettingPolicyService.executeMemoryCleanup', () => {
  let db: Database.Database;
  let service: ForgettingPolicyService;

  beforeEach(async () => {
    db = new Database(':memory:');
    service = new ForgettingPolicyService({ hardDeleteThreshold: 0.7 });

    await DatabaseUtils.exec(
      db,
      `CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL,
        privacy_scope TEXT DEFAULT 'private',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_accessed TEXT,
        pinned BOOLEAN DEFAULT FALSE,
        tags TEXT,
        source TEXT,
        embedding BLOB,
        view_count INTEGER DEFAULT 0,
        cite_count INTEGER DEFAULT 0,
        edit_count INTEGER DEFAULT 0
      )`
    );

    await DatabaseUtils.run(
      db,
      `INSERT INTO memory_item (id, type, content, importance, created_at, last_accessed, pinned, view_count, cite_count, edit_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'memory-soft',
        'episodic',
        '오래되었지만 하드 삭제 기준은 넘지 않은 기억',
        0.1,
        daysAgo(60),
        null,
        0,
        0,
        0,
        0
      ]
    );

    await DatabaseUtils.run(
      db,
      `INSERT INTO memory_item (id, type, content, importance, created_at, last_accessed, pinned, view_count, cite_count, edit_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'memory-hard',
        'episodic',
        '매우 오래되어 하드 삭제 대상이 되는 기억',
        0.1,
        daysAgo(400),
        null,
        0,
        0,
        0,
        0
      ]
    );

    await DatabaseUtils.run(
      db,
      `INSERT INTO memory_item (id, type, content, importance, created_at, last_accessed, pinned, view_count, cite_count, edit_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'memory-recent',
        'episodic',
        '최근에 접근된 중요한 기억',
        0.9,
        daysAgo(5),
        new Date().toISOString(),
        0,
        5,
        1,
        0
      ]
    );
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('망각 정책에 따라 소프트/하드 삭제 및 리뷰 업데이트를 수행한다', async () => {
    const result = await service.executeMemoryCleanup(db);

    expect(result.totalProcessed).toBe(3);

    expect(result.softDeleted).toContain('memory-soft');
    expect(result.softDeleted).toContain('memory-hard');
    expect(result.hardDeleted).toContain('memory-hard');
    expect(result.hardDeleted).not.toContain('memory-soft');

    expect(result.reviewed).toEqual(expect.arrayContaining(['memory-soft', 'memory-hard']));
    expect(result.reviewed).not.toContain('memory-recent');

    expect(result.summary.actualSoftDeletes).toBe(2);
    expect(result.summary.actualHardDeletes).toBe(1);
    expect(result.summary.actualReviews).toBe(2);

    const softRow = await DatabaseUtils.get(
      db,
      'SELECT id, last_accessed FROM memory_item WHERE id = ?',
      ['memory-soft']
    );
    expect(softRow).toBeDefined();
    expect(softRow.last_accessed).not.toBeNull();

    const hardRow = await DatabaseUtils.get(
      db,
      'SELECT id FROM memory_item WHERE id = ?',
      ['memory-hard']
    );
    expect(hardRow).toBeUndefined();

    const remainingIds = await DatabaseUtils.all(
      db,
      'SELECT id FROM memory_item ORDER BY id'
    );
    expect(remainingIds.map((row: any) => row.id)).toEqual(['memory-recent', 'memory-soft']);
  });
});
