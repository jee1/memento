/**
 * RepetitionMetaUpdateService 단위 테스트 (Issue #20)
 * 동등 분할: mergedIds 0건 / 1건 / N건. 경계값: 대표만, 대표+1, 대표+다수.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { updateRepresentativeRepetitionMeta } from '../repetition-meta-update-service.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';

describe('RepetitionMetaUpdateService (Issue #20)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
    vi.clearAllMocks();
  });

  it('Given: mergedIds 비어 있음, When: updateRepresentativeRepetitionMeta 호출, Then: null 반환', () => {
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, num_times, last_mentioned_at)
      VALUES ('rep-1', 'semantic', '대표', 0.5, 2, '2026-01-01T00:00:00.000Z')
    `);
    const result = updateRepresentativeRepetitionMeta(db, 'rep-1', []);
    expect(result).toBeNull();
  });

  it('Given: 대표 1건 + 병합 대상 1건, When: updateRepresentativeRepetitionMeta 호출, Then: 대표 num_times 합산·last_mentioned_at 최신값', () => {
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, num_times, last_mentioned_at)
      VALUES ('rep-1', 'semantic', '대표', 0.5, 2, '2026-01-01T00:00:00.000Z')
    `);
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, num_times, last_mentioned_at)
      VALUES ('merged-1', 'semantic', '병합됨', 0.5, 3, '2026-01-15T00:00:00.000Z')
    `);

    const result = updateRepresentativeRepetitionMeta(db, 'rep-1', ['merged-1']);
    expect(result).not.toBeNull();
    expect(result!.representativeId).toBe('rep-1');
    expect(result!.previousNumTimes).toBe(2);
    expect(result!.newNumTimes).toBe(5);
    expect(result!.newLastMentionedAt).toBe('2026-01-15T00:00:00.000Z');
    expect(result!.mergedCount).toBe(1);

    const row = DatabaseUtils.get(db, 'SELECT num_times, last_mentioned_at FROM memory_item WHERE id = ?', ['rep-1']) as { num_times: number; last_mentioned_at: string };
    expect(row.num_times).toBe(5);
    expect(row.last_mentioned_at).toBe('2026-01-15T00:00:00.000Z');
  });

  it('Given: 대표 1건 + 병합 대상 2건, When: updateRepresentativeRepetitionMeta 호출, Then: num_times 합·last_mentioned_at max', () => {
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, num_times, last_mentioned_at)
      VALUES ('rep-1', 'semantic', '대표', 0.5, 1, '2026-01-01T00:00:00.000Z')
    `);
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, num_times, last_mentioned_at)
      VALUES ('m1', 'semantic', 'a', 0.5, 2, '2026-01-10T00:00:00.000Z')
    `);
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, num_times, last_mentioned_at)
      VALUES ('m2', 'semantic', 'b', 0.5, 1, '2026-01-20T00:00:00.000Z')
    `);

    const result = updateRepresentativeRepetitionMeta(db, 'rep-1', ['m1', 'm2']);
    expect(result).not.toBeNull();
    expect(result!.newNumTimes).toBe(1 + 2 + 1); // 4
    expect(result!.newLastMentionedAt).toBe('2026-01-20T00:00:00.000Z');

    const row = DatabaseUtils.get(db, 'SELECT num_times, last_mentioned_at FROM memory_item WHERE id = ?', ['rep-1']) as { num_times: number; last_mentioned_at: string };
    expect(row.num_times).toBe(4);
    expect(row.last_mentioned_at).toBe('2026-01-20T00:00:00.000Z');
  });

  it('Given: 대표 ID가 없음, When: updateRepresentativeRepetitionMeta 호출, Then: 에러', () => {
    expect(() => updateRepresentativeRepetitionMeta(db, 'nonexistent', ['any'])).toThrow(/대표 항목을 찾을 수 없습니다/);
  });

  it('Given: mergedIds에 대표 ID 포함, When: updateRepresentativeRepetitionMeta 호출, Then: 대표 자신은 합산에서 제외', () => {
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, num_times, last_mentioned_at)
      VALUES ('rep-1', 'semantic', '대표', 0.5, 3, '2026-01-05T00:00:00.000Z')
    `);
    DatabaseUtils.run(db, `
      INSERT INTO memory_item (id, type, content, importance, num_times, last_mentioned_at)
      VALUES ('m1', 'semantic', 'a', 0.5, 1, '2026-01-15T00:00:00.000Z')
    `);
    const result = updateRepresentativeRepetitionMeta(db, 'rep-1', ['rep-1', 'm1']);
    expect(result).not.toBeNull();
    expect(result!.newNumTimes).toBe(3 + 1);
    const row = DatabaseUtils.get(db, 'SELECT num_times FROM memory_item WHERE id = ?', ['rep-1']) as { num_times: number };
    expect(row.num_times).toBe(4);
  });
});
