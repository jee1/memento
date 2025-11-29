import type { Database } from 'better-sqlite3';
import type { EmbeddingProvider, ProjectionType, VectorNormalization } from '../../../../shared/types/embedding.types.js';
import type {
  EmbeddingMigrationError,
  EmbeddingMigrationPlan,
  EmbeddingMigrationTarget,
  MigrationHistoryRecord,
  MigrationMonitorOptions,
  MigrationProgress,
  MigrationProgressHandler,
  MigrationRollbackEntry,
  MigrationResult,
  MigrationRunStatus,
  MigrationStep,
  MigrationStepStatus
} from '../../../../shared/types/migration.types.js';
import { migrationMonitorService } from '../../../infrastructure/database/migration-monitor-service.js';
import { migrationHistoryService } from '../../../infrastructure/database/migration-history-service.js';
import { vectorCompatibilityService } from './vector-compatibility-service.js';

interface RawEmbeddingRow {
  memory_id: string;
  embedding: string;
  model: string | null;
  embedding_provider: EmbeddingProvider;
  projection_type: ProjectionType;
  dim: number;
  dimensions: number;
  created_at: string;
}

interface ExistingEmbeddingRow {
  embedding: string;
  dim: number;
  model: string | null;
  dimensions: number;
  precision: number;
  normalized: number;
  version: number;
  created_by: string | null;
  created_at: string | null;
}

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_CREATED_BY = 'embedding_migration_service';

/**
 * 임베딩 마이그레이션 서비스
 * - 기존 임베딩 벡터를 목표 제공자의 차원에 맞게 재투영
 * - 마이그레이션 플랜/실행/진행 상태 관리
 */
export class EmbeddingMigrationService {
  private createSnapshot(progress: MigrationProgress): MigrationProgress {
    return {
      ...progress,
      stepHistory: progress.stepHistory.map(step => ({ ...step })),
      currentStep: progress.currentStep ? { ...progress.currentStep } : undefined
    };
  }

  private resolveRunStatus(progress: MigrationProgress): MigrationRunStatus {
    const finished =
      !progress.currentStep && (progress.total === 0 || progress.processed >= progress.total);
    if (finished) {
      return progress.failed > 0 ? 'failed' : 'completed';
    }
    return 'running';
  }

  private notifyProgress(progress: MigrationProgress, monitor: MigrationMonitorOptions): void {
    if (!monitor.onProgress && !(monitor.reporter && monitor.runId)) {
      return;
    }

    const snapshot = Object.freeze(this.createSnapshot(progress));

    if (monitor.onProgress) {
      monitor.onProgress(snapshot);
    }

    if (monitor.reporter && monitor.runId) {
      monitor.reporter.publish({
        runId: monitor.runId,
        progress: snapshot,
        status: this.resolveRunStatus(progress),
        timestamp: new Date()
      });
    }
  }

  private beginStep(progress: MigrationProgress, description: string): MigrationStep {
    const step: MigrationStep = {
      id: `step-${progress.stepHistory.length + 1}`,
      description,
      status: 'running',
      startedAt: new Date()
    };
    progress.currentStep = step;
    progress.stepHistory.push(step);
    return step;
  }

