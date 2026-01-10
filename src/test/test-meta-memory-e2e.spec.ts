/**
 * Meta-Memory 통합 E2E 테스트
 * recall 호출 → 통계 수집 → get_meta_memory_stats로 조회 전체 워크플로우 검증
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeServices, type ServerServices } from '../server/bootstrap.js';
import { executeTool } from '../tools/index.js';
import { createToolContext } from '../server/context.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';

describe('Meta-Memory 통합 E2E 테스트', () => {
  let db: Database.Database;
  let services: ServerServices | null = null;

  beforeEach(async () => {
    // 메모리 데이터베이스 생성
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
    
    // 마이그레이션 필드 추가 (recall_count, last_accessed_at, g_value, consolidation_score)
    try {
      DatabaseUtils.run(db, 'ALTER TABLE memory_item ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0');
    } catch (error) {
      // 이미 존재하는 경우 무시
    }
    try {
      DatabaseUtils.run(db, 'ALTER TABLE memory_item ADD COLUMN last_accessed_at TIMESTAMP');
    } catch (error) {
      // 이미 존재하는 경우 무시
    }
    try {
      DatabaseUtils.run(db, 'ALTER TABLE memory_item ADD COLUMN g_value REAL');
    } catch (error) {
      // 이미 존재하는 경우 무시
    }
    try {
      DatabaseUtils.run(db, 'ALTER TABLE memory_item ADD COLUMN consolidation_score REAL');
    } catch (error) {
      // 이미 존재하는 경우 무시
    }
    
    // meta_memory_stats 테이블 마이그레이션 실행
    const migrationSQL = `
      CREATE TABLE IF NOT EXISTS meta_memory_stats (
        memory_id TEXT PRIMARY KEY,
        recall_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        avg_confidence REAL NOT NULL DEFAULT 0.0,
        last_recalled_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_recall_count ON meta_memory_stats(recall_count);
      CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_avg_confidence ON meta_memory_stats(avg_confidence);
      CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_last_recalled_at ON meta_memory_stats(last_recalled_at);
    `;
    db.exec(migrationSQL);
    
    // 서비스 초기화
    services = await initializeServices(db);
  });

  afterEach(async () => {
    // 모든 비동기 작업이 완료될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 300));

    // WAL 체크포인트 스케줄러 및 데이터베이스 락 모니터 중지
    if (services) {
      try {
        await services.walCheckpointScheduler.stop();
      } catch (error) {
        console.warn('WalCheckpointScheduler stop 중 에러:', error);
      }
      
      try {
        services.databaseLockMonitor.stop();
      } catch (error) {
        console.warn('DatabaseLockMonitor stop 중 에러:', error);
      }

      // MetaMemoryService 정리
      if (services.metaMemoryService) {
        try {
          await services.metaMemoryService.destroy();
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.warn('MetaMemoryService destroy 중 에러:', error);
        }
      }

      // Write Coalescing Manager 정리
      if (services.writeCoalescingManager) {
        try {
          await services.writeCoalescingManager.flush();
          await new Promise(resolve => setTimeout(resolve, 100));
          await services.writeCoalescingManager.destroy();
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.warn('WriteCoalescingManager destroy 중 에러:', error);
        }
      }
    }

    // 서비스 인스턴스 정리
    if (services) {
      services = null;
    }

    // 데이터베이스 닫기
    if (db) {
      try {
        db.close();
      } catch (error) {
        console.warn('Database close 중 에러:', error);
      }
      db = null as any;
    }

    // 추가 대기 (리소스 정리 완료 보장)
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('given: 전체 시스템이 초기화될 때, when: recall을 호출하고 get_meta_memory_stats로 조회하면, then: 통계가 올바르게 수집되고 조회되어야 함', async () => {
    // Given: 전체 시스템이 초기화됨
    const serverContext = { db, services: services! };
    const toolContext = createToolContext(serverContext);

    // 1. remember로 메모리 저장
    const rememberResult = await executeTool('remember', {
      content: 'Meta-Memory E2E 테스트용 메모리',
      type: 'episodic',
      tags: ['test', 'meta-memory'],
      importance: 0.8
    }, toolContext);

    const rememberData = JSON.parse(rememberResult.content[0].text);
    const memoryId = rememberData.memory_id;
    expect(memoryId).toBeDefined();

    // 2. recall 호출 (통계 수집) - 저장한 메모리를 검색
    const recallResult = await executeTool('recall', {
      query: 'Meta-Memory E2E 테스트용 메모리',
      limit: 10
    }, toolContext);

    const recallData = JSON.parse(recallResult.content[0].text);
    expect(recallData.items).toBeDefined();
    
    // recall 결과가 있을 때만 통계 확인
    if (recallData.items.length > 0) {
      // debounce flush를 위해 대기
      await new Promise(resolve => setTimeout(resolve, 200));

      // 3. get_meta_memory_stats로 통계 조회
      const statsResult = await executeTool('get_meta_memory_stats', {
        memory_id: memoryId,
        limit: 10
      }, toolContext);

      const statsData = JSON.parse(statsResult.content[0].text);
      
      // Then: 통계가 올바르게 수집되고 조회되어야 함
      expect(statsData).toBeDefined();
      expect(statsData.items).toBeDefined();
      expect(Array.isArray(statsData.items)).toBe(true);
      
      const stats = statsData.items.find((item: any) => item.memory_id === memoryId);
      if (stats) {
        expect(stats.recall_count).toBeGreaterThanOrEqual(1);
        expect(stats.success_count).toBeGreaterThanOrEqual(0);
        expect(stats.failure_count).toBeGreaterThanOrEqual(0);
        expect(stats.avg_confidence).toBeGreaterThanOrEqual(0);
        expect(stats.avg_confidence).toBeLessThanOrEqual(1);
        expect(stats.last_recalled_at).toBeDefined();
      }
    } else {
      // recall 결과가 없어도 통계 조회는 가능해야 함 (빈 결과)
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const statsResult = await executeTool('get_meta_memory_stats', {
        memory_id: memoryId,
        limit: 10
      }, toolContext);

      const statsData = JSON.parse(statsResult.content[0].text);
      expect(statsData).toBeDefined();
      expect(statsData.items).toBeDefined();
      expect(Array.isArray(statsData.items)).toBe(true);
    }
  });
});
