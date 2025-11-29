import { EventEmitter } from 'node:events';
import type {
  MigrationProgress,
  MigrationProgressEvent,
  MigrationProgressReporter,
  MigrationRunStatus
} from '../shared/types/migration.types.js';

/**
 * 마이그레이션 진행 상황을 브로드캐스트하는 서비스
 * - 런 ID별 최신 스냅샷을 캐시하고 구독자에게 실시간으로 전달
 */
class MigrationMonitorService implements MigrationProgressReporter {
  private readonly emitter = new EventEmitter();
  private readonly latestEvents = new Map<string, MigrationProgressEvent>();
  private readonly statuses = new Map<string, MigrationRunStatus>();
  private readonly allChannel = 'migration-progress';

  publish(event: MigrationProgressEvent): void {
    const clonedEvent = this.cloneEvent(event);
    this.latestEvents.set(event.runId, clonedEvent);
    this.statuses.set(event.runId, event.status);
    this.emitter.emit(this.channel(event.runId), clonedEvent);
    this.emitter.emit(this.allChannel, clonedEvent);
  }

  subscribe(runId: string, listener: (event: MigrationProgressEvent) => void): () => void {
    const channel = this.channel(runId);
    const handler = (event: MigrationProgressEvent): void => {
      listener(this.cloneEvent(event));
    };
    this.emitter.on(channel, handler);

    const latest = this.latestEvents.get(runId);
    if (latest) {
      listener(this.cloneEvent(latest));
    }

    return () => {
      this.emitter.off(channel, handler);
    };
  }

  subscribeAll(listener: (event: MigrationProgressEvent) => void): () => void {
    const handler = (event: MigrationProgressEvent): void => {
      listener(this.cloneEvent(event));
    };
    this.emitter.on(this.allChannel, handler);
    return () => {
      this.emitter.off(this.allChannel, handler);
    };
  }

  getLatest(runId: string): MigrationProgressEvent | undefined {
    const latest = this.latestEvents.get(runId);
    return latest ? this.cloneEvent(latest) : undefined;
  }

  getStatus(runId: string): MigrationRunStatus | undefined {
    return this.statuses.get(runId);
  }

  listActiveRuns(): string[] {
    return Array.from(this.statuses.entries())
      .filter(([, status]) => status === 'running')
      .map(([runId]) => runId);
  }

  clear(runId: string): void {
    this.latestEvents.delete(runId);
    this.statuses.delete(runId);
  }

  private channel(runId: string): string {
    return `migration-progress:${runId}`;
  }

  private cloneEvent(event: MigrationProgressEvent): MigrationProgressEvent {
    return {
      runId: event.runId,
      status: event.status,
      timestamp: new Date(event.timestamp),
      progress: this.cloneProgress(event.progress)
    };
  }

  private cloneProgress(progress: Readonly<MigrationProgress>): MigrationProgress {
    return {
      total: progress.total,
      processed: progress.processed,
      succeeded: progress.succeeded,
      failed: progress.failed,
      startedAt: new Date(progress.startedAt),
      updatedAt: new Date(progress.updatedAt),
      lastMemoryId: progress.lastMemoryId,
      currentStep: progress.currentStep
        ? {
            ...progress.currentStep,
            startedAt: progress.currentStep.startedAt ? new Date(progress.currentStep.startedAt) : undefined,
            completedAt: progress.currentStep.completedAt ? new Date(progress.currentStep.completedAt) : undefined
          }
        : undefined,
      stepHistory: progress.stepHistory.map(step => ({
        ...step,
        startedAt: step.startedAt ? new Date(step.startedAt) : undefined,
        completedAt: step.completedAt ? new Date(step.completedAt) : undefined
      }))
    };
  }
}

export const migrationMonitorService = new MigrationMonitorService();
