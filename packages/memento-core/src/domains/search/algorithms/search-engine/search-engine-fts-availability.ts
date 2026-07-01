/**
 * FTS5·reflection_notes 가용성 및 Fallback
 */

import type Database from 'better-sqlite3';
import { mcpLogger } from '../../../../server/mcp-logger.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import { shouldUseFallback } from '../../../../shared/utils/fts5-migration-status.js';

export class SearchEngineFtsAvailability {
  private cachedFts5Availability = new WeakSet<Database.Database>();
  private cachedReflectionNotesAvailability = new WeakSet<Database.Database>();
  private emittedTestReflectionNotesConfigFallbackWarnings = new Set<string>();

  private isTestEnvironment(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  }

  logFallbackWarning(message: string, data?: Record<string, unknown>): void {
    mcpLogger.logServer('warn', message, data);
  }

  private logReflectionNotesConfigFallbackWarning(): void {
    const message = '설정으로 인해 reflection_notes Fallback 활성화';

    if (
      this.isTestEnvironment() &&
      this.emittedTestReflectionNotesConfigFallbackWarnings.has(message)
    ) {
      mcpLogger.logServer('info', message);
      return;
    }

    this.emittedTestReflectionNotesConfigFallbackWarnings.add(message);
    mcpLogger.logServer('warn', message);
  }

  invalidateFts5Cache(db: Database.Database): void {
    this.cachedFts5Availability.delete(db);
  }

  async checkFTS5Availability(db: Database.Database): Promise<boolean> {
    if (this.cachedFts5Availability.has(db)) {
      return true;
    }

    try {
      const result = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_item_fts'
      `).get();

      if (!result) {
        this.logFallbackWarning('FTS5 테이블이 존재하지 않음, 기본 검색으로 전환');
        return false;
      }

      const row = db.prepare('SELECT COUNT(*) as count FROM memory_item_fts').get() as { count: number } | undefined;
      const hasData = row != null && Number(row.count) > 0;

      if (!hasData) {
        this.logFallbackWarning('FTS5 테이블에 데이터가 없음, 기본 검색으로 전환');
        return false;
      }

      try {
        db.prepare('SELECT * FROM memory_item_fts LIMIT 1').get();
        mcpLogger.logServer('info', 'FTS5 사용 가능');
        this.cachedFts5Availability.add(db);
        return true;
      } catch (ftsError) {
        this.logFallbackWarning('FTS5 쿼리 실패, 기본 검색으로 전환', {
          error: ftsError instanceof Error ? ftsError.message : String(ftsError)
        });
        return false;
      }
    } catch (error) {
      this.logFallbackWarning('FTS5 사용 불가능, 기본 검색으로 전환', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  checkReflectionNotesAvailability(db: Database.Database): boolean {
    if (process.env.MEMENTO_FTS5_FALLBACK_ENABLED === 'true') {
      this.logReflectionNotesConfigFallbackWarning();
      return false;
    }
    if (mementoConfig.fts5FallbackEnabled) {
      this.logReflectionNotesConfigFallbackWarning();
      return false;
    }

    if (shouldUseFallback(db)) {
      this.logFallbackWarning('마이그레이션 상태로 인해 reflection_notes Fallback 사용');
      return false;
    }

    if (this.cachedReflectionNotesAvailability.has(db)) {
      return true;
    }

    try {
      const tableInfo = db.prepare(`
        SELECT sql FROM sqlite_master 
        WHERE type='table' AND name='memory_item_fts'
      `).get() as { sql: string } | undefined;

      if (!tableInfo) {
        return false;
      }

      const hasReflectionNotes = tableInfo.sql.includes('reflection_notes');

      if (!hasReflectionNotes) {
        this.logFallbackWarning('FTS5 테이블에 reflection_notes 컬럼이 없음, Fallback 사용');
        return false;
      }

      this.cachedReflectionNotesAvailability.add(db);
      return true;
    } catch (error) {
      this.logFallbackWarning('reflection_notes 컬럼 확인 실패, Fallback 사용', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  buildReflectionNotesSearchCondition(db: Database.Database, searchQuery: string): string | null {
    const canUseFTS5 = this.checkReflectionNotesAvailability(db);

    if (canUseFTS5) {
      return null;
    }

    const _likeQuery = `%${searchQuery}%`;
    return `m.reflection_notes LIKE ?`;
  }
}
