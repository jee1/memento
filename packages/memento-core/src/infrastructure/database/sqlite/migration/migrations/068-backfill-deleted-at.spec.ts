import { describe, expect, it } from 'vitest';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../../../test/helpers/test-database.js';
import { BackfillDeletedAtMigration } from './068-backfill-deleted-at.js';

describe('068 backfill deleted_at', () => {
  it('삭제 시각 없는 소프트 삭제 행만 채우고 나머지는 그대로 둔다', async () => {
    const db = await setupTestDatabase();
    db.exec(`
      INSERT INTO memory_item (id, type, content, is_deleted, deleted_at) VALUES
        ('missing', 'semantic', 'a', 1, NULL),
        ('pinned-deleted', 'semantic', 'd', 1, '2026-01-02T00:00:00.000Z'),
        ('kept', 'semantic', 'b', 1, '2026-01-01T00:00:00.000Z'),
        ('alive', 'semantic', 'c', 0, NULL);
    `);
    db.prepare("UPDATE memory_item SET pinned = 1 WHERE id = 'pinned-deleted'").run();
    const migration = new BackfillDeletedAtMigration();

    await migration.up(db);
    await migration.validateAfter(db);

    const rows = db.prepare('SELECT id, deleted_at FROM memory_item ORDER BY id').all() as Array<{ id: string; deleted_at: string | null }>;
    expect(rows.find((r) => r.id === 'missing')?.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rows.find((r) => r.id === 'kept')?.deleted_at).toBe('2026-01-01T00:00:00.000Z');
    expect(rows.find((r) => r.id === 'alive')?.deleted_at).toBeNull();
    expect(db.prepare("SELECT pinned FROM memory_item WHERE id = 'pinned-deleted'").get()).toEqual({ pinned: 0 });
    cleanupTestDatabase(db);
  });
});
