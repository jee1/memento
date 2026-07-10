import type { Database } from 'better-sqlite3';

import { migrationHistoryService } from '../../../infrastructure/database/migration-history-service.js';
import type { EmbeddingProvider, ProjectionType, VectorNormalization } from '../../../shared/types/embedding.types.js';
import type {
  EmbeddingMigrationError,
  EmbeddingMigrationPlan,
  EmbeddingMigrationTarget,
  MigrationHistoryRecord,
  MigrationMonitorOptions,
  MigrationProgress,
  MigrationResult,
  MigrationRollbackEntry,
} from '../../../shared/types/migration.types.js';
import {
  finalizeMigrationExecution,
  processMigrationRow,
  runMigrationBatchLoop,
} from './embedding-migration-service/migration-execution.js';
import {
  beginStep,
  completeStep,
  initializeProgress,
  notifyProgress,
  resolveEffectiveMonitor,
} from './embedding-migration-service/migration-progress.js';
import { rollback } from './embedding-migration-service/migration-rollback.js';
import { DEFAULT_BATCH_SIZE, DEFAULT_CREATED_BY, type RawEmbeddingRow } from './embedding-migration-service/types.js';
import { vectorCompatibilityService } from './vector-compatibility-service.js';

/**
 * 임베딩 마이그레이션 서비스
 * - 기존 임베딩 벡터를 목표 제공자의 차원에 맞게 재투영
 * - 마이그레이션 플랜/실행/진행 상태 관리
 */
export class EmbeddingMigrationService {
  createPlan(
    sourceProvider: EmbeddingProvider,
    targetProvider: EmbeddingProvider,
    overrides: Partial<EmbeddingMigrationPlan> = {}
  ): EmbeddingMigrationPlan {
    const {
      sourceProvider: _ignoredSource,
      targetProvider: _ignoredTarget,
      targetDimensions: overrideDimensions,
      projectionType: overrideProjection,
      normalization: overrideNormalization,
      batchSize: overrideBatch,
      dryRun,
      resumeFromId,
      targetModel,
      createdBy,
      autoRollbackOnFailure,
    } = overrides;

    const targetDimensions =
      overrideDimensions ?? vectorCompatibilityService.getNativeDimensions(targetProvider);

    return {
      sourceProvider,
      targetProvider,
      targetDimensions,
      projectionType: overrideProjection ?? 'native',
      normalization: overrideNormalization ?? 'none',
      targetModel: targetModel ?? `compat-${targetProvider}`,
      createdBy: createdBy ?? DEFAULT_CREATED_BY,
      batchSize: overrideBatch ?? DEFAULT_BATCH_SIZE,
      dryRun: dryRun ?? false,
      resumeFromId,
      autoRollbackOnFailure: autoRollbackOnFailure ?? true,
    };
  }

  listTargets(db: Database, plan: EmbeddingMigrationPlan, limit?: number): EmbeddingMigrationTarget[] {
    const effectiveLimit = limit ?? plan.batchSize ?? DEFAULT_BATCH_SIZE;
    const resumeKey = plan.resumeFromId ?? null;

    const rows = db
      .prepare(
        `
        SELECT memory_id, embedding_provider, projection_type, dimensions, model
        FROM memory_embedding
        WHERE embedding_provider = ?
          AND (? IS NULL OR memory_id > ?)
        ORDER BY memory_id
        LIMIT ?
      `
      )
      .all(plan.sourceProvider, resumeKey, resumeKey, effectiveLimit) as Array<{
        memory_id: string;
        embedding_provider: EmbeddingProvider;
        projection_type: ProjectionType | null;
        dimensions: number | null;
        model: string | null;
      }>;

    return rows.map(row => ({
      memoryId: row.memory_id,
      currentProvider: row.embedding_provider,
      currentProjection: (row.projection_type ?? 'native') as ProjectionType,
      currentDimensions: row.dimensions ?? 0,
      currentModel: row.model,
      targetProvider: plan.targetProvider,
      targetProjection: plan.projectionType,
      targetDimensions: plan.targetDimensions,
      needsReprojection:
        (row.dimensions ?? 0) !== plan.targetDimensions || row.projection_type !== plan.projectionType,
      needsProviderSwitch: row.embedding_provider !== plan.targetProvider,
    }));
  }

