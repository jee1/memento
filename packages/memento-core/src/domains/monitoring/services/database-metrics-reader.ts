/**
 * SQLite database metrics reader and optimizer
 */

import Database from 'better-sqlite3';
import { logger } from '../../../shared/utils/logger.js';

export interface DatabaseMetricsSnapshot {
  totalMemories: number;
  memoryByType: Record<string, number>;
  averageMemorySize: number;
  databaseSize: number;
}

export class DatabaseMetricsReader {
  private db: Database.Database | null = null;

  setDatabase(db: Database.Database | null): void {
    this.db = db;
  }

  async getDatabaseMetrics(): Promise<DatabaseMetricsSnapshot> {
    if (!this.db) {
      return {
        totalMemories: 0,
        memoryByType: {},
        averageMemorySize: 0,
        databaseSize: 0
      };
    }

    try {
      const totalMemories = this.db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      const memoryByType = this.db.prepare(`
        SELECT type, COUNT(*) as count 
        FROM memory_item 
        GROUP BY type
      `).all() as { type: string; count: number }[];

      const typeMap: Record<string, number> = {};
      memoryByType.forEach(row => {
        typeMap[row.type] = row.count;
      });

      const averageSize = this.db.prepare(`
        SELECT AVG(LENGTH(content)) as avgSize 
        FROM memory_item
      `).get() as { avgSize: number };

      const dbSize = this.db.prepare('PRAGMA page_count').get() as { page_count: number };
      const pageSize = this.db.prepare('PRAGMA page_size').get() as { page_size: number };
      const databaseSize = dbSize.page_count * pageSize.page_size;

      return {
        totalMemories: totalMemories.count,
        memoryByType: typeMap,
        averageMemorySize: averageSize.avgSize || 0,
        databaseSize
      };
    } catch {
      return {
        totalMemories: 0,
        memoryByType: {},
        averageMemorySize: 0,
        databaseSize: 0
      };
    }
  }

  async optimizeDatabase(): Promise<void> {
    if (!this.db) return;

    try {
      // VACUUM 실행
      this.db.exec('VACUUM');
      logger.info('Database VACUUM completed');

      // ANALYZE 실행
      this.db.exec('ANALYZE');
      logger.info('Database ANALYZE completed');

      // WAL 체크포인트
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      logger.info('WAL checkpoint completed');

    } catch (error) {
      logger.error('Database optimization failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
