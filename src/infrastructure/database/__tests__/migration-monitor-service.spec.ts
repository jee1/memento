import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrationMonitorService } from '../migration-monitor-service.js';
import type { MigrationProgress } from '../../shared/types/migration.types.js';

describe('migrationMonitorService', () => {
  const runId = 'test-run';

  beforeEach(() => {
    migrationMonitorService.clear(runId);
  });

  afterEach(() => {
    migrationMonitorService.clear(runId);
  });

  function createProgress(partial?: Partial<MigrationProgress>): MigrationProgress {
    const base: MigrationProgress = {
      total: 10,
      processed: 0,
      succeeded: 0,
      failed: 0,
      startedAt: new Date(),
      updatedAt: new Date(),
      stepHistory: [],
      currentStep: undefined,
      lastMemoryId: undefined
    };
    return { ...base, ...partial };
  }

  it('publishes progress events and caches latest snapshot', () => {
    const received: number[] = [];
    const unsubscribe = migrationMonitorService.subscribe(runId, event => {
      received.push(event.progress.processed);
    });

    migrationMonitorService.publish({
      runId,
      progress: createProgress({ processed: 3, succeeded: 3 }),
      status: 'running',
      timestamp: new Date()
    });

    expect(received).toEqual([3]);

    const latest = migrationMonitorService.getLatest(runId);
    expect(latest?.status).toBe('running');
    expect(latest?.progress.processed).toBe(3);

    unsubscribe();
  });

  it('supports global subscriptions and run status tracking', () => {
    const traces: Array<{ runId: string; status: string }> = [];
    const unsubscribe = migrationMonitorService.subscribeAll(event => {
      traces.push({ runId: event.runId, status: event.status });
    });

    migrationMonitorService.publish({
      runId,
      progress: createProgress({ processed: 10, succeeded: 10 }),
      status: 'completed',
      timestamp: new Date()
    });

    expect(traces).toHaveLength(1);
    expect(traces[0]).toEqual({ runId, status: 'completed' });
    expect(migrationMonitorService.getStatus(runId)).toBe('completed');
    expect(migrationMonitorService.listActiveRuns()).not.toContain(runId);

    unsubscribe();
  });
});