  initializeProgress(total: number, resumeFromId?: string): MigrationProgress {
    return initializeProgress(total, resumeFromId);
  }

  async execute(
    db: Database,
    plan: EmbeddingMigrationPlan,
    monitor: MigrationMonitorOptions = {}
  ): Promise<MigrationResult> {
    const effectiveMonitor = resolveEffectiveMonitor(monitor);

    const totalRow = db
      .prepare('SELECT COUNT(*) AS count FROM memory_embedding WHERE embedding_provider = ?')
      .get(plan.sourceProvider) as { count: number } | undefined;

    const total = totalRow?.count ?? 0;
    const progress = this.initializeProgress(total, plan.resumeFromId);
    const errors: EmbeddingMigrationError[] = [];
    const rollbackEntries: MigrationRollbackEntry[] = [];
    const reportEvery =
      effectiveMonitor.reportEvery && effectiveMonitor.reportEvery > 0
        ? effectiveMonitor.reportEvery
        : Math.max(1, Math.floor((plan.batchSize ?? DEFAULT_BATCH_SIZE) / 2));
    const step = beginStep(
      progress,
      effectiveMonitor.stepDescription ?? 'Embedding vector migration'
    );

    notifyProgress(progress, effectiveMonitor);

    if (total === 0) {
      const now = new Date();
      completeStep(progress, step, 'completed');
      notifyProgress(progress, effectiveMonitor);
      return {
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        startTime: now,
        endTime: now,
        nextResumeFromId: plan.resumeFromId ?? undefined,
        rollbackEntries: [],
        rolledBack: false,
      };
    }

    const selectStatement = db.prepare(
      `
      SELECT memory_id, embedding, model, embedding_provider, projection_type, dim, dimensions, created_at
      FROM memory_embedding
      WHERE embedding_provider = ?
        AND (? IS NULL OR memory_id > ?)
      ORDER BY memory_id
      LIMIT ?
    `
    );

    const upsertStatement = db.prepare(
      `
      INSERT INTO memory_embedding (
        memory_id,
        embedding_provider,
        projection_type,
        embedding,
        dim,
        model,
        dimensions,
        precision,
        normalized,
        version,
        created_by,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(memory_id, embedding_provider, projection_type) DO UPDATE SET
        embedding = excluded.embedding,
        dim = excluded.dim,
        model = excluded.model,
        dimensions = excluded.dimensions,
        precision = excluded.precision,
        normalized = excluded.normalized,
        version = excluded.version,
        created_by = excluded.created_by,
        created_at = CURRENT_TIMESTAMP
    `
    );

    const normalizationMode: VectorNormalization = plan.normalization ?? 'none';
    const existingStatement = db.prepare(
      `
      SELECT embedding, dim, model, dimensions, precision, normalized, version, created_by, created_at
      FROM memory_embedding
      WHERE memory_id = ? AND embedding_provider = ? AND projection_type = ?
    `
    );

    const processBatch = (batch: RawEmbeddingRow[]): void => {
      for (const row of batch) {
        processMigrationRow({
          row,
          plan,
          normalizationMode,
          existingStatement,
          upsertStatement,
          progress,
          errors,
          rollbackEntries,
          reportEvery,
          effectiveMonitor,
        });
      }
    };

    runMigrationBatchLoop(
      plan,
      selectStatement,
      progress,
      plan.resumeFromId ?? null,
      processBatch,
      effectiveMonitor
    );

    return finalizeMigrationExecution({
      db,
      plan,
      progress,
      step,
      errors,
      rollbackEntries,
      effectiveMonitor,
    });
  }

  rollback(db: Database, entries: ReadonlyArray<MigrationRollbackEntry>): void {
    rollback(db, entries);
  }

  listHistory(db: Database, limit: number = 20): MigrationHistoryRecord[] {
    return migrationHistoryService.listHistory(db, { limit });
  }
}

export const embeddingMigrationService = new EmbeddingMigrationService();