  private completeStep(
    progress: MigrationProgress,
    step: MigrationStep,
    status: MigrationStepStatus,
    error?: string
  ): void {
    step.status = status;
    step.completedAt = new Date();
    if (error) {
      step.error = error;
    }
    progress.currentStep = undefined;
  }

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
      autoRollbackOnFailure
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
      autoRollbackOnFailure: autoRollbackOnFailure ?? true
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
      needsProviderSwitch: row.embedding_provider !== plan.targetProvider
    }));
  }

  initializeProgress(total: number, resumeFromId?: string): MigrationProgress {
    const now = new Date();
    return {
      total,
      processed: 0,
      succeeded: 0,
      failed: 0,
      startedAt: now,
      updatedAt: now,
      lastMemoryId: resumeFromId,
      stepHistory: []
    };
  }

  async execute(
    db: Database,
    plan: EmbeddingMigrationPlan,
    monitor: MigrationMonitorOptions = {}
  ): Promise<MigrationResult> {
    const effectiveMonitor: MigrationMonitorOptions =
      monitor.runId && !monitor.reporter
        ? { ...monitor, reporter: migrationMonitorService }
        : monitor;

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
    const step = this.beginStep(
      progress,
      effectiveMonitor.stepDescription ?? 'Embedding vector migration'
    );

    this.notifyProgress(progress, effectiveMonitor);

    if (total === 0) {
      const now = new Date();
      this.completeStep(progress, step, 'completed');
      this.notifyProgress(progress, effectiveMonitor);
      return {
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        startTime: now,
        endTime: now,
        nextResumeFromId: plan.resumeFromId ?? undefined,
        rollbackEntries: [],
        rolledBack: false
      };
    }

    let lastProcessedId = plan.resumeFromId ?? null;

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
        progress.processed += 1;
        progress.lastMemoryId = row.memory_id;

        try {
          const parsed = this.safeParseEmbedding(row.embedding);
          const assessment = vectorCompatibilityService.assessProviderCompatibility(parsed, plan.targetProvider, {
            targetDimensions: plan.targetDimensions,
            normalization: normalizationMode
          });

          const storedVector = assessment.projection.vector;
          const serialized = JSON.stringify(storedVector);
          const projectionType = assessment.projection.projectionType;
          const normalizedFlag = assessment.projection.normalized ? 1 : 0;
          const targetModel = plan.targetModel ?? row.model ?? `compat-${plan.targetProvider}`;
          const createdBy = plan.createdBy ?? DEFAULT_CREATED_BY;

          if (!plan.dryRun) {
            const existing = existingStatement.get(
              row.memory_id,
              plan.targetProvider,
              projectionType
            ) as ExistingEmbeddingRow | undefined;

            upsertStatement.run(
              row.memory_id,
              plan.targetProvider,
              projectionType,
              serialized,
              plan.targetDimensions,
              targetModel,
              plan.targetDimensions,
              32,
              normalizedFlag,
              1,
              createdBy
            );

            if (existing) {
              rollbackEntries.push({
                memoryId: row.memory_id,
                provider: plan.targetProvider,
                projectionType,
                operation: 'restore',
                embedding: existing.embedding,
                dim: existing.dim,
                dimensions: existing.dimensions,
                model: existing.model,
                precision: existing.precision,
                normalized: existing.normalized,
                version: existing.version,
                createdBy: existing.created_by,
                createdAt: existing.created_at ?? undefined
              });
            } else {
              rollbackEntries.push({
                memoryId: row.memory_id,
                provider: plan.targetProvider,
                projectionType,
                operation: 'delete'
              });
            }
          }

          progress.succeeded += 1;
        } catch (error) {
          progress.failed += 1;
          errors.push({
            memoryId: row.memory_id,
            provider: plan.targetProvider,
            message: error instanceof Error ? error.message : 'Unknown error'
          });
        } finally {
          progress.updatedAt = new Date();
          if (reportEvery > 0 && progress.processed % reportEvery === 0) {
            this.notifyProgress(progress, effectiveMonitor);
          }
        }
      }
    };

    while (true) {
      const batch = selectStatement.all(
        plan.sourceProvider,
        lastProcessedId,
        lastProcessedId,
        plan.batchSize ?? DEFAULT_BATCH_SIZE
      ) as RawEmbeddingRow[];
      if (!batch.length) {
        break;
      }

      processBatch(batch);
      lastProcessedId = batch[batch.length - 1]?.memory_id ?? lastProcessedId;
      this.notifyProgress(progress, effectiveMonitor);
    }

    const endTime = new Date();
    const success = progress.failed === 0;
    let rolledBack = false;
    this.completeStep(progress, step, success ? 'completed' : 'failed', success ? undefined : 'One or more records failed');
    this.notifyProgress(progress, effectiveMonitor);

    const shouldRollback = !success && !plan.dryRun && (plan.autoRollbackOnFailure ?? true);

    if (shouldRollback) {
      try {
        this.rollback(db, rollbackEntries);
        rolledBack = true;
      } catch (error) {
        const message =
          error instanceof Error ? `자동 롤백 실패: ${error.message}` : '자동 롤백 중 알 수 없는 오류가 발생했습니다';
        errors.push({
          memoryId: '*',
          provider: plan.targetProvider,
          message
        });
      }
    }

    const result: MigrationResult = {
      success,
      processed: progress.processed,
      succeeded: progress.succeeded,
      failed: progress.failed,
      startTime: progress.startedAt,
      endTime,
      nextResumeFromId: progress.lastMemoryId,
      errors: errors.length > 0 ? errors : undefined,
      rollbackEntries,
      rolledBack
    };

    if (!plan.dryRun) {
      migrationHistoryService.recordHistory(db, plan, result);
    }

    return result;
  }

  private safeParseEmbedding(raw: string): number[] {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('임베딩 데이터가 배열 형식이 아닙니다');
      }
      return parsed.map(value => (Number.isFinite(value) ? value : 0));
    } catch (error) {
      throw new Error(
        error instanceof Error ? `임베딩 벡터 파싱 실패: ${error.message}` : '임베딩 벡터 파싱 실패'
      );
    }
  }

  rollback(db: Database, entries: ReadonlyArray<MigrationRollbackEntry>): void {
    if (!entries.length) {
      return;
    }

    const deleteStatement = db.prepare(
      `DELETE FROM memory_embedding WHERE memory_id = ? AND embedding_provider = ? AND projection_type = ?`
    );

    const restoreStatement = db.prepare(
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, embedding_provider, projection_type) DO UPDATE SET
        embedding = excluded.embedding,
        dim = excluded.dim,
        model = excluded.model,
        dimensions = excluded.dimensions,
        precision = excluded.precision,
        normalized = excluded.normalized,
        version = excluded.version,
        created_by = excluded.created_by,
        created_at = excluded.created_at
    `
    );

    for (const entry of [...entries].reverse()) {
      if (entry.operation === 'delete') {
        deleteStatement.run(entry.memoryId, entry.provider, entry.projectionType);
      } else {
        if (!entry.embedding) {
          throw new Error(`Rollback 데이터가 누락되었습니다: ${entry.memoryId}`);
        }
        restoreStatement.run(
          entry.memoryId,
          entry.provider,
          entry.projectionType,
          entry.embedding,
          entry.dim ?? entry.dimensions ?? 0,
          entry.model ?? null,
          entry.dimensions ?? entry.dim ?? 0,
          entry.precision ?? 32,
          entry.normalized ?? 0,
          entry.version ?? 1,
          entry.createdBy ?? DEFAULT_CREATED_BY,
          entry.createdAt ?? new Date().toISOString()
        );
      }
    }
  }

  listHistory(db: Database, limit: number = 20): MigrationHistoryRecord[] {
    return migrationHistoryService.listHistory(db, { limit });
  }
}

export const embeddingMigrationService = new EmbeddingMigrationService();
