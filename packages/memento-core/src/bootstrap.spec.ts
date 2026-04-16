import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  const mementoConfig = {
    walCheckpointIntervalMs: 300000,
    walSizeWarningThreshold: 16777216,
    walSizeDangerThreshold: 25165824,
    walCheckpointUseDedicatedConnection: true,
    walCheckpointMaxRetries: 3,
    walCheckpointRetryBackoffMs: 1000,
    lockMonitorIntervalMs: 60000,
    lockMonitorWarningThresholdMs: 5000,
    lockMonitorDangerThresholdMs: 30000,
    lockMonitorCriticalThresholdMs: 60000,
    diagnosticsEnabled: false,
    diagnosticsIntervalMs: 15000,
    diagnosticsLogDir: '/tmp/memento-diagnostics',
    consolidationScoreEnabled: false,
    batchSchedulerEnabled: true,
    walCheckpointEnabled: true,
    dbLockMonitorEnabled: true
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  const performanceMonitor = {
    initialize: vi.fn()
  };

  const batchScheduler = {
    setTelemetryCleanupRepository: vi.fn(),
    setIntrospectionScanCache: vi.fn(),
    setSleepConsolidationService: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(() => ({
      isRunning: true,
      activeJobs: ['cleanup'],
      uptime: 42,
      lastExecution: new Map([['cleanup', new Date('2026-01-01T00:00:00.000Z')]]),
      totalExecutions: new Map([['cleanup', 3]]),
      errorCount: new Map([['cleanup', 1]])
    }))
  };

  const runtimeDiagnosticsLogger = {
    writeEvent: vi.fn().mockResolvedValue(undefined),
    writeSample: vi.fn().mockResolvedValue(undefined)
  };

  const walCheckpointSchedulerStart = vi.fn();
  const databaseLockMonitorStart = vi.fn();
  const runtimeDiagnosticsLoggerCtor = vi.fn().mockImplementation((enabled: boolean, logDir: string) => {
    return {
      enabled,
      logDir,
      writeEvent: runtimeDiagnosticsLogger.writeEvent,
      writeSample: runtimeDiagnosticsLogger.writeSample
    };
  });

  const clearTimeoutSpy = vi.fn();
  const mockTimerCallbacks: Array<(...args: unknown[]) => unknown> = [];

  return {
    mementoConfig,
    logger,
    performanceMonitor,
    batchScheduler,
    runtimeDiagnosticsLogger,
    walCheckpointSchedulerStart,
    databaseLockMonitorStart,
    runtimeDiagnosticsLoggerCtor,
    clearTimeoutSpy,
    lastTimeoutHandle: null as ReturnType<typeof setTimeout> | null,
    mockTimerCallbacks
  };
});

vi.mock('./shared/config/index.js', () => ({
  mementoConfig: mockState.mementoConfig
}));

vi.mock('./shared/utils/logger.js', () => ({
  logger: mockState.logger
}));

vi.mock('./domains/search/algorithms/search-engine.js', () => ({
  SearchEngine: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/search/algorithms/hybrid-search-engine.js', () => ({
  HybridSearchEngine: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/search/factories/hybrid-search.factory.js', () => ({
  HybridSearchFactory: {
    createDefaultEngine: vi.fn(() => ({}))
  }
}));

vi.mock('./domains/memory/services/memory-embedding-service.js', () => ({
  MemoryEmbeddingService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/forgetting/services/forgetting-policy-service.js', () => ({
  ForgettingPolicyService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/monitoring/services/performance-monitor.js', () => ({
  getPerformanceMonitor: () => mockState.performanceMonitor
}));

vi.mock('./domains/monitoring/services/error-logging-service.js', () => ({
  ErrorLoggingService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/monitoring/services/performance-alert-service.js', () => ({
  PerformanceAlertService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./shared/utils/write-coalescing.js', () => ({
  WriteCoalescingManager: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./shared/utils/database.js', () => ({
  DatabaseUtils: {
    runTransaction: vi.fn(),
    run: vi.fn()
  }
}));

vi.mock('./domains/anchor/services/anchor/anchor-manager.js', () => ({
  AnchorManager: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/anchor/services/anchor/anchor-cache-service.js', () => ({
  AnchorCacheService: class {
    restoreCacheFromDB = vi.fn().mockResolvedValue(undefined);
  }
}));

