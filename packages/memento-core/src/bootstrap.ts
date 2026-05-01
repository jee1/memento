/**
 * 공용 부트스트랩 함수
 * HTTP 서버와 MCP 서버가 공통으로 사용하는 서비스 초기화 로직
 * @memento/core 내부: createMementoCore에서 사용
 */

import Database from 'better-sqlite3';
import { mementoConfig } from './shared/config/index.js';
import type { SearchEngine } from './domains/search/algorithms/search-engine.js';
import { HybridSearchEngine } from './domains/search/algorithms/hybrid-search-engine.js';
import { createSearchEmbeddingAndOptimizerServices } from './bootstrap/search-and-embedding.js';
import { MemoryEmbeddingService } from './domains/memory/services/memory-embedding-service.js';
import { ForgettingPolicyService } from './domains/forgetting/services/forgetting-policy-service.js';
import { getPerformanceMonitor } from './domains/monitoring/services/performance-monitor.js';
import { ErrorLoggingService } from './domains/monitoring/services/error-logging-service.js';
import { PerformanceAlertService } from './domains/monitoring/services/performance-alert-service.js';
import { WriteCoalescingManager, type CoalescedWrite } from './shared/utils/write-coalescing.js';
import { DatabaseUtils } from './shared/utils/database.js';
import { createAnchorStack } from './bootstrap/anchor-stack.js';
import { createMonitoringAndSchedulers } from './bootstrap/monitoring-schedulers.js';
import { startFailureAndReflexion } from './bootstrap/failure-reflexion.js';
import type { AnchorManager } from './domains/anchor/services/anchor/anchor-manager.js';
import type { FailureDetector } from './domains/monitoring/services/failure-detector.js';
import type { IBatchScheduler } from './shared/interfaces/batch-scheduler.interface.js';
import type { IConsolidationScoreService } from './shared/interfaces/consolidation-score.interface.js';
import type { IDatabaseOptimizer } from './shared/interfaces/database-optimizer.interface.js';
import type { IReflexionWorker } from './shared/interfaces/reflexion-worker.interface.js';
import { ConsolidationScoreService } from './infrastructure/consolidation-score-service.js';
import { getVectorSearchEngine } from './domains/search/algorithms/vector-search-engine.js';
import { getBatchScheduler } from './infrastructure/scheduler/batch-scheduler.js';
import { SleepConsolidationService } from './domains/consolidation/services/sleep-consolidation-service.js';
import { createRelationGraph } from './infrastructure/relation-graph-factory.js';
import type { RelationGraphPort } from './domains/relation/ports/relation-graph.port.js';
import { logger } from './shared/utils/logger.js';
import { WalCheckpointScheduler } from './infrastructure/database/wal-checkpoint-scheduler.js';
import { DatabaseLockMonitor } from './infrastructure/database/database-lock-monitor.js';
import { MetaMemoryService } from './domains/memory/services/meta-memory-service.js';
import { IntrospectionScanCache } from './domains/memory/services/introspection-scan-cache.js';
import type { SqlParam } from './shared/types/index.js';
import { TelemetryRepository } from './domains/telemetry/repositories/telemetry-repository.js';
import { TelemetryService } from './domains/telemetry/services/telemetry-service.js';
import { RuntimeDiagnosticsLogger } from './domains/monitoring/services/runtime-diagnostics-logger.js';

export interface ServerServices {
  searchEngine: SearchEngine;
  hybridSearchEngine: HybridSearchEngine;
  embeddingService: MemoryEmbeddingService;
  forgettingPolicyService: ForgettingPolicyService;
  performanceMonitor: ReturnType<typeof getPerformanceMonitor>;
  databaseOptimizer: IDatabaseOptimizer;
  errorLoggingService: ErrorLoggingService;
  performanceAlertService: PerformanceAlertService;
  consolidationScoreService?: IConsolidationScoreService;
  writeCoalescingManager: WriteCoalescingManager;
  metaMemoryService: MetaMemoryService;
  anchorManager: AnchorManager;
  relationGraph: RelationGraphPort;
  failureDetector: FailureDetector;
  reflexionWorker?: IReflexionWorker;
  walCheckpointScheduler: WalCheckpointScheduler;
  databaseLockMonitor: DatabaseLockMonitor;
  vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>;
  batchScheduler?: IBatchScheduler;
  /** Issue #21 Phase B: 인트로스펙션 스캔 결과 캐시 (recall/get_meta_memory_stats/get_introspection_summary용) */
  introspectionScanCache?: IntrospectionScanCache;
  /** 005 sleep consolidation */
  sleepConsolidationService?: SleepConsolidationService;
  /** 006 observability telemetry */
  telemetryService?: TelemetryService;
  /** 런타임 샘플 및 부트스트랩 이벤트 진단 로거 */
  runtimeDiagnosticsLogger?: RuntimeDiagnosticsLogger;
  /** diagnostics sampler cleanup hook */
  runtimeDiagnosticsSamplerCleanup?: () => Promise<void>;
}

