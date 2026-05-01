import type Database from 'better-sqlite3';

/** `memory_item` GROUP BY type 행 (SQLite 동적 스키마 대응) */
export interface MemoryItemTypeStatRow {
  type: string;
  count: number;
  pinned_count: number;
  old_count: number;
  avg_importance: number | null;
}

export interface BatchSchedulerDatabaseStats {
  memoryStats: MemoryItemTypeStatRow[];
  totalMemories: number;
  estimatedSize: number;
}

/**
 * 모니터링 등에서 사용하는 DB 요약 통계.
 */
export function collectBatchSchedulerDatabaseStats(
  db: Database.Database | null,
  logWarn: (message: string, err: unknown) => void
): BatchSchedulerDatabaseStats | Record<string, never> {
  if (!db) {
    return {};
  }

  try {
    const stats = db
      .prepare(
        `
        SELECT 
          type,
          COUNT(*) as count,
          COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_count,
          COUNT(CASE WHEN created_at < datetime('now', '-30 days') THEN 1 END) as old_count,
          AVG(importance) as avg_importance
        FROM memory_item 
        GROUP BY type
      `
      )
      .all() as MemoryItemTypeStatRow[];

    const totalMemories = db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
    const dbSize = db.prepare('PRAGMA page_count').get() as { page_count: number };
    const pageSize = db.prepare('PRAGMA page_size').get() as { page_size: number };

    return {
      memoryStats: stats,
      totalMemories: totalMemories.count,
      estimatedSize: dbSize.page_count * pageSize.page_size
    };
  } catch (error) {
    logWarn('Failed to collect database stats:', error);
    return {};
  }
}
