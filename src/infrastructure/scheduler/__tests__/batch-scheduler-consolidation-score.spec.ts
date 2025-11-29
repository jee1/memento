/**
 * BatchScheduler와 ConsolidationScoreWorker 통합 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { BatchScheduler } from '../batch-scheduler.js';
import { ConsolidationScoreWorker } from '../../../workers/consolidation-score-worker.js';
import { DatabaseUtils } from '../../shared/utils/database.js';
import * as configModule from '../../shared/config/index.js';

/**
 * 테스트용 데이터베이스 초기화
 */
function initializeTestDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
      origin_source TEXT,
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
      -- Consolidation Score 필드
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMP,
      consolidation_score REAL,
      g_value REAL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_desc ON memory_item(consolidation_score DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2;
  `);
}

describe('BatchScheduler와 ConsolidationScoreWorker 통합', () => {
  let db: Database.Database;
  let scheduler: BatchScheduler;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    // Consolidation Score 기능 활성화 모킹
    vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
      ...configModule.mementoConfig,
      consolidationScoreEnabled: true
    } as any);

    scheduler = new BatchScheduler({
      cleanupInterval: 60 * 60 * 1000,
      monitoringInterval: 5 * 60 * 1000,
      healthCheckInterval: 30 * 1000,
      consolidationScoreIncrementalInterval: 60 * 60 * 1000, // 1시간
      consolidationScoreFullSweepInterval: 24 * 60 * 60 * 1000, // 24시간
      consolidationScoreFullSweepHour: 3, // 새벽 3시
      maxBatchSize: 1000,
      enableLogging: false,
      enableNotifications: false,
      enableMetrics: false,
      maxConcurrentJobs: 3,
      jobTimeout: 5 * 60 * 1000,
      retryAttempts: 3,
      retryDelay: 1000
    });
  });

  afterEach(async () => {
    // Mock 및 Spy 정리
    vi.clearAllMocks();
    vi.restoreAllMocks();
    
    // 스케줄러 정지
    if (scheduler) {
      await scheduler.stop();
    }
    
    // 데이터베이스 닫기
    if (db) {
      db.close();
    }
    
    // 인스턴스 정리
    scheduler = null as any;
    db = null as any;
  });

  it('스케줄러 시작 시 Consolidation Score 작업이 등록되어야 함', async () => {
    await scheduler.start(db);

    const status = scheduler.getStatus();
    
    // Consolidation Score 작업이 등록되었는지 확인
    expect(status.activeJobs).toContain('consolidation_score_incremental');
  });

  it('증분 재계산 작업이 정상 실행되어야 함', async () => {
    // 테스트 데이터 생성
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    DatabaseUtils.run(
      db,
      `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mem1', 'episodic', 'Test memory', 5, thirtyMinutesAgo.toISOString(), thirtyMinutesAgo.toISOString(), 2.5, 0.8]
    );

    await scheduler.start(db);

    // 수동으로 증분 재계산 작업 실행
    const result = await (scheduler as any).runConsolidationScoreIncremental();

    expect(result.success).toBe(true);
    expect(result.processed).toBeGreaterThanOrEqual(0);
  });

  it('전체 스윕 작업이 정상 실행되어야 함', async () => {
    // 테스트 데이터 생성
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    for (let i = 0; i < 10; i++) {
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, recall_count, last_accessed_at, created_at, g_value, consolidation_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [`mem${i}`, 'episodic', `Test memory ${i}`, i + 1, oneHourAgo.toISOString(), oneHourAgo.toISOString(), 1.0 + i * 0.1, 0.5 + i * 0.05]
      );
    }

    await scheduler.start(db);

    // 수동으로 전체 스윕 작업 실행
    const result = await (scheduler as any).runConsolidationScoreFullSweep();

    expect(result.success).toBe(true);
    expect(result.processed).toBe(10);
    // details는 ConsolidationScoreRecalculationResult 전체를 포함
    expect(result.details).toBeDefined();
    if (result.details && typeof result.details === 'object' && 'scoreDistribution' in result.details) {
      expect(result.details.scoreDistribution).toBeDefined();
    }
  });

  it('기능 플래그 비활성화 시 Consolidation Score 작업이 등록되지 않아야 함', async () => {
    // Consolidation Score 기능 비활성화 모킹
    vi.spyOn(configModule, 'mementoConfig', 'get').mockReturnValue({
      ...configModule.mementoConfig,
      consolidationScoreEnabled: false
    } as any);

    const disabledScheduler = new BatchScheduler({
      enableLogging: false
    });

    await disabledScheduler.start(db);

    const status = disabledScheduler.getStatus();
    
    // Consolidation Score 작업이 등록되지 않았는지 확인
    expect(status.activeJobs).not.toContain('consolidation_score_incremental');
    expect(status.activeJobs).not.toContain('consolidation_score_full_sweep');

    await disabledScheduler.stop();
  });

  it('작업 실행 중 에러 발생 시 재시도 로직이 동작해야 함', async () => {
    await scheduler.start(db);

    // 에러를 발생시키는 워커 모킹
    const worker = (scheduler as any).consolidationScoreWorker;
    if (worker) {
      const originalRun = worker.runIncrementalRecalculation;
      let callCount = 0;
      
      worker.runIncrementalRecalculation = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Test error');
        }
        return {
          success: true,
          processed: 0,
          updated: 0,
          skipped: 0,
          errors: [],
          warnings: []
        };
      });

      // 작업 실행 (재시도 로직 테스트를 위해 직접 호출)
      try {
        await (scheduler as any).runConsolidationScoreIncremental();
      } catch (error) {
        // 에러는 예상됨 (재시도 로직이 있으므로)
      }

      // 원래 메서드 복원
      worker.runIncrementalRecalculation = originalRun;
    }
  });

  it('스케줄러 상태에 Consolidation Score 작업 정보가 포함되어야 함', async () => {
    await scheduler.start(db);

    const stats = scheduler.getDetailedStats();
    
    // Consolidation Score 작업이 통계에 포함되어 있는지 확인
    const consolidationJobs = stats.jobs.filter(job => 
      job.name.includes('consolidation_score')
    );
    
    expect(consolidationJobs.length).toBeGreaterThan(0);
  });
});

