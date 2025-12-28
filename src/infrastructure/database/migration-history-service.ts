import type { Database } from 'better-sqlite3';
import type {
  EmbeddingMigrationPlan,
  MigrationHistoryFilter,
  MigrationHistoryPruneOptions,
  MigrationHistoryRecord,
  MigrationHistorySummary,
  MigrationResult,
  MigrationRollbackEntry
} from '../../shared/types/migration.types.js';
import { PIIMasker } from '../../shared/utils/pii-masker.js';

const DEFAULT_HISTORY_LIMIT = 50;

function normalizeDate(input: Date | string | undefined | null): Date | undefined {
  if (!input) {
    return undefined;
  }
  if (input instanceof Date) {
    return new Date(input);
  }
  return new Date(input);
}

class MigrationHistoryService {
  recordHistory(db: Database, plan: EmbeddingMigrationPlan, result: MigrationResult): number | undefined {
    try {
      const statement = db.prepare(
        `
        INSERT INTO migration_history (
          plan_provider_from,
          plan_provider_to,
          plan_target_dimensions,
          plan_projection_type,
          plan_normalization,
          plan_batch_size,
          plan_dry_run,
          plan_resume_from_id,
          plan_target_model,
          plan_created_by,
          start_time,
          end_time,
          processed,
          succeeded,
          failed,
          success,
          next_resume_from_id,
          error_count,
          errors_json,
          rollback_entries_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      );

      const serializedRollbacks =
        result.rollbackEntries.length > 0 || result.rolledBack
          ? JSON.stringify({ entries: result.rollbackEntries, rolledBack: result.rolledBack })
          : null;

      const runInfo = statement.run(
        plan.sourceProvider,
        plan.targetProvider,
        plan.targetDimensions,
        plan.projectionType,
        plan.normalization,
        plan.batchSize ?? 0,
        plan.dryRun ? 1 : 0,
        plan.resumeFromId ?? null,
        plan.targetModel ?? null,
        plan.createdBy ?? null,
        result.startTime.toISOString(),
        result.endTime.toISOString(),
        result.processed,
        result.succeeded,
        result.failed,
        result.success ? 1 : 0,
        result.nextResumeFromId ?? null,
        result.errors?.length ?? 0,
        result.errors ? JSON.stringify(result.errors) : null,
        serializedRollbacks
      );

      const record: MigrationHistoryRecord = {
        id: typeof runInfo.lastInsertRowid === 'bigint' ? Number(runInfo.lastInsertRowid) : runInfo.lastInsertRowid,
        plan,
        result,
        createdAt: result.endTime,
        errorCount: result.errors?.length ?? 0
      };

      this.logHistory(record);
      return record.id;
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.warn('⚠️ 마이그레이션 이력 기록 실패:', maskedError.message);
      return undefined;
    }
  }

  listHistory(db: Database, filter: MigrationHistoryFilter = {}): MigrationHistoryRecord[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filter.sourceProvider) {
      conditions.push('plan_provider_from = ?');
      params.push(filter.sourceProvider);
    }
    if (filter.targetProvider) {
      conditions.push('plan_provider_to = ?');
      params.push(filter.targetProvider);
    }
    if (filter.success !== undefined) {
      conditions.push('success = ?');
      params.push(filter.success ? 1 : 0);
    }
    if (filter.startDate) {
      conditions.push('end_time >= ?');
      params.push(filter.startDate.toISOString());
    }
    if (filter.endDate) {
      conditions.push('end_time <= ?');
      params.push(filter.endDate.toISOString());
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit && filter.limit > 0 ? filter.limit : DEFAULT_HISTORY_LIMIT;

    const rows = db
      .prepare(
        `
        SELECT
          id,
          plan_provider_from,
          plan_provider_to,
          plan_target_dimensions,
          plan_projection_type,
          plan_normalization,
          plan_batch_size,
          plan_dry_run,
          plan_resume_from_id,
          plan_target_model,
          plan_created_by,
          start_time,
          end_time,
          processed,
          succeeded,
          failed,
          success,
          next_resume_from_id,
          error_count,
          errors_json,
          rollback_entries_json,
          created_at
        FROM migration_history
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ?
      `
      )
      .all(...params, limit);

    const records = rows.map(row => this.mapRow(row));

    if (filter.rolledBack !== undefined) {
      return records.filter(record => record.result.rolledBack === filter.rolledBack);
    }

    return records;
  }

  getHistoryById(db: Database, id: number): MigrationHistoryRecord | undefined {
    const row = db
      .prepare(
        `
        SELECT
          id,
          plan_provider_from,
          plan_provider_to,
          plan_target_dimensions,
          plan_projection_type,
          plan_normalization,
          plan_batch_size,
          plan_dry_run,
          plan_resume_from_id,
          plan_target_model,
          plan_created_by,
          start_time,
          end_time,
          processed,
          succeeded,
          failed,
          success,
          next_resume_from_id,
          error_count,
          errors_json,
          rollback_entries_json,
          created_at
        FROM migration_history
        WHERE id = ?
      `
      )
      .get(id);

    return row ? this.mapRow(row) : undefined;
  }

  getSummary(db: Database, filter: MigrationHistoryFilter = {}): MigrationHistorySummary {
    const history = this.listHistory(db, {
      ...filter,
      limit: filter.limit ?? DEFAULT_HISTORY_LIMIT
    });

    const totalRuns = history.length;
    const succeeded = history.filter(record => record.result.success).length;
    const failed = totalRuns - succeeded;
    const rolledBack = history.filter(record => record.result.rolledBack).length;
    const lastRun = history[0];

    return {
      totalRuns,
      succeeded,
      failed,
      rolledBack,
      lastRunAt: lastRun?.result.endTime,
      lastRunStatus: lastRun ? (lastRun.result.success ? 'success' : 'failure') : undefined
    };
  }

  pruneHistory(db: Database, options: MigrationHistoryPruneOptions = {}): number {
    let deleted = 0;

    if (options.olderThanDays && options.olderThanDays > 0) {
      const cutoff = new Date(Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000).toISOString();
      const statement = db.prepare(
        `
        DELETE FROM migration_history
        WHERE created_at < ?
        ${options.successOnly ? 'AND success = 1' : ''}
      `
      );

      const info = statement.run(cutoff);
      deleted += info.changes ?? 0;
    }

    if (options.keepLatest !== undefined) {
      const keep = Math.max(0, options.keepLatest);
      const idsToKeepRows = db
        .prepare(
          `
          SELECT id
          FROM migration_history
          ORDER BY created_at DESC
          LIMIT ?
        `
        )
        .all(keep) as Array<{ id: number | bigint }>;

      const idsToKeep = idsToKeepRows.map(row => (typeof row.id === 'bigint' ? Number(row.id) : row.id));

      if (idsToKeep.length === 0 && keep === 0) {
        const info = db.prepare('DELETE FROM migration_history').run();
        deleted += info.changes ?? 0;
        return deleted;
      }

      if (idsToKeep.length > 0) {
        const placeholders = idsToKeep.map(() => '?').join(',');
        const statement = db.prepare(
          `
          DELETE FROM migration_history
          WHERE ${options.successOnly ? 'success = 1 AND ' : ''}id NOT IN (${placeholders})
        `
        );
        const info = statement.run(...idsToKeep);
        deleted += info.changes ?? 0;
      }
    }

    return deleted;
  }

  logHistory(record: MigrationHistoryRecord): void {
    const status = record.result.success ? 'SUCCESS' : 'FAILURE';
    const rolledBack = record.result.rolledBack ? ' (rolled back)' : '';
    const summary = `[Migration ${status}] ${record.plan.sourceProvider} -> ${record.plan.targetProvider}${rolledBack} | processed=${record.result.processed}, succeeded=${record.result.succeeded}, failed=${record.result.failed}`;
    console.info(summary);
  }

  private mapRow(row: any): MigrationHistoryRecord {
    let rollbackEntries: MigrationRollbackEntry[] = [];
    let rolledBack = false;

    if (row.rollback_entries_json) {
      try {
        const parsed = JSON.parse(row.rollback_entries_json);
        if (Array.isArray(parsed)) {
          rollbackEntries = parsed;
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.entries)) {
            rollbackEntries = parsed.entries;
          }
          if (typeof parsed.rolledBack === 'boolean') {
            rolledBack = parsed.rolledBack;
          }
        }
      } catch {
        // ignore malformed payloads
      }
    }

    return {
      id: typeof row.id === 'bigint' ? Number(row.id) : row.id,
      plan: {
        sourceProvider: row.plan_provider_from,
        targetProvider: row.plan_provider_to,
        targetDimensions: row.plan_target_dimensions,
        projectionType: row.plan_projection_type,
        normalization: row.plan_normalization,
        batchSize: row.plan_batch_size,
        dryRun: Boolean(row.plan_dry_run),
        resumeFromId: row.plan_resume_from_id ?? undefined,
        targetModel: row.plan_target_model ?? undefined,
        createdBy: row.plan_created_by ?? undefined
      },
      result: {
        success: Boolean(row.success),
        processed: row.processed,
        succeeded: row.succeeded,
        failed: row.failed,
        startTime: normalizeDate(row.start_time) ?? new Date(row.start_time),
        endTime: normalizeDate(row.end_time) ?? new Date(row.end_time),
        nextResumeFromId: row.next_resume_from_id ?? undefined,
        errors: row.errors_json ? JSON.parse(row.errors_json) : undefined,
        rollbackEntries,
        rolledBack
      },
      createdAt: normalizeDate(row.created_at) ?? new Date(row.created_at),
      errorCount: row.error_count ?? 0
    };
  }
}

export const migrationHistoryService = new MigrationHistoryService();
