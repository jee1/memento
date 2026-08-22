import { closeDatabase, logger, type ServerServices } from '@memento/core';
import type Database from 'better-sqlite3';
import { deleteServerInfo, resolveServerInfoConfigDir } from './server-info.js';

export type WriteDiagnostics = (type: string, payload?: Record<string, unknown>) => Promise<void>;

interface CleanupRefs {
  getDb: () => Database.Database | null;
  setDb: (v: Database.Database | null) => void;
  getServerServices: () => ServerServices | null;
  setServerServices: (v: ServerServices | null) => void;
  writeDiagnostics: WriteDiagnostics;
}

let isCleaningUp = false;
let cleanupRegistered = false;

export function createRuntimeDiagnosticsWriter(
  getServerServices: () => ServerServices | null,
): WriteDiagnostics {
  return async (type, payload = {}) => {
    const svc = getServerServices();
    if (!svc?.runtimeDiagnosticsLogger) return;
    try {
      await svc.runtimeDiagnosticsLogger.writeEvent({
        type,
        timestamp: new Date().toISOString(),
        transport: 'http',
        ...payload,
      });
    } catch {
      return;
    }
  };
}

export async function performCleanup(refs: CleanupRefs): Promise<void> {
  if (isCleaningUp) return;
  isCleaningUp = true;

  try {
    const configDirForCleanup = resolveServerInfoConfigDir();
    try {
      await deleteServerInfo(configDirForCleanup);
    } catch {
      // ignore cleanup errors
    }

    await refs.writeDiagnostics('server_cleanup_start');

    const serverServices = refs.getServerServices();
    if (serverServices) {
      if (serverServices.runtimeDiagnosticsSamplerCleanup) {
        try {
          await serverServices.runtimeDiagnosticsSamplerCleanup();
          logger.info('런타임 진단 샘플러 중지됨');
        } catch (error) {
          logger.error('런타임 진단 샘플러 중지 실패', { error });
        }
      }

      if (serverServices.batchScheduler) {
        try {
          await serverServices.batchScheduler.stop();
          logger.info('배치 스케줄러 중지됨');
        } catch (error) {
          logger.error('배치 스케줄러 중지 실패', { error });
        }
      }

      if (serverServices.walCheckpointScheduler) {
        try {
          await serverServices.walCheckpointScheduler.stop();
          logger.info('WAL 체크포인트 스케줄러 중지됨');
        } catch (error) {
          logger.error('WAL 체크포인트 스케줄러 중지 실패', { error });
        }
      }

      if (serverServices.databaseLockMonitor) {
        try {
          serverServices.databaseLockMonitor.stop();
          logger.info('데이터베이스 락 모니터 중지됨');
        } catch (error) {
          logger.error('데이터베이스 락 모니터 중지 실패', { error });
        }
      }
    }

    if (serverServices?.writeCoalescingManager) {
      await serverServices.writeCoalescingManager.flush();
      await serverServices.writeCoalescingManager.destroy();
      logger.info('Write Coalescing Manager 정리 완료');
    }

    const db = refs.getDb();
    if (db) {
      closeDatabase(db);
      refs.setDb(null);
    }
    logger.info('HTTP/WebSocket MCP 서버 v2 종료');
    await refs.writeDiagnostics('server_cleanup_finish');
    refs.setServerServices(null);
  } catch (error) {
    logger.error('정리 중 오류', { error });
  } finally {
    isCleaningUp = false;
  }
}

export function registerCleanupHandlers(
  cleanupFn: () => Promise<void>,
  writeDiagnostics: WriteDiagnostics,
): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  process.on('SIGINT', async () => {
    await writeDiagnostics('server_shutdown_signal', { signal: 'SIGINT' });
    await cleanupFn();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await writeDiagnostics('server_shutdown_signal', { signal: 'SIGTERM' });
    await cleanupFn();
    process.exit(0);
  });

  process.on('uncaughtException', async (error) => {
    logger.error('예상치 못한 오류', { error });
    await writeDiagnostics('uncaught_exception', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await cleanupFn();
    process.exit(1);
  });
}