export async function initializeServices(db: Database.Database): Promise<ServerServices> {
  try {
    const {
      searchEngine,
      embeddingService,
      hybridSearchEngine,
      forgettingPolicyService,
      databaseOptimizer,
    } = createSearchEmbeddingAndOptimizerServices(db);
    const errorLoggingService = new ErrorLoggingService();
    const performanceAlertService = new PerformanceAlertService('./logs');
    const { vectorSearchEngine, anchorManager } = await createAnchorStack(
      db,
      embeddingService,
      hybridSearchEngine,
      errorLoggingService
    );
    const { failureDetector, reflexionWorker } = await startFailureAndReflexion(db);
    const {
      performanceMonitor,
      runtimeDiagnosticsLogger,
      walCheckpointScheduler,
      databaseLockMonitor
    } = await createMonitoringAndSchedulers(db);
    let consolidationScoreService: ConsolidationScoreService | undefined;
    const writeCoalescingManager = new WriteCoalescingManager(
      1000,
      async (writes: CoalescedWrite[]) => {
        if (!db || writes.length === 0) return;
        const currentDb = db;
        try {
          await DatabaseUtils.runTransaction(currentDb, async () => {
            for (const write of writes) {
              const updates: string[] = [];
              const params: SqlParam[] = [];
              if (write.fields.recall_count !== undefined) {
                updates.push('recall_count = ?');
                params.push(write.fields.recall_count);
              }
              if (write.fields.last_accessed_at !== undefined) {
                updates.push('last_accessed_at = ?');
                params.push(write.fields.last_accessed_at);
              }
              if (mementoConfig.consolidationScoreEnabled) {
                if (write.fields.g_value !== undefined) {
                  updates.push('g_value = ?');
                  params.push(write.fields.g_value);
                }
                if (write.fields.consolidation_score !== undefined) {
                  updates.push('consolidation_score = ?');
                  params.push(write.fields.consolidation_score);
                }
              }
              if (updates.length > 0) {
                params.push(write.memoryId);
                DatabaseUtils.run(
                  currentDb,
                  `UPDATE memory_item SET ${updates.join(', ')} WHERE id = ?`,
                  params
                );
              }
            }
          });
        } catch (error) {
          logger.error(`⚠️ Write coalescing flush 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
    if (mementoConfig.consolidationScoreEnabled) {
      consolidationScoreService = new ConsolidationScoreService();
    }
    const metaMemoryService = new MetaMemoryService(db, writeCoalescingManager);
    logger.info('MetaMemoryService 초기화 완료');
    const introspectionScanCache = new IntrospectionScanCache();
    const telemetryRepository = new TelemetryRepository(db);
    const batchScheduler = getBatchScheduler();
    batchScheduler.setDiagnosticsLogger(runtimeDiagnosticsLogger);
    batchScheduler.setTelemetryCleanupRepository(telemetryRepository);
    const telemetryService = new TelemetryService(telemetryRepository, () => getBatchScheduler());
    batchScheduler.setIntrospectionScanCache(introspectionScanCache);
    const relationGraph = createRelationGraph(db);
    const sleepConsolidationService = new SleepConsolidationService(db, {
      relationGraph: relationGraph,
      memoryEmbeddingService: embeddingService,
      telemetryService
    });
    batchScheduler.setSleepConsolidationService(sleepConsolidationService);
    if (mementoConfig.batchSchedulerEnabled) {
      await batchScheduler.start(db, reflexionWorker);
    }
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
    return {
      searchEngine,
      hybridSearchEngine,
      vectorSearchEngine,
      embeddingService,
      forgettingPolicyService,
      performanceMonitor,
      databaseOptimizer,
      errorLoggingService,
      performanceAlertService,
      consolidationScoreService,
      writeCoalescingManager,
      metaMemoryService,
      anchorManager,
      relationGraph,
      failureDetector,
      reflexionWorker,
      walCheckpointScheduler,
      databaseLockMonitor,
      batchScheduler,
      introspectionScanCache,
      sleepConsolidationService,
      telemetryService,
      runtimeDiagnosticsLogger,
      runtimeDiagnosticsSamplerCleanup
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`서비스 초기화 실패: ${errorMessage}`);
  }
}
