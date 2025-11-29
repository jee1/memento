/**
 * 마이그레이션 도메인 공통 타입 정의
 * - 임베딩 벡터 재투영 작업 단위를 표현
 */

import type { EmbeddingProvider, ProjectionType, VectorNormalization } from './embedding.types.js';

export type MigrationStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface MigrationStep {
  id: string;
  description: string;
  status: MigrationStepStatus;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface EmbeddingMigrationTarget {
  memoryId: string;
  currentProvider: EmbeddingProvider;
  currentProjection: ProjectionType;
  currentDimensions: number;
  currentModel?: string | null;
  targetProvider: EmbeddingProvider;
  targetProjection: ProjectionType;
  targetDimensions: number;
  needsReprojection: boolean;
  needsProviderSwitch: boolean;
}

export interface MigrationProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: Date;
  updatedAt: Date;
  lastMemoryId?: string;
  currentStep?: MigrationStep;
  stepHistory: MigrationStep[];
}

export interface MigrationResult {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  startTime: Date;
  endTime: Date;
  nextResumeFromId?: string;
  errors?: EmbeddingMigrationError[];
  rollbackEntries: MigrationRollbackEntry[];
  rolledBack: boolean;
}

export interface EmbeddingMigrationPlan {
  sourceProvider: EmbeddingProvider;
  targetProvider: EmbeddingProvider;
  targetDimensions: number;
  projectionType: ProjectionType;
  normalization: VectorNormalization;
  targetModel?: string;
  createdBy?: string;
  batchSize: number;
  dryRun?: boolean;
  resumeFromId?: string;
  autoRollbackOnFailure?: boolean;
}

export interface EmbeddingMigrationError {
  memoryId: string;
  provider: EmbeddingProvider;
  message: string;
}

export type MigrationProgressHandler = (snapshot: Readonly<MigrationProgress>) => void;

export interface MigrationMonitorOptions {
  onProgress?: MigrationProgressHandler;
  reportEvery?: number;
  stepDescription?: string;
  runId?: string;
  reporter?: MigrationProgressReporter;
}

export type MigrationRollbackOperation = 'delete' | 'restore';

export interface MigrationRollbackEntry {
  memoryId: string;
  provider: EmbeddingProvider;
  projectionType: ProjectionType;
  operation: MigrationRollbackOperation;
  embedding?: string;
  dim?: number;
  dimensions?: number;
  model?: string | null;
  precision?: number;
  normalized?: number;
  version?: number;
  createdBy?: string | null;
  createdAt?: string;
}

export interface MigrationHistoryRecord {
  id?: number;
  plan: EmbeddingMigrationPlan;
  result: MigrationResult;
  createdAt: Date;
  errorCount: number;
}

export type MigrationRunStatus = 'running' | 'completed' | 'failed';

export interface MigrationProgressEvent {
  runId: string;
  progress: Readonly<MigrationProgress>;
  status: MigrationRunStatus;
  timestamp: Date;
}

export interface MigrationProgressReporter {
  publish(event: MigrationProgressEvent): void;
}

export interface MigrationHistoryFilter {
  sourceProvider?: EmbeddingProvider;
  targetProvider?: EmbeddingProvider;
  success?: boolean;
  rolledBack?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

export interface MigrationHistorySummary {
  totalRuns: number;
  succeeded: number;
  failed: number;
  rolledBack: number;
  lastRunAt?: Date;
  lastRunStatus?: 'success' | 'failure';
}

export interface MigrationHistoryPruneOptions {
  keepLatest?: number;
  olderThanDays?: number;
  successOnly?: boolean;
}
