/**
 * MetaMemoryService 초기화 테스트
 * bootstrap.ts에서 MetaMemoryService가 올바르게 초기화되는지 확인
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeServices, type ServerServices } from '../bootstrap.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../shared/utils/database.js';

describe('MetaMemoryService 초기화', () => {
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

  it('given: bootstrap.ts에서 서비스를 초기화할 때, when: 서비스를 확인하면, then: MetaMemoryService 인스턴스가 생성되어야 함', async () => {
    // Given: bootstrap.ts에서 서비스 초기화
    services = await initializeServices(db);

    // When: 서비스 확인
    // Then: MetaMemoryService 인스턴스가 생성되어야 함
    expect(services).toBeDefined();
    expect(services.metaMemoryService).toBeDefined();
    expect(services.metaMemoryService).not.toBeNull();
    
    // MetaMemoryService 인스턴스인지 확인
    expect(services.metaMemoryService).toHaveProperty('recordRecall');
    expect(services.metaMemoryService).toHaveProperty('getStats');
    expect(services.metaMemoryService).toHaveProperty('getStatsById');
    expect(services.metaMemoryService).toHaveProperty('destroy');
  });

  it('given: MetaMemoryService가 초기화되었을 때, when: WriteCoalescingManager를 확인하면, then: WriteCoalescingManager가 설정되어야 함', async () => {
    // Given: 서비스 초기화
    services = await initializeServices(db);

    // When: WriteCoalescingManager 확인
    // Then: WriteCoalescingManager가 설정되어야 함
    // MetaMemoryService는 내부적으로 WriteCoalescingManager를 사용하므로,
    // writeCoalescingManager가 초기화되어 있어야 함
    expect(services.writeCoalescingManager).toBeDefined();
  });
});