vi.mock('./domains/anchor/services/anchor/anchor-search-service.js', () => ({
  AnchorSearchService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/monitoring/services/failure-detector.js', () => ({
  FailureDetector: class {
    startQueue = vi.fn().mockResolvedValue(undefined);
  }
}));

vi.mock('./infrastructure/async-optimizer.js', () => ({
  AsyncTaskQueue: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./infrastructure/database/database-optimizer.js', () => ({
  DatabaseOptimizer: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./infrastructure/consolidation-score-service.js', () => ({
  ConsolidationScoreService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./infrastructure/reflexion-worker.js', () => ({
  ReflexionWorker: class {
    start = vi.fn().mockResolvedValue(undefined);
  }
}));

vi.mock('./domains/search/algorithms/vector-search-engine.js', () => ({
  getVectorSearchEngine: vi.fn(() => ({}))
}));

vi.mock('./infrastructure/scheduler/batch-scheduler.js', () => ({
  getBatchScheduler: () => mockState.batchScheduler,
  resetBatchScheduler: vi.fn()
}));

vi.mock('./domains/consolidation/services/sleep-consolidation-service.js', () => ({
  SleepConsolidationService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./infrastructure/relation-graph-factory.js', () => ({
  createRelationGraph: vi.fn(() => ({}))
}));

vi.mock('./infrastructure/database/wal-checkpoint-scheduler.js', () => ({
  WalCheckpointScheduler: class {
    start = mockState.walCheckpointSchedulerStart;
  }
}));

vi.mock('./infrastructure/database/database-lock-monitor.js', () => ({
  DatabaseLockMonitor: class {
    start = mockState.databaseLockMonitorStart;
  }
}));

vi.mock('./domains/memory/services/meta-memory-service.js', () => ({
  MetaMemoryService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/memory/services/introspection-scan-cache.js', () => ({
  IntrospectionScanCache: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/telemetry/repositories/telemetry-repository.js', () => ({
  TelemetryRepository: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/telemetry/services/telemetry-service.js', () => ({
  TelemetryService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./domains/monitoring/services/runtime-diagnostics-logger.js', () => ({
  RuntimeDiagnosticsLogger: class {
    enabled: boolean;

    logDir: string;

    writeEvent = mockState.runtimeDiagnosticsLogger.writeEvent;

    writeSample = mockState.runtimeDiagnosticsLogger.writeSample;

    constructor(enabled: boolean, logDir: string) {
      this.enabled = enabled;
      this.logDir = logDir;
      mockState.runtimeDiagnosticsLoggerCtor(enabled, logDir);
    }
  }
}));

