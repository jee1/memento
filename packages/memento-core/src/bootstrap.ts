/**
 * 공용 부트스트랩 함수
 * HTTP 서버와 MCP 서버가 공통으로 사용하는 서비스 초기화 로직
 * @memento/core 내부: createMementoCore에서 사용
 */

import Database from 'better-sqlite3';
import { mementoConfig } from './shared/config/index.js';
import { SearchEngine } from './domains/search/algorithms/search-engine.js';
import { HybridSearchEngine } from './domains/search/algorithms/hybrid-search-engine.js';
import { HybridSearchFactory } from './domains/search/factories/hybrid-search.factory.js';
import { MemoryEmbeddingService } from './domains/memory/services/memory-embedding-service.js';
import { ForgettingPolicyService } from './domains/forgetting/services/forgetting-policy-service.js';
import { getPerformanceMonitor } from './domains/monitoring/services/performance-monitor.js';
import { ErrorLoggingService } from './domains/monitoring/services/error-logging-service.js';
import { PerformanceAlertService } from './domains/monitoring/services/performance-alert-service.js';
import { WriteCoalescingManager, type CoalescedWrite } from './shared/utils/write-coalescing.js';
import { DatabaseUtils } from './shared/utils/database.js';
import { AnchorManager } from './domains/anchor/services/anchor/anchor-manager.js';
import { AnchorCacheService } from './domains/anchor/services/anchor/anchor-cache-service.js';
import { AnchorSearchService } from './domains/anchor/services/anchor/anchor-search-service.js';
import { FailureDetector } from './domains/monitoring/services/failure-detector.js';
import { AsyncTaskQueue } from './infrastructure/async-optimizer.js';
import type { IBatchScheduler } from './shared/interfaces/batch-scheduler.interface.js';
import type { IConsolidationScoreService } from './shared/interfaces/consolidation-score.interface.js';
import type { IDatabaseOptimizer } from './shared/interfaces/database-optimizer.interface.js';
import type { IReflexionWorker } from './shared/interfaces/reflexion-worker.interface.js';
import { DatabaseOptimizer } from './infrastructure/database/database-optimizer.js';
import { ConsolidationScoreService } from './infrastructure/consolidation-score-service.js';
import { ReflexionWorker } from './infrastructure/reflexion-worker.js';
import { getVectorSearchEngine } from './domains/search/algorithms/vector-search-engine.js';
import { logger } from './shared/utils/logger.js';
import { WalCheckpointScheduler } from './infrastructure/database/wal-checkpoint-scheduler.js';
import { DatabaseLockMonitor } from './infrastructure/database/database-lock-monitor.js';
import { MetaMemoryService } from './domains/memory/services/meta-memory-service.js';
import type { SqlParam } from './shared/types/index.js';

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
  failureDetector: FailureDetector;
  reflexionWorker?: IReflexionWorker;
  walCheckpointScheduler: WalCheckpointScheduler;
  databaseLockMonitor: DatabaseLockMonitor;
  vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>;
  batchScheduler?: IBatchScheduler;
}

export async function initializeServices(db: Database.Database): Promise<ServerServices> {
  try {
    const searchEngine = new SearchEngine();
    const hybridSearchEngine = HybridSearchFactory.createDefaultEngine(db);
    const embeddingService = new MemoryEmbeddingService();
    const forgettingPolicyService = new ForgettingPolicyService();
    const databaseOptimizer = new DatabaseOptimizer(db);
    const errorLoggingService = new ErrorLoggingService();
    const performanceAlertService = new PerformanceAlertService('./logs');
    const anchorCacheService = new AnchorCacheService(db, embeddingService);
    const vectorSearchEngine = getVectorSearchEngine();
    const anchorSearchService = new AnchorSearchService(anchorCacheService, {
      db,
      hybridSearchEngine,
      vectorSearchEngine
    });
    const anchorManager = new AnchorManager(anchorCacheService, anchorSearchService, {
      db,
      errorLoggingService
    });
    await anchorCacheService.restoreCacheFromDB(db);
    const failureEventQueue = new AsyncTaskQueue(5);
    const failureDetector = new FailureDetector(failureEventQueue);
    await failureDetector.startQueue();
    const reflexionWorker = new ReflexionWorker(failureDetector, db);
    await reflexionWorker.start();
    const performanceMonitor = getPerformanceMonitor();
    performanceMonitor.initialize(db);
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
      performanceMonitor
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
      walCheckpointScheduler
    );
    walCheckpointScheduler.start();
    databaseLockMonitor.start();
    logger.info('WAL 체크포인트 스케줄러 및 데이터베이스 락 모니터 시작됨');
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
      failureDetector,
      reflexionWorker,
      walCheckpointScheduler,
      databaseLockMonitor
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`서비스 초기화 실패: ${errorMessage}`);
  }
}
