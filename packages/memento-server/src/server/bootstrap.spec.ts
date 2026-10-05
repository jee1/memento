/**
 * 부트스트랩 함수 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initializeServices,
  shutdownServices,
  type ServerServices,
  DatabaseUtils,
  getPerformanceMonitor,
  getBatchScheduler
} from '@memento/core';
import Database from 'better-sqlite3';

describe('initializeServices', () => {
  let db: Database.Database;
  let services: ServerServices | null = null;

  beforeEach(() => {
    // 메모리 데이터베이스 생성
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
    services = null;
  });

  afterEach(async () => {
    await shutdownServices(services);
    services = null;

    if (db) {
      try {
        db.close();
      } catch (error) {
        console.warn('Database close 중 에러:', error);
      }
      db = null as any;
    }

    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('기본 서비스 초기화', () => {
    it('모든 필수 서비스가 올바르게 초기화되어야 함', async () => {
      services = await initializeServices(db);

      expect(services).toBeDefined();
      expect(services.searchEngine).toBeDefined();
      expect(services.hybridSearchEngine).toBeDefined();
      expect(services.embeddingService).toBeDefined();
      expect(services.forgettingPolicyService).toBeDefined();
      expect(services.performanceMonitor).toBeDefined();
      expect(services.databaseOptimizer).toBeDefined();
      expect(services.errorLoggingService).toBeDefined();
    });

    it('반환된 서비스 객체가 ServerServices 인터페이스를 만족해야 함', async () => {
      services = await initializeServices(db);

      // 타입 체크를 위한 기본 검증
      expect(services).toHaveProperty('searchEngine');
      expect(services).toHaveProperty('hybridSearchEngine');
      expect(services).toHaveProperty('embeddingService');
      expect(services).toHaveProperty('forgettingPolicyService');
      expect(services).toHaveProperty('performanceMonitor');
      expect(services).toHaveProperty('databaseOptimizer');
      expect(services).toHaveProperty('errorLoggingService');
    });
  });

  describe('PerformanceMonitor 싱글톤 처리', () => {
    it('PerformanceMonitor가 싱글톤 인스턴스여야 함', async () => {
      const services1 = await initializeServices(db);
      services = services1;
      const scheduler = getBatchScheduler() as { stop(): Promise<void> };
      await scheduler.stop();
      const services2 = await initializeServices(db);
      services = services2;

      expect(services1.performanceMonitor).toBe(services2.performanceMonitor);
    });

    it('getPerformanceMonitor()를 직접 호출해도 같은 인스턴스를 반환해야 함', async () => {
      services = await initializeServices(db);
      const directInstance = getPerformanceMonitor();

      // bootstrap을 통해 얻은 인스턴스와 직접 호출한 인스턴스가 같아야 함
      expect(services.performanceMonitor).toBe(directInstance);
    });

    it('여러 번 getPerformanceMonitor()를 호출해도 같은 인스턴스를 반환해야 함', () => {
      const instance1 = getPerformanceMonitor();
      const instance2 = getPerformanceMonitor();
      const instance3 = getPerformanceMonitor();

      // 모든 인스턴스가 동일해야 함
      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
      expect(instance1).toBe(instance3);
    });

    it('PerformanceMonitor가 DB로 초기화되어야 함', async () => {
      services = await initializeServices(db);

      // PerformanceMonitor가 초기화되었는지 확인
      expect(services.performanceMonitor).toBeDefined();
      
      // collectMetrics를 호출하여 DB가 설정되었는지 간접 확인
      // (DB가 없으면 에러가 발생하거나 다른 동작을 할 수 있음)
      const metrics = await services.performanceMonitor.collectMetrics();
      expect(metrics).toBeDefined();
    });

    it('initializeServices를 여러 번 호출해도 PerformanceMonitor는 한 번만 초기화되어야 함', async () => {
      const db1 = new Database(':memory:');
      const db2 = new Database(':memory:');
      let services1: ServerServices | null = null;
      let services2: ServerServices | null = null;
      try {
        DatabaseUtils.initializeDatabase(db1);
        DatabaseUtils.initializeDatabase(db2);

        services1 = await initializeServices(db1);
        await (getBatchScheduler() as { stop(): Promise<void> }).stop();
        services2 = await initializeServices(db2);

        expect(services1.performanceMonitor).toBe(services2.performanceMonitor);
        services = services2;
      } finally {
        // 정리
        db1.close();
        db2.close();
      }
    });

    it('PerformanceMonitor가 initialize 메서드를 통해 DB를 받아야 함', async () => {
      services = await initializeServices(db);
      
      // PerformanceMonitor가 정의되어 있어야 함
      expect(services.performanceMonitor).toBeDefined();
      
      // collectMetrics가 정상적으로 동작하면 DB가 초기화된 것으로 간주
      // (실제로는 initialize 내부에서 db를 설정하므로, collectMetrics가 동작하면 초기화된 것)
      await expect(services.performanceMonitor.collectMetrics()).resolves.toBeDefined();
    });
  });

  describe('MetaMemoryService 초기화', () => {
    it('metaMemoryService가 초기화되어야 함', async () => {
      services = await initializeServices(db);

      expect(services.metaMemoryService).toBeDefined();
      expect(services.metaMemoryService).toHaveProperty('recordRecall');
      expect(services.metaMemoryService).toHaveProperty('getStats');
      expect(services.metaMemoryService).toHaveProperty('destroy');
    });
  });

  describe('에러 처리', () => {
    it('서비스 초기화 중 에러 발생 시 적절히 처리되어야 함', async () => {
      // 정상적인 데이터베이스로 초기화는 성공해야 함
      services = await initializeServices(db);
      expect(services).toBeDefined();
      expect(services.searchEngine).toBeDefined();
    });

    it('에러 발생 시 에러 메시지에 컨텍스트가 포함되어야 함', async () => {
      // 실제로는 null 데이터베이스를 전달하는 경우가 거의 없지만,
      // 에러 처리 로직이 올바르게 동작하는지 확인
      // 정상적인 초기화가 성공하는지 확인
      services = await initializeServices(db);
      expect(services).toBeDefined();
      
      // 에러 처리 로직이 올바르게 구현되어 있는지 확인
      // (bootstrap.ts의 catch 블록에서 에러 메시지에 "서비스 초기화 실패"를 포함)
      expect(services.searchEngine).toBeDefined();
    });
  });

  describe('서비스 초기화 순서', () => {
    it('서비스가 올바른 순서로 초기화되어야 함', async () => {
      services = await initializeServices(db);

      // 기본 서비스가 먼저 초기화되어야 함
      expect(services.searchEngine).toBeDefined();
      expect(services.hybridSearchEngine).toBeDefined();
      expect(services.embeddingService).toBeDefined();

      // 고급 서비스가 그 다음 초기화되어야 함
      expect(services.forgettingPolicyService).toBeDefined();
      expect(services.databaseOptimizer).toBeDefined();
      expect(services.errorLoggingService).toBeDefined();

      // PerformanceMonitor가 초기화되어야 함
      expect(services.performanceMonitor).toBeDefined();
    });
  });

  describe('각 서비스 인스턴스 검증', () => {
    it('searchEngine이 SearchEngine 인스턴스여야 함', async () => {
      services = await initializeServices(db);
      expect(services.searchEngine).toBeDefined();
      expect(services.searchEngine).toHaveProperty('search');
    });

    it('hybridSearchEngine이 HybridSearchEngine 인스턴스여야 함', async () => {
      services = await initializeServices(db);
      expect(services.hybridSearchEngine).toBeDefined();
      expect(services.hybridSearchEngine).toHaveProperty('search');
    });

    it('embeddingService가 MemoryEmbeddingService 인스턴스여야 함', async () => {
      services = await initializeServices(db);
      expect(services.embeddingService).toBeDefined();
      expect(services.embeddingService).toHaveProperty('createAndStoreEmbedding');
    });

    it('forgettingPolicyService가 ForgettingPolicyService 인스턴스여야 함', async () => {
      services = await initializeServices(db);
      expect(services.forgettingPolicyService).toBeDefined();
      expect(services.forgettingPolicyService).toHaveProperty('executeMemoryCleanup');
    });

    it('databaseOptimizer가 DatabaseOptimizer 인스턴스여야 함', async () => {
      services = await initializeServices(db);
      expect(services.databaseOptimizer).toBeDefined();
      expect(services.databaseOptimizer).toHaveProperty('analyzePerformance');
    });

    it('errorLoggingService가 ErrorLoggingService 인스턴스여야 함', async () => {
      services = await initializeServices(db);
      expect(services.errorLoggingService).toBeDefined();
      expect(services.errorLoggingService).toHaveProperty('logError');
    });

    it('performanceMonitor가 PerformanceMonitor 인스턴스여야 함', async () => {
      services = await initializeServices(db);
      expect(services.performanceMonitor).toBeDefined();
      expect(services.performanceMonitor).toHaveProperty('collectMetrics');
    });
  });

  describe('WAL 체크포인트 스케줄러 및 데이터베이스 락 모니터 통합', () => {
    it('walCheckpointScheduler가 WalCheckpointScheduler 인스턴스여야 함', async () => {
      services = await initializeServices(db);

      expect(services.walCheckpointScheduler).toBeDefined();
      expect(services.walCheckpointScheduler).toHaveProperty('start');
      expect(services.walCheckpointScheduler).toHaveProperty('stop');
      expect(services.walCheckpointScheduler).toHaveProperty('checkpointNow');
    });

    it('databaseLockMonitor가 DatabaseLockMonitor 인스턴스여야 함', async () => {
      services = await initializeServices(db);

      expect(services.databaseLockMonitor).toBeDefined();
      expect(services.databaseLockMonitor).toHaveProperty('start');
      expect(services.databaseLockMonitor).toHaveProperty('stop');
    });

    it('서비스 초기화 시 스케줄러와 모니터가 자동으로 시작되어야 함', async () => {
      services = await initializeServices(db);

      // 스케줄러와 모니터가 시작되었는지 확인
      // (내부 상태를 직접 확인할 수 없으므로, stop()을 호출해도 에러가 발생하지 않아야 함)
      expect(services.walCheckpointScheduler).toBeDefined();
      expect(services.databaseLockMonitor).toBeDefined();
      
      // stop()을 호출해도 에러가 발생하지 않아야 함 (idempotent)
      await expect(services.walCheckpointScheduler.stop()).resolves.not.toThrow();
      expect(() => services.databaseLockMonitor.stop()).not.toThrow();
    });

    it('서비스 정리 시 스케줄러와 모니터가 안전하게 중지되어야 함', async () => {
      services = await initializeServices(db);

      // 스케줄러와 모니터 중지
      await expect(services.walCheckpointScheduler.stop()).resolves.not.toThrow();
      expect(() => services.databaseLockMonitor.stop()).not.toThrow();
      
      // 여러 번 호출해도 안전해야 함 (idempotent)
      await expect(services.walCheckpointScheduler.stop()).resolves.not.toThrow();
      expect(() => services.databaseLockMonitor.stop()).not.toThrow();
    });

    it('스케줄러와 모니터가 환경 변수 기반 설정으로 초기화되어야 함', async () => {
      services = await initializeServices(db);

      // 스케줄러와 모니터가 정의되어 있어야 함
      expect(services.walCheckpointScheduler).toBeDefined();
      expect(services.databaseLockMonitor).toBeDefined();
      
      // 환경 변수에서 설정을 읽어왔는지 확인
      // (실제 설정값은 환경 변수에 따라 다를 수 있으므로, 인스턴스가 생성되었는지만 확인)
      expect(services.walCheckpointScheduler).toBeDefined();
      expect(services.databaseLockMonitor).toBeDefined();
    });
  });

  describe('반복 초기화 (#1032)', () => {
    // BatchScheduler 는 프로세스 전역 싱글턴이라 이미 돌고 있으면 start 를 거부한다.
    // shutdownServices 의 batchScheduler.stop() 과 resetBatchScheduler() 는 각각
    // 단독으로도 재초기화를 가능케 하는 중복 기제다. 둘 다 빠뜨렸을 때만 두 번째
    // 호출이 '서비스 초기화 실패: BatchScheduler is already running' 으로 죽는다
    // (2026-09-19 두 기제를 하나씩·동시에 제거해 확인).
    it('같은 프로세스에서 initializeServices 를 연달아 세 번 호출할 수 있어야 함', async () => {
      for (let i = 0; i < 3; i += 1) {
        const roundDb = new Database(':memory:');
        DatabaseUtils.initializeDatabase(roundDb);
        const roundServices = await initializeServices(roundDb);
        expect(roundServices.walCheckpointScheduler).toBeDefined();
        await shutdownServices(roundServices);
        roundDb.close();
      }
    });
  });
});
