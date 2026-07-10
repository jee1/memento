import { migrationMonitorService } from '../../../../infrastructure/database/migration-monitor-service.js';
import type {
  MigrationMonitorOptions,
  MigrationProgress,
  MigrationRunStatus,
  MigrationStep,
  MigrationStepStatus,
} from '../../../../shared/types/migration.types.js';

export function createSnapshot(progress: MigrationProgress): MigrationProgress {
  return {
    ...progress,
    stepHistory: progress.stepHistory.map(step => ({ ...step })),
    currentStep: progress.currentStep ? { ...progress.currentStep } : undefined,
  };
}

export function resolveRunStatus(progress: MigrationProgress): MigrationRunStatus {
  const finished =
    !progress.currentStep && (progress.total === 0 || progress.processed >= progress.total);
  if (finished) {
    return progress.failed > 0 ? 'failed' : 'completed';
  }
  return 'running';
}

export function notifyProgress(progress: MigrationProgress, monitor: MigrationMonitorOptions): void {
  if (!monitor.onProgress && !(monitor.reporter && monitor.runId)) {
    return;
  }

  const snapshot = Object.freeze(createSnapshot(progress));

  if (monitor.onProgress) {
    monitor.onProgress(snapshot);
  }

  if (monitor.reporter && monitor.runId) {
    monitor.reporter.publish({
      runId: monitor.runId,
      progress: snapshot,
      status: resolveRunStatus(progress),
      timestamp: new Date(),
    });
  }
}

export function beginStep(progress: MigrationProgress, description: string): MigrationStep {
  const step: MigrationStep = {
    id: `step-${progress.stepHistory.length + 1}`,
    description,
    status: 'running',
    startedAt: new Date(),
  };
  progress.currentStep = step;
  progress.stepHistory.push(step);
  return step;
}

export function completeStep(
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

export function initializeProgress(total: number, resumeFromId?: string): MigrationProgress {
  const now = new Date();
  return {
    total,
    processed: 0,
    succeeded: 0,
    failed: 0,
    startedAt: now,
    updatedAt: now,
    lastMemoryId: resumeFromId,
    stepHistory: [],
  };
}

export function resolveEffectiveMonitor(monitor: MigrationMonitorOptions): MigrationMonitorOptions {
  return monitor.runId && !monitor.reporter
    ? { ...monitor, reporter: migrationMonitorService }
    : monitor;
}
