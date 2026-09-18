/**
 * Migration: 047 — normalize memory_item timestamp format to ISO-8601 UTC
 * Version: 47.0
 * Issue #1007
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../../../shared/utils/logger.js';
import { normalizeReflectionNotes } from '../../../../../shared/utils/reflection-notes-normalize.js';
import type { Migration } from '../types.js';

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function registerNormalizeFunction(db: Database.Database): void {
  try {
    db.function(
      'normalize_reflection_notes',
      {
        deterministic: true,
        varargs: false,
      },
      (reflectionNotes: string | null) => {
        return normalizeReflectionNotes(reflectionNotes);
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('active statements')) {
      return;
    }
    throw error;
  }
}

export class NormalizeTimestampFormatMigration implements Migration {
  version = '47.0';
  name = 'normalize-timestamp-format';
  description =
    'Normalize memory_item.created_at and last_accessed_at to ISO-8601 UTC format (#1007)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_item')) {
      throw new Error('Migration 047 requires memory_item table');
    }
  }

  async up(db: Database.Database): Promise<void> {
    registerNormalizeFunction(db);

    const createdResult = db
      .prepare(
        `
      UPDATE memory_item
         SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
       WHERE created_at LIKE '% %'
         AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL
    `,
      )
      .run();
    logger.info('normalize-timestamp-format: created_at rows updated', {
      changes: createdResult.changes,
    });

    const lastAccessedResult = db
      .prepare(
        `
      UPDATE memory_item
         SET last_accessed_at = strftime('%Y-%m-%dT%H:%M:%fZ', last_accessed_at)
       WHERE last_accessed_at LIKE '% %'
         AND strftime('%Y-%m-%dT%H:%M:%fZ', last_accessed_at) IS NOT NULL
    `,
      )
      .run();
    logger.info('normalize-timestamp-format: last_accessed_at rows updated', {
      changes: lastAccessedResult.changes,
    });
  }

  async down(db: Database.Database): Promise<void> {
    // 데이터 정규화는 되돌릴 수 없다 — 변환 후에는 원래 공백 형식이던 행을 식별할 방법이 없다.
    if (tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const spaceCreated = (
      db.prepare(`SELECT count(*) as c FROM memory_item WHERE created_at LIKE '% %'`).get() as {
        c: number;
      }
    ).c;
    if (spaceCreated !== 0) {
      throw new Error(
        `Migration 047: ${spaceCreated} memory_item rows still have space-format created_at`,
      );
    }

    const spaceLastAccessed = (
      db
        .prepare(`SELECT count(*) as c FROM memory_item WHERE last_accessed_at LIKE '% %'`)
        .get() as { c: number }
    ).c;
    if (spaceLastAccessed !== 0) {
      throw new Error(
        `Migration 047: ${spaceLastAccessed} memory_item rows still have space-format last_accessed_at`,
      );
    }
  }
}

export default NormalizeTimestampFormatMigration;
