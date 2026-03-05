/**
 * ToolContext에 metaMemoryService 주입 테스트
 * createToolContext 함수가 metaMemoryService를 포함하는지 확인
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createToolContext, createServerContext } from '../context.js';
import { initializeServices, type ServerServices } from '../bootstrap.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../shared/utils/database.js';
import type { ToolContext } from '../../tools/types.js';

describe('ToolContext에 metaMemoryService 주입', () => {
  let db: Database.Database;
  let services: ServerServices | null = null;

  beforeEach(() => {
    // 메모리 데이터베이스 생성
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
    services = null;
  });

  afterEach(async () => {
    // 모든 비동기 작업이 완료될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 200));

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

  it('given: ToolContext가 생성될 때, when: services를 확인하면, then: metaMemoryService가 포함되어야 함', async () => {
    // Given: 서비스 초기화 및 ServerContext 생성
    services = await initializeServices(db);
    const serverContext = createServerContext(db, services);

    // When: ToolContext 생성
    const toolContext: ToolContext = createToolContext(serverContext);

    // Then: metaMemoryService가 포함되어야 함
    expect(toolContext).toBeDefined();
    expect(toolContext.services).toBeDefined();
    expect(toolContext.services.metaMemoryService).toBeDefined();
    expect(toolContext.services.metaMemoryService).not.toBeNull();
    
    // MetaMemoryService 인스턴스인지 확인
    expect(toolContext.services.metaMemoryService).toHaveProperty('recordRecall');
    expect(toolContext.services.metaMemoryService).toHaveProperty('getStats');
    expect(toolContext.services.metaMemoryService).toHaveProperty('getStatsById');
  });

  it('given: ToolContext가 생성되었을 때, when: metaMemoryService를 사용하면, then: 정상적으로 동작해야 함', async () => {
    // Given: 서비스 초기화 및 ToolContext 생성
    services = await initializeServices(db);
    const serverContext = createServerContext(db, services);
    const toolContext: ToolContext = createToolContext(serverContext);

    // When: metaMemoryService 사용
    // Then: 정상적으로 동작해야 함
    const metaMemoryService = toolContext.services.metaMemoryService;
    expect(metaMemoryService).toBeDefined();
    
    // getStats 메서드 호출 가능한지 확인 (빈 결과 반환)
    const stats = await metaMemoryService!.getStats({ limit: 10 });
    expect(stats).toBeDefined();
    expect(stats.items).toBeDefined();
    expect(Array.isArray(stats.items)).toBe(true);
    expect(stats.total_count).toBeDefined();
  });
});
