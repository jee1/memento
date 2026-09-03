import type { Database, Statement } from 'better-sqlite3';

import { migrationHistoryService } from '../../../../infrastructure/database/migration-history-service.js';
import type { VectorNormalization } from '../../../../shared/types/embedding.types.js';
import type {
  EmbeddingMigrationError,
  EmbeddingMigrationPlan,
  MigrationMonitorOptions,
  MigrationProgress,
  MigrationResult,
  MigrationRollbackEntry,
  MigrationStep,
} from '../../../../shared/types/migration.types.js';
import {
  computeL2Norm,
  embeddingColumnToNumbers,
  encodeFloat32Embedding,
  shouldNormalizeFlag,
} from '../../../../shared/utils/embedding-serialization.js';
import { vectorCompatibilityService } from '../vector-compatibility-service.js';
import { completeStep, notifyProgress } from './migration-progress.js';
import { rollback } from './migration-rollback.js';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_CREATED_BY,
  type ExistingEmbeddingRow,
  type RawEmbeddingRow,
} from './types.js';

/** Post-cutover (#809): memory_embedding.embedding is Float32 BLOB only. */
export function safeParseEmbedding(raw: unknown): number[] {
  const parsed = embeddingColumnToNumbers(raw);
  if (!parsed) {
    throw new Error('임베딩 벡터 파싱 실패: invalid or empty Float32 BLOB');
  }
  return parsed;
}

export function processMigrationRow(params: {
  row: RawEmbeddingRow;
  plan: EmbeddingMigrationPlan;
  normalizationMode: VectorNormalization;
  existingStatement: Statement;
  upsertStatement: Statement;
  progress: MigrationProgress;
  errors: EmbeddingMigrationError[];
  rollbackEntries: MigrationRollbackEntry[];
  reportEvery: number;
  effectiveMonitor: MigrationMonitorOptions;
}): void {
  const {
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
  } = params;

  progress.processed += 1;
  progress.lastMemoryId = row.memory_id;

  try {
    const parsed = safeParseEmbedding(row.embedding);
    const assessment = vectorCompatibilityService.assessProviderCompatibility(parsed, plan.targetProvider, {
      targetDimensions: plan.targetDimensions,
      normalization: normalizationMode,
    });

    const storedVector = assessment.projection.vector;
    const serialized = encodeFloat32Embedding(storedVector);
    const projectionType = assessment.projection.projectionType;
    const normalizedFlag = shouldNormalizeFlag(computeL2Norm(storedVector));
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
          createdAt: existing.created_at ?? undefined,
        });
      } else {
        rollbackEntries.push({
          memoryId: row.memory_id,
          provider: plan.targetProvider,
          projectionType,
          operation: 'delete',
        });
      }
    }

    progress.succeeded += 1;
  } catch (error) {
    progress.failed += 1;
    errors.push({
      memoryId: row.memory_id,
      provider: plan.targetProvider,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    progress.updatedAt = new Date();
    if (reportEvery > 0 && progress.processed % reportEvery === 0) {
      notifyProgress(progress, effectiveMonitor);
    }
  }
}

export function runMigrationBatchLoop(
  plan: EmbeddingMigrationPlan,
  selectStatement: Statement,
  progress: MigrationProgress,
  initialLastId: string | null,
  processBatch: (batch: RawEmbeddingRow[]) => void,
  effectiveMonitor: MigrationMonitorOptions
): void {
  let lastProcessedId = initialLastId;
  for (;;) {
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
    notifyProgress(progress, effectiveMonitor);
  }
}

export function finalizeMigrationExecution(params: {
  db: Database;
  plan: EmbeddingMigrationPlan;
  progress: MigrationProgress;
  step: MigrationStep;
  errors: EmbeddingMigrationError[];
  rollbackEntries: MigrationRollbackEntry[];
  effectiveMonitor: MigrationMonitorOptions;
}): MigrationResult {
  const { db, plan, progress, step, errors, rollbackEntries, effectiveMonitor } = params;

  const endTime = new Date();
  const success = progress.failed === 0;
  let rolledBack = false;
  completeStep(progress, step, success ? 'completed' : 'failed', success ? undefined : 'One or more records failed');
  notifyProgress(progress, effectiveMonitor);

  const shouldRollback = !success && !plan.dryRun && (plan.autoRollbackOnFailure ?? true);

  if (shouldRollback) {
    try {
      rollback(db, rollbackEntries);
      rolledBack = true;
    } catch (error) {
      const message =
        error instanceof Error ? `자동 롤백 실패: ${error.message}` : '자동 롤백 중 알 수 없는 오류가 발생했습니다';
      errors.push({
        memoryId: '*',
        provider: plan.targetProvider,
        message,
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
    rolledBack,
  };

  if (!plan.dryRun) {
    migrationHistoryService.recordHistory(db, plan, result);
  }

  return result;
}
