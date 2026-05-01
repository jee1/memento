import type { RuntimeDiagnosticsLogger } from '../domains/monitoring/services/runtime-diagnostics-logger.js';
import type { IBatchScheduler } from '../shared/interfaces/batch-scheduler.interface.js';
import type { MementoConfig } from '../shared/types/index.js';
import { logger } from '../shared/utils/logger.js';

export function createRuntimeDiagnosticsSampler({
  mementoConfig,
  batchScheduler,
  runtimeDiagnosticsLogger,
}: {
  mementoConfig: Pick<
    MementoConfig,
    'diagnosticsEnabled' | 'diagnosticsIntervalMs' | 'walCheckpointEnabled' | 'dbLockMonitorEnabled'
  >;
  batchScheduler: IBatchScheduler;
  runtimeDiagnosticsLogger: RuntimeDiagnosticsLogger;
}): { runtimeDiagnosticsSamplerCleanup?: () => Promise<void> } {
  let runtimeDiagnosticsSamplerCleanup: (() => Promise<void>) | undefined;
  if (mementoConfig.diagnosticsEnabled) {
    let runtimeDiagnosticsSamplerStopped = false;
    let runtimeDiagnosticsSamplerInFlight: Promise<void> | null = null;
    let runtimeDiagnosticsSamplerTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRuntimeDiagnosticsSampler = (): void => {
      if (runtimeDiagnosticsSamplerStopped) {
        return;
      }

      runtimeDiagnosticsSamplerTimer = setTimeout(() => {
        runtimeDiagnosticsSamplerTimer = null;
        void runRuntimeDiagnosticsSampler();
      }, mementoConfig.diagnosticsIntervalMs);
      runtimeDiagnosticsSamplerTimer.unref?.();
    };

    const runRuntimeDiagnosticsSampler = async (): Promise<void> => {
      if (runtimeDiagnosticsSamplerStopped) {
        return;
      }

      const currentRun = (async () => {
        if (runtimeDiagnosticsSamplerStopped) {
          return;
        }

        try {
          const batchSchedulerStatus = batchScheduler.getStatus();
          await runtimeDiagnosticsLogger.writeSample({
            type: 'runtime_sample',
            timestamp: new Date().toISOString(),
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            batchScheduler: {
              isRunning: batchSchedulerStatus.isRunning,
              activeJobs: batchSchedulerStatus.activeJobs ?? [],
              uptime: batchSchedulerStatus.uptime ?? 0,
              lastExecution: batchSchedulerStatus.lastExecution
                ? Object.fromEntries(
                    Array.from(batchSchedulerStatus.lastExecution.entries()).map(([jobName, executedAt]) => [
                      jobName,
                      executedAt.toISOString()
                    ])
                  )
                : undefined,
              totalExecutions: batchSchedulerStatus.totalExecutions
                ? Object.fromEntries(batchSchedulerStatus.totalExecutions.entries())
                : undefined,
              errorCount: batchSchedulerStatus.errorCount
                ? Object.fromEntries(batchSchedulerStatus.errorCount.entries())
                : undefined
            },
            walCheckpointEnabled: mementoConfig.walCheckpointEnabled,
            dbLockMonitorEnabled: mementoConfig.dbLockMonitorEnabled
          });
        } catch (error) {
          try {
            logger.error('런타임 진단 샘플 기록 실패', {
              error: error instanceof Error ? error.message : String(error)
            });
          } catch {
            // diagnostics best-effort: sampler failure must not abort bootstrap
          }
        }
      })();

      runtimeDiagnosticsSamplerInFlight = currentRun;
      try {
        await currentRun;
      } finally {
        if (runtimeDiagnosticsSamplerInFlight === currentRun) {
          runtimeDiagnosticsSamplerInFlight = null;
        }
      }
      if (!runtimeDiagnosticsSamplerStopped) {
        scheduleRuntimeDiagnosticsSampler();
      }
    };

    scheduleRuntimeDiagnosticsSampler();
    runtimeDiagnosticsSamplerCleanup = async () => {
      runtimeDiagnosticsSamplerStopped = true;
      if (runtimeDiagnosticsSamplerTimer) {
        clearTimeout(runtimeDiagnosticsSamplerTimer);
        runtimeDiagnosticsSamplerTimer = null;
      }
      await runtimeDiagnosticsSamplerInFlight;
    };
  }
  return { runtimeDiagnosticsSamplerCleanup };
}
