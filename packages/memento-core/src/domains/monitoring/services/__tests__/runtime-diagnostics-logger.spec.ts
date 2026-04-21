import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtime diagnostics config', () => {
  const originalEnv = {
    DIAGNOSTICS_ENABLED: process.env.DIAGNOSTICS_ENABLED,
    DIAGNOSTICS_INTERVAL_MS: process.env.DIAGNOSTICS_INTERVAL_MS,
    DIAGNOSTICS_LOG_DIR: process.env.DIAGNOSTICS_LOG_DIR,
    BATCH_SCHEDULER_ENABLED: process.env.BATCH_SCHEDULER_ENABLED,
    WAL_CHECKPOINT_ENABLED: process.env.WAL_CHECKPOINT_ENABLED,
    DB_LOCK_MONITOR_ENABLED: process.env.DB_LOCK_MONITOR_ENABLED
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    const restoreEnvValue = (key: keyof typeof originalEnv) => {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = value;
    };

    restoreEnvValue('DIAGNOSTICS_ENABLED');
    restoreEnvValue('DIAGNOSTICS_INTERVAL_MS');
    restoreEnvValue('DIAGNOSTICS_LOG_DIR');
    restoreEnvValue('BATCH_SCHEDULER_ENABLED');
    restoreEnvValue('WAL_CHECKPOINT_ENABLED');
    restoreEnvValue('DB_LOCK_MONITOR_ENABLED');
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

  it('진단 관련 환경 변수가 없으면 기본값을 사용해야 한다', async () => {
    delete process.env.DIAGNOSTICS_ENABLED;
    delete process.env.DIAGNOSTICS_INTERVAL_MS;
    delete process.env.DIAGNOSTICS_LOG_DIR;
    delete process.env.BATCH_SCHEDULER_ENABLED;
    delete process.env.WAL_CHECKPOINT_ENABLED;
    delete process.env.DB_LOCK_MONITOR_ENABLED;

    const { mementoConfig } = await import('../../../../shared/config/index.js');

    expect(mementoConfig.diagnosticsEnabled).toBe(false);
    expect(mementoConfig.diagnosticsIntervalMs).toBe(15000);
    expect(mementoConfig.diagnosticsLogDir).toBe('/app/logs/diagnostics');
    expect(mementoConfig.batchSchedulerEnabled).toBe(true);
    expect(mementoConfig.walCheckpointEnabled).toBe(true);
    expect(mementoConfig.dbLockMonitorEnabled).toBe(true);
  });
});

describe('RuntimeDiagnosticsLogger', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('fs/promises');
    vi.resetModules();
  });

  it('writeSample이 JSONL 파일에 기록해야 한다', async () => {
    const appendFileMock = vi.fn().mockResolvedValue(undefined);
    const mkdirMock = vi.fn().mockResolvedValue(undefined);

    vi.doMock('fs/promises', () => ({
      appendFile: appendFileMock,
      mkdir: mkdirMock
    }));

    try {
      const { RuntimeDiagnosticsLogger } = await import('../runtime-diagnostics-logger.js');
      const logger = new RuntimeDiagnosticsLogger(true, '/tmp/memento-diagnostics');

      await expect(logger.writeSample({ type: 'sample', count: 1 })).resolves.toBeUndefined();

      expect(mkdirMock).toHaveBeenCalledWith('/tmp/memento-diagnostics', { recursive: true });
      expect(appendFileMock).toHaveBeenCalledWith(
        '/tmp/memento-diagnostics/app-runtime.jsonl',
        '{"type":"sample","count":1}\n',
        'utf8'
      );
    } finally {
      vi.doUnmock('fs/promises');
    }
  });

  it('로그 파일 쓰기 실패가 예외를 전파하지 않아야 한다', async () => {
    vi.doMock('fs/promises', () => ({
      appendFile: vi.fn().mockRejectedValue(new Error('simulated append failure')),
      mkdir: vi.fn().mockResolvedValue(undefined)
    }));

    try {
      const { RuntimeDiagnosticsLogger } = await import('../runtime-diagnostics-logger.js');
      const logger = new RuntimeDiagnosticsLogger(true, '/root/forbidden');

      await expect(logger.writeEvent({ type: 'server_start' })).resolves.toBeUndefined();
    } finally {
      vi.doUnmock('fs/promises');
    }
  });
});
