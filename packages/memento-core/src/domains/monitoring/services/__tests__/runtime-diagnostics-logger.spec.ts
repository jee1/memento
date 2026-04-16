import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtime diagnostics config', () => {
  const originalEnv = {
    DIAGNOSTICS_ENABLED: process.env.DIAGNOSTICS_ENABLED,
    DIAGNOSTICS_INTERVAL_MS: process.env.DIAGNOSTICS_INTERVAL_MS,
    DIAGNOSTICS_LOG_DIR: process.env.DIAGNOSTICS_LOG_DIR
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.DIAGNOSTICS_ENABLED = originalEnv.DIAGNOSTICS_ENABLED;
    process.env.DIAGNOSTICS_INTERVAL_MS = originalEnv.DIAGNOSTICS_INTERVAL_MS;
    process.env.DIAGNOSTICS_LOG_DIR = originalEnv.DIAGNOSTICS_LOG_DIR;
    vi.resetModules();
  });

  it('DIAGNOSTICS_ENABLED가 true일 때 진단 모드를 활성화해야 한다', async () => {
    process.env.DIAGNOSTICS_ENABLED = 'true';
    process.env.DIAGNOSTICS_INTERVAL_MS = '15000';
    process.env.DIAGNOSTICS_LOG_DIR = '/tmp/memento-diagnostics';
    process.env.BATCH_SCHEDULER_ENABLED = 'false';
    process.env.WAL_CHECKPOINT_ENABLED = 'false';
    process.env.DB_LOCK_MONITOR_ENABLED = 'false';

    const { mementoConfig } = await import('../../../../shared/config/index.js');

    expect(mementoConfig.diagnosticsEnabled).toBe(true);
    expect(mementoConfig.diagnosticsIntervalMs).toBe(15000);
    expect(mementoConfig.diagnosticsLogDir).toBe('/tmp/memento-diagnostics');
    expect(mementoConfig.batchSchedulerEnabled).toBe(false);
    expect(mementoConfig.walCheckpointEnabled).toBe(false);
    expect(mementoConfig.dbLockMonitorEnabled).toBe(false);
  });
});

describe('RuntimeDiagnosticsLogger', () => {
  it('로그 파일 쓰기 실패가 예외를 전파하지 않아야 한다', async () => {
    vi.doMock('fs/promises', () => ({
      appendFile: vi.fn().mockRejectedValue(new Error('simulated append failure')),
      mkdir: vi.fn().mockResolvedValue(undefined)
    }));

    const { RuntimeDiagnosticsLogger } = await import('../runtime-diagnostics-logger.js');
    const logger = new RuntimeDiagnosticsLogger(true, '/root/forbidden');

    await expect(logger.writeEvent({ type: 'server_start' })).resolves.toBeUndefined();

    vi.doUnmock('fs/promises');
  });
});
