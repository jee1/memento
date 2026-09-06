/**
 * runLogRotation handler smoke — additive BatchJobResult.details contract (#852 T015).
 */

import { describe, expect, it, vi } from 'vitest';
import { runLogRotation } from './batch-scheduler-consolidation-relation-handlers.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';
import type { LogRotationReport } from '../../logging/log-rotation.js';

const rotateLogsMock = vi.fn<() => Promise<LogRotationReport>>();

vi.mock('../../logging/log-rotation.js', () => ({
  rotateLogs: () => rotateLogsMock(),
}));

function createContext(): BatchSchedulerRunContext {
  return {
    log: vi.fn(),
  } as unknown as BatchSchedulerRunContext;
}

describe('runLogRotation', () => {
  it('maps orchestrator report to additive details without absolute paths', async () => {
    rotateLogsMock.mockResolvedValue({
      deletedCount: 3,
      reclaimedBytes: 9000,
      warnings: ['migration:stale.log:unlink-failed'],
      policies: {
        migrationKeepCount: 500,
        dockerDiagnosticsMaxBytes: 268_435_456,
        monitorJsonlMaxBytes: 33_554_432,
        tripleExtractionDays: 30,
      },
      families: [
        {
          family: 'migration',
          deletedCount: 2,
          reclaimedBytes: 8000,
          warnings: [],
        },
        {
          family: 'docker_diagnostics',
          deletedCount: 1,
          reclaimedBytes: 1000,
          warnings: [],
        },
        {
          family: 'log_issue_monitor',
          deletedCount: 0,
          reclaimedBytes: 0,
          skippedMissingRoot: true,
          warnings: [],
        },
        {
          family: 'triple_extraction',
          deletedCount: 0,
          reclaimedBytes: 0,
          warnings: [],
        },
      ],
    });

    const result = await runLogRotation(createContext());

    expect(result.success).toBe(true);
    expect(result.processed).toBe(3);
    expect(result.warnings).toEqual(['migration:stale.log:unlink-failed']);
    expect(result.details).toEqual({
      retentionDaysTripleExtraction: 30,
      migrationKeepCount: 500,
      dockerDiagnosticsMaxBytes: 268_435_456,
      families: [
        { family: 'migration', deletedCount: 2, reclaimedBytes: 8000 },
        { family: 'docker_diagnostics', deletedCount: 1, reclaimedBytes: 1000 },
        {
          family: 'log_issue_monitor',
          deletedCount: 0,
          reclaimedBytes: 0,
          skippedMissingRoot: true,
        },
        { family: 'triple_extraction', deletedCount: 0, reclaimedBytes: 0 },
      ],
      reclaimedBytes: 9000,
    });
    expect(JSON.stringify(result)).not.toMatch(/^\//);
    expect(result.errors).toEqual([]);
  });

  it('returns sanitized operator-facing error on orchestration failure', async () => {
    rotateLogsMock.mockRejectedValue(new Error('/home/secret/.memento/logs/migration_x.log'));

    const result = await runLogRotation(createContext());

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['log_rotation orchestration failed']);
    expect(JSON.stringify(result.errors)).not.toContain('/home/secret');
  });
});
