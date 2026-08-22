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
import type { WriteCoalescingManager } from './shared/utils/write-coalescing.js';
import { createAnchorStack } from './bootstrap/anchor-stack.js';
import { createWriteCoalescingMetaAndScore } from './bootstrap/write-and-meta.js';
import { createMonitoringAndSchedulers } from './bootstrap/monitoring-schedulers.js';
import { createBatchTelemetryRelationAndSleep } from './bootstrap/batch-telemetry-relation.js';
import { createRuntimeDiagnosticsSampler } from './bootstrap/runtime-diagnostics-sampler.js';
import { startFailureAndReflexion } from './bootstrap/failure-reflexion.js';
import type { AnchorManager } from './domains/anchor/services/anchor/anchor-manager.js';
import type { FailureDetector } from './domains/monitoring/services/failure-detector.js';
import type { IBatchScheduler } from './shared/interfaces/batch-scheduler.interface.js';
import type { IConsolidationScoreService } from './shared/interfaces/consolidation-score.interface.js';
import type { IDatabaseOptimizer } from './shared/interfaces/database-optimizer.interface.js';
import type { IReflexionWorker } from './shared/interfaces/reflexion-worker.interface.js';
import { getVectorSearchEngine } from './domains/search/algorithms/vector-search-engine.js';
import { SleepConsolidationService } from './domains/consolidation/services/sleep-consolidation-service.js';
import type { RelationGraphPort } from './domains/relation/ports/relation-graph.port.js';
import { WalCheckpointScheduler } from './infrastructure/database/wal-checkpoint-scheduler.js';
import { DatabaseLockMonitor } from './infrastructure/database/database-lock-monitor.js';
import type { MetaMemoryService } from './domains/memory/introspection/meta-memory-service.js';
import { IntrospectionScanCache } from './domains/memory/introspection/introspection-scan-cache.js';
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
    const { vectorSearchEngine, anchorManager, anchorSearchService } = await createAnchorStack(
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
    const { writeCoalescingManager, consolidationScoreService, metaMemoryService } =
      createWriteCoalescingMetaAndScore(db);
    const {
      introspectionScanCache,
      batchScheduler,
      telemetryService,
      relationGraph,
      sleepConsolidationService
    } = await createBatchTelemetryRelationAndSleep(
      db,
      embeddingService,
      runtimeDiagnosticsLogger,
      reflexionWorker,
      anchorManager,
      mementoConfig.walCheckpointEnabled ? walCheckpointScheduler : undefined,
      mementoConfig.dbLockMonitorEnabled ? databaseLockMonitor : undefined
    );
    anchorSearchService.setRelationGraph(relationGraph);
    hybridSearchEngine.setRelationGraph(relationGraph);
    const { runtimeDiagnosticsSamplerCleanup } = createRuntimeDiagnosticsSampler({
      mementoConfig,
      batchScheduler,
      runtimeDiagnosticsLogger
    });

    return {
      searchEngine,
      hybridSearchEngine,
      vectorSearchEngine,
      embeddingService,
      forgettingPolicyService,
      performanceMonitor,
      databaseOptimizer,
      errorLoggingService,
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
