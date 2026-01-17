/**
 * 공용 부트스트랩 함수
 * HTTP 서버와 MCP 서버가 공통으로 사용하는 서비스 초기화 로직
 */

import Database from 'better-sqlite3';
import { mementoConfig } from '../shared/config/index.js';
import { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { HybridSearchFactory } from '../domains/search/factories/hybrid-search.factory.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import { ForgettingPolicyService } from '../domains/forgetting/services/forgetting-policy-service.js';
import { getPerformanceMonitor } from '../domains/monitoring/services/performance-monitor.js';
import { DatabaseOptimizer } from '../infrastructure/database/database-optimizer.js';
import { ErrorLoggingService } from '../domains/monitoring/services/error-logging-service.js';
import { PerformanceAlertService } from '../domains/monitoring/services/performance-alert-service.js';
import { ConsolidationScoreService } from '../infrastructure/consolidation-score-service.js';
import { WriteCoalescingManager, type CoalescedWrite } from '../shared/utils/write-coalescing.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import { AnchorManager } from '../services/anchor-manager.js';
import { FailureDetector } from '../domains/monitoring/services/failure-detector.js';
import { ReflexionWorker } from '../infrastructure/reflexion-worker.js';
import { getVectorSearchEngine } from '../domains/search/algorithms/vector-search-engine.js';
import { logger } from '../shared/utils/logger.js';
import { WalCheckpointScheduler } from '../infrastructure/database/wal-checkpoint-scheduler.js';
import { DatabaseLockMonitor } from '../infrastructure/database/database-lock-monitor.js';
import { MetaMemoryService } from '../services/meta-memory-service.js';
import type { SqlParam } from '../shared/types/index.js';

/**
 * 서버 서비스 집합 인터페이스
 * 
 * 필수 서비스:
 * - searchEngine: 기본 텍스트 검색 엔진
 * - hybridSearchEngine: 하이브리드 검색 엔진 (텍스트 + 벡터)
 * - embeddingService: 메모리 임베딩 서비스
 * - forgettingPolicyService: 망각 정책 서비스
 * - performanceMonitor: 성능 모니터링 서비스 (싱글톤)
 * - databaseOptimizer: 데이터베이스 최적화 서비스
 * - errorLoggingService: 에러 로깅 서비스
 * - performanceAlertService: 성능 알림 서비스
 * 
 * 선택적 서비스 (기능 플래그에 따라 초기화):
 * - consolidationScoreService: 통합 점수 서비스
 * - writeCoalescingManager: 쓰기 결합 관리자
 * - metaMemoryService: 메타 메모리 통계 서비스
 */
export interface ServerServices {
  // 필수 서비스
  searchEngine: SearchEngine;
  hybridSearchEngine: HybridSearchEngine;
  embeddingService: MemoryEmbeddingService;
  forgettingPolicyService: ForgettingPolicyService;
  performanceMonitor: ReturnType<typeof getPerformanceMonitor>; // 싱글톤 인스턴스
  databaseOptimizer: DatabaseOptimizer;
  errorLoggingService: ErrorLoggingService;
  performanceAlertService: PerformanceAlertService;
  
  // 선택적 서비스
  consolidationScoreService?: ConsolidationScoreService;
  // writeCoalescingManager는 MetaMemoryService를 위해 항상 생성됨
  writeCoalescingManager: WriteCoalescingManager;
  // metaMemoryService는 recall 통계 수집을 위해 항상 초기화됨
  metaMemoryService: MetaMemoryService;
  // 앵커 관리자 서비스
  anchorManager: AnchorManager;
  // 실패 감지 서비스 (Phase 2)
  failureDetector: FailureDetector;
  // Reflexion Worker 서비스 (Phase 2)
  reflexionWorker?: ReflexionWorker;
  // WAL 체크포인트 스케줄러
  walCheckpointScheduler: WalCheckpointScheduler;
  // 데이터베이스 락 모니터
  databaseLockMonitor: DatabaseLockMonitor;
}

/**
 * 모든 서비스를 초기화하는 공용 부트스트랩 함수
 * 
 * 서비스 초기화 순서:
 * 1. 기본 서비스 초기화 (검색 엔진, 임베딩 서비스)
 * 2. 고급 서비스 초기화 (성능 모니터, 에러 로깅, 알림)
 * 3. PerformanceMonitor 싱글톤 처리 및 DB 초기화
 * 4. 선택적 서비스 초기화 (Consolidation Score, Write Coalescing)
 * 
 * 에러 처리:
 * - 서비스 초기화 실패 시 예외를 그대로 전파 (서버 시작 실패)
 * - 부분 실패 방지 (all-or-nothing)
 * 
 * @param db 데이터베이스 인스턴스
 * @returns 초기화된 서비스 집합
 * @throws 서비스 초기화 실패 시 예외 발생
 */
export async function initializeServices(db: Database.Database): Promise<ServerServices> {
  try {
    // 1. 기본 서비스 초기화 (검색 엔진, 임베딩 서비스)
    const searchEngine = new SearchEngine();
    const hybridSearchEngine = HybridSearchFactory.createDefaultEngine(db);
    const embeddingService = new MemoryEmbeddingService();
    
    // 2. 고급 서비스 초기화 (성능 모니터, 에러 로깅, 알림)
    const forgettingPolicyService = new ForgettingPolicyService();
    const databaseOptimizer = new DatabaseOptimizer(db);
    const errorLoggingService = new ErrorLoggingService();
    const performanceAlertService = new PerformanceAlertService('./logs');
    
    // 2.5. 앵커 관리자 서비스 초기화
    const anchorManager = new AnchorManager();
    anchorManager.setDatabase(db);
    anchorManager.setEmbeddingService(embeddingService);
    anchorManager.setHybridSearchEngine(hybridSearchEngine);
    anchorManager.setVectorSearchEngine(getVectorSearchEngine());
    
    // 서버 시작 시 DB에서 앵커 상태 복원
    await anchorManager.restoreCacheFromDB(db);
    
    // 2.6. 실패 감지 서비스 초기화 (Phase 2)
    const failureDetector = new FailureDetector();
    await failureDetector.startQueue(); // 큐 시작
    
    // 2.7. Reflexion Worker 초기화 (Phase 2)
    const reflexionWorker = new ReflexionWorker(failureDetector, db);
    await reflexionWorker.start(); // Worker 시작
    
    // 3. PerformanceMonitor 싱글톤 처리 및 DB 초기화
    const performanceMonitor = getPerformanceMonitor();
    performanceMonitor.initialize(db);
    
    // 3.5. WAL 체크포인트 스케줄러 초기화
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
    
    // 3.6. 데이터베이스 락 모니터 초기화
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
    
    // 스케줄러 및 모니터 시작
    walCheckpointScheduler.start();
    databaseLockMonitor.start();
    
    logger.info('WAL 체크포인트 스케줄러 및 데이터베이스 락 모니터 시작됨');
    
    // 4. 선택적 서비스 초기화 (Consolidation Score, Write Coalescing)
    let consolidationScoreService: ConsolidationScoreService | undefined;
    
    // Write Coalescing Manager는 MetaMemoryService를 위해 항상 생성
    // consolidationScoreEnabled가 true일 때는 consolidation score 관련 flush 로직 포함
    // false일 때는 meta memory stats만 업데이트하는 간단한 flush 로직 사용
    const writeCoalescingManager = new WriteCoalescingManager(
      1000, // 1초마다 flush
      async (writes: CoalescedWrite[]) => {
        // 배치 업데이트 실행
        if (!db || writes.length === 0) {
          return;
        }

        // db가 null이 아님을 확인했지만 TypeScript가 인식하지 못하므로 명시적 체크
        const currentDb = db;
        if (!currentDb) {
          return;
        }

        try {
          // 트랜잭션으로 배치 업데이트
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
              
              // consolidationScoreEnabled가 true일 때만 consolidation score 관련 필드 업데이트
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
          // 에러 로깅 (하지만 검색 결과는 정상 반환되어야 함)
          logger.error(`⚠️ Write coalescing flush 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
    
    if (mementoConfig.consolidationScoreEnabled) {
      consolidationScoreService = new ConsolidationScoreService();
    }
    
    // 4.5. MetaMemoryService 초기화 (WriteCoalescingManager와 함께)
    // MetaMemoryService는 writeCoalescingManager를 선택적으로 받을 수 있지만,
    // consolidationScoreEnabled가 활성화되어 있으면 공유된 writeCoalescingManager를 사용
    // MetaMemoryService는 항상 초기화되며, recall 통계 수집을 위해 필수적입니다.
    let metaMemoryService: MetaMemoryService;
    try {
      metaMemoryService = new MetaMemoryService(
        db,
        writeCoalescingManager // 공유된 WriteCoalescingManager 전달 (없으면 자체 생성)
      );
      logger.info('MetaMemoryService 초기화 완료');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`MetaMemoryService 초기화 실패: ${errorMessage}`);
      throw new Error(`MetaMemoryService 초기화 실패: ${errorMessage}`);
    }
    
    return {
      searchEngine,
      hybridSearchEngine,
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
    // 서비스 초기화 실패 시 예외를 그대로 전파 (서버 시작 실패)
    // 에러 메시지에 컨텍스트 추가
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`서비스 초기화 실패: ${errorMessage}`);
  }
}

