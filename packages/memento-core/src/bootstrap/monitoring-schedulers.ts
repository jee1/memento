import Database from 'better-sqlite3';
import { mementoConfig } from '../shared/config/index.js';
import { getPerformanceMonitor } from '../domains/monitoring/services/performance-monitor.js';
import { logger } from '../shared/utils/logger.js';
import { WalCheckpointScheduler } from '../infrastructure/database/wal-checkpoint-scheduler.js';
import { DatabaseLockMonitor } from '../infrastructure/database/database-lock-monitor.js';
import { RuntimeDiagnosticsLogger } from '../domains/monitoring/services/runtime-diagnostics-logger.js';

export async function createMonitoringAndSchedulers(db: Database.Database): Promise<{
  performanceMonitor: ReturnType<typeof getPerformanceMonitor>;
  runtimeDiagnosticsLogger: RuntimeDiagnosticsLogger;
  walCheckpointScheduler: WalCheckpointScheduler;
  databaseLockMonitor: DatabaseLockMonitor;
}> {
  const performanceMonitor = getPerformanceMonitor();
  performanceMonitor.initialize(db);
  const runtimeDiagnosticsLogger = new RuntimeDiagnosticsLogger(
    mementoConfig.diagnosticsEnabled,
    mementoConfig.diagnosticsLogDir,
    mementoConfig.diagnosticsJsonlMaxBytes,
    mementoConfig.diagnosticsJsonlRetainFiles,
  );
  await runtimeDiagnosticsLogger.writeEvent({
    type: 'bootstrap_start',
    timestamp: new Date().toISOString(),
    diagnosticsEnabled: mementoConfig.diagnosticsEnabled
  });
  const walCheckpointScheduler = new WalCheckpointScheduler(
    db,
    {
      intervalMs: mementoConfig.walCheckpointIntervalMs,
      walSizeWarningThreshold: mementoConfig.walSizeWarningThreshold,
      walSizeDangerThreshold: mementoConfig.walSizeDangerThreshold,
      useDedicatedConnection: mementoConfig.walCheckpointUseDedicatedConnection,
      maxRetries: mementoConfig.walCheckpointMaxRetries,
      retryBackoffMs: mementoConfig.walCheckpointRetryBackoffMs
    },
    logger,
    performanceMonitor,
    runtimeDiagnosticsLogger
  );
  const databaseLockMonitor = new DatabaseLockMonitor(
    db,
    {
      intervalMs: mementoConfig.lockMonitorIntervalMs,
      warningThresholdMs: mementoConfig.lockMonitorWarningThresholdMs,
      dangerThresholdMs: mementoConfig.lockMonitorDangerThresholdMs,
      criticalThresholdMs: mementoConfig.lockMonitorCriticalThresholdMs
    },
    logger,
    performanceMonitor,
    walCheckpointScheduler,
    runtimeDiagnosticsLogger
  );
  if (mementoConfig.walCheckpointEnabled) {
    walCheckpointScheduler.start();
    logger.info('WAL 체크포인트 스케줄러 시작됨');
  }
  if (mementoConfig.dbLockMonitorEnabled) {
    databaseLockMonitor.start();
    logger.info('데이터베이스 락 모니터 시작됨');
  }
  return {
    performanceMonitor,
    runtimeDiagnosticsLogger,
    walCheckpointScheduler,
    databaseLockMonitor
  };
}