describe('initializeServices bootstrap wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.mementoConfig.diagnosticsEnabled = false;
    mockState.mementoConfig.batchSchedulerEnabled = true;
    mockState.mementoConfig.walCheckpointEnabled = true;
    mockState.mementoConfig.dbLockMonitorEnabled = true;
    mockState.mementoConfig.diagnosticsIntervalMs = 15000;
    mockState.mockTimerCallbacks.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadBootstrap() {
    return import('./bootstrap.js');
  }

  function installTimeoutSpy() {
    return vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback: TimerHandler, interval?: number) => {
      const handle = {
        unref: vi.fn(),
        ref: vi.fn()
      } as unknown as ReturnType<typeof setTimeout>;
      mockState.lastTimeoutHandle = handle;
      mockState.mockTimerCallbacks.push(callback as (...args: unknown[]) => unknown);
      return handle;
    });
  }

  it('BATCH_SCHEDULER_ENABLED=false이면 batch scheduler를 시작하지 않아야 한다', async () => {
    mockState.mementoConfig.batchSchedulerEnabled = false;

    const { initializeServices } = await loadBootstrap();
    await initializeServices({} as never);

    expect(mockState.batchScheduler.start).not.toHaveBeenCalled();
    expect(mockState.batchScheduler.setTelemetryCleanupRepository).toHaveBeenCalled();
    expect(mockState.batchScheduler.setIntrospectionScanCache).toHaveBeenCalled();
    expect(mockState.batchScheduler.setSleepConsolidationService).toHaveBeenCalled();
  });

  it('WAL_CHECKPOINT_ENABLED=false이면 WAL 체크포인트 스케줄러를 시작하지 않아야 한다', async () => {
    mockState.mementoConfig.walCheckpointEnabled = false;

    const { initializeServices } = await loadBootstrap();
    await initializeServices({} as never);

    expect(mockState.walCheckpointSchedulerStart).not.toHaveBeenCalled();
    expect(mockState.databaseLockMonitorStart).toHaveBeenCalled();
  });

  it('DB_LOCK_MONITOR_ENABLED=false이면 데이터베이스 락 모니터를 시작하지 않아야 한다', async () => {
    mockState.mementoConfig.dbLockMonitorEnabled = false;

    const { initializeServices } = await loadBootstrap();
    await initializeServices({} as never);

    expect(mockState.walCheckpointSchedulerStart).toHaveBeenCalled();
    expect(mockState.databaseLockMonitorStart).not.toHaveBeenCalled();
  });

  it('diagnostics가 활성화되면 bootstrap 이벤트와 주기 샘플링을 연결해야 한다', async () => {
    mockState.mementoConfig.diagnosticsEnabled = true;
    mockState.mementoConfig.diagnosticsIntervalMs = 2500;
    const setTimeoutSpy = installTimeoutSpy();

    const { initializeServices } = await loadBootstrap();
    const services = await initializeServices({} as never);

    expect(mockState.runtimeDiagnosticsLoggerCtor).toHaveBeenCalledWith(true, '/tmp/memento-diagnostics');
    expect(mockState.runtimeDiagnosticsLogger.writeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bootstrap_start',
        diagnosticsEnabled: true
      })
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2500);
    expect(services.runtimeDiagnosticsLogger).toBeDefined();
    expect(services.runtimeDiagnosticsSamplerCleanup).toBeTypeOf('function');
    expect(mockState.lastTimeoutHandle?.unref).toHaveBeenCalled();

    const callback = mockState.mockTimerCallbacks[0];
    expect(callback).toBeTypeOf('function');

    await callback();

    expect(mockState.runtimeDiagnosticsLogger.writeSample).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'runtime_sample',
        batchScheduler: expect.objectContaining({
          isRunning: true,
          activeJobs: ['cleanup'],
          uptime: 42,
          lastExecution: {
            cleanup: '2026-01-01T00:00:00.000Z'
          },
          totalExecutions: {
            cleanup: 3
          },
          errorCount: {
            cleanup: 1
          }
        }),
        walCheckpointEnabled: true,
        dbLockMonitorEnabled: true,
        uptime: expect.any(Number),
        memory: expect.objectContaining({
          rss: expect.any(Number)
        })
      })
    );
    expect(mockState.batchScheduler.getStatus).toHaveBeenCalled();
  });

  it('diagnostics가 비활성화되면 sampler를 시작하지 않아야 한다', async () => {
    mockState.mementoConfig.diagnosticsEnabled = false;
    const setTimeoutSpy = installTimeoutSpy();

    const { initializeServices } = await loadBootstrap();
    const services = await initializeServices({} as never);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(services.runtimeDiagnosticsSamplerCleanup).toBeUndefined();
    expect(mockState.runtimeDiagnosticsLogger.writeSample).not.toHaveBeenCalled();
  });

  it('sampler cleanup은 느린 샘플 도중에도 후속 샘플이 완료되지 않게 해야 한다', async () => {
    mockState.mementoConfig.diagnosticsEnabled = true;
    const setTimeoutSpy = installTimeoutSpy();
    let resolveSample: (() => void) | null = null;
    mockState.runtimeDiagnosticsLogger.writeSample.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSample = resolve;
        })
    );

    const { initializeServices } = await loadBootstrap();
    const services = await initializeServices({} as never);

    expect(services.runtimeDiagnosticsSamplerCleanup).toBeTypeOf('function');
    void mockState.mockTimerCallbacks[0]?.();
    await Promise.resolve();

    const cleanupPromise = services.runtimeDiagnosticsSamplerCleanup?.();

    let cleanupResolved = false;
    cleanupPromise?.then(() => {
      cleanupResolved = true;
    });

    await Promise.resolve();
    expect(cleanupResolved).toBe(false);
    expect(mockState.runtimeDiagnosticsLogger.writeSample).toHaveBeenCalledTimes(1);

    resolveSample?.();
    await cleanupPromise;

    expect(cleanupResolved).toBe(true);
    expect(mockState.runtimeDiagnosticsLogger.writeSample).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
