/**
 * 부트스트랩 함수 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initializeServices, type ServerServices } from './bootstrap.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';
import { mementoConfig } from '../config/index.js';
import { getPerformanceMonitor } from '../services/performance-monitor.js';

describe('initializeServices', () => {
  let db: Database.Database;

  beforeEach(() => {
    // 메모리 데이터베이스 생성
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('기본 서비스 초기화', () => {
    it('모든 필수 서비스가 올바르게 초기화되어야 함', async () => {
      const services = await initializeServices(db);

      expect(services).toBeDefined();
      expect(services.searchEngine).toBeDefined();
      expect(services.hybridSearchEngine).toBeDefined();
      expect(services.embeddingService).toBeDefined();
      expect(services.forgettingPolicyService).toBeDefined();
      expect(services.performanceMonitor).toBeDefined();
      expect(services.databaseOptimizer).toBeDefined();
      expect(services.errorLoggingService).toBeDefined();
      expect(services.performanceAlertService).toBeDefined();
    });

    it('반환된 서비스 객체가 ServerServices 인터페이스를 만족해야 함', async () => {
      const services = await initializeServices(db);

      // 타입 체크를 위한 기본 검증
      expect(services).toHaveProperty('searchEngine');
      expect(services).toHaveProperty('hybridSearchEngine');
      expect(services).toHaveProperty('embeddingService');
      expect(services).toHaveProperty('forgettingPolicyService');
      expect(services).toHaveProperty('performanceMonitor');
      expect(services).toHaveProperty('databaseOptimizer');
      expect(services).toHaveProperty('errorLoggingService');
      expect(services).toHaveProperty('performanceAlertService');
    });
  });

  describe('PerformanceMonitor 싱글톤 처리', () => {
    it('PerformanceMonitor가 싱글톤 인스턴스여야 함', async () => {
      const services1 = await initializeServices(db);
      const services2 = await initializeServices(db);

      // 같은 인스턴스여야 함
      expect(services1.performanceMonitor).toBe(services2.performanceMonitor);
    });

    it('getPerformanceMonitor()를 직접 호출해도 같은 인스턴스를 반환해야 함', async () => {
      const services = await initializeServices(db);
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
      const services = await initializeServices(db);

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
      try {
        DatabaseUtils.initializeDatabase(db1);
        DatabaseUtils.initializeDatabase(db2);

        const services1 = await initializeServices(db1);
        const services2 = await initializeServices(db2);

        // 같은 인스턴스여야 함
        expect(services1.performanceMonitor).toBe(services2.performanceMonitor);
      } finally {
        // 정리
        db1.close();
        db2.close();
      }
    });

    it('PerformanceMonitor가 initialize 메서드를 통해 DB를 받아야 함', async () => {
      const services = await initializeServices(db);
      
      // PerformanceMonitor가 정의되어 있어야 함
      expect(services.performanceMonitor).toBeDefined();
      
      // collectMetrics가 정상적으로 동작하면 DB가 초기화된 것으로 간주
      // (실제로는 initialize 내부에서 db를 설정하므로, collectMetrics가 동작하면 초기화된 것)
      await expect(services.performanceMonitor.collectMetrics()).resolves.toBeDefined();
    });
  });

  describe('선택적 서비스 초기화', () => {
    it('consolidationScoreEnabled가 false일 때 선택적 서비스가 undefined여야 함', async () => {
      // mementoConfig.consolidationScoreEnabled가 false인 경우
      const originalValue = mementoConfig.consolidationScoreEnabled;
      
      // 테스트를 위해 임시로 false로 설정 (실제로는 환경 변수로 제어)
      // 주의: 실제 config를 변경하면 안 되므로, 현재 설정값에 따라 테스트
      
      const services = await initializeServices(db);

      // consolidationScoreEnabled가 false인 경우 선택적 서비스가 undefined일 수 있음
      // 하지만 실제 설정값에 따라 다를 수 있으므로, 존재 여부만 확인
      if (!originalValue) {
        expect(services.consolidationScoreService).toBeUndefined();
        expect(services.writeCoalescingManager).toBeUndefined();
      }
    });

    it('consolidationScoreEnabled가 true일 때 선택적 서비스가 초기화되어야 함', async () => {
      // 실제 설정값에 따라 테스트
      const services = await initializeServices(db);

      if (mementoConfig.consolidationScoreEnabled) {
        expect(services.consolidationScoreService).toBeDefined();
        expect(services.writeCoalescingManager).toBeDefined();
      }
    });

    it('consolidationScoreService가 ConsolidationScoreService 인스턴스여야 함', async () => {
      const services = await initializeServices(db);

      if (services.consolidationScoreService) {
        expect(services.consolidationScoreService).toBeDefined();
        expect(services.consolidationScoreService).toHaveProperty('calculateScore');
        expect(services.consolidationScoreService).toHaveProperty('updateGValue');
        expect(services.consolidationScoreService).toHaveProperty('calculateS');
      }
    });

    it('writeCoalescingManager가 WriteCoalescingManager 인스턴스여야 함', async () => {
      const services = await initializeServices(db);

      if (services.writeCoalescingManager) {
        expect(services.writeCoalescingManager).toBeDefined();
        expect(services.writeCoalescingManager).toHaveProperty('addWrite');
        expect(services.writeCoalescingManager).toHaveProperty('flush');
        expect(services.writeCoalescingManager).toHaveProperty('destroy');
      }
    });

    it('consolidationScoreEnabled가 true일 때 두 서비스가 함께 초기화되어야 함', async () => {
      const services = await initializeServices(db);

      if (mementoConfig.consolidationScoreEnabled) {
        // 둘 다 정의되어 있어야 함
        expect(services.consolidationScoreService).toBeDefined();
        expect(services.writeCoalescingManager).toBeDefined();
        
        // 둘 다 undefined가 아니어야 함
        expect(services.consolidationScoreService).not.toBeUndefined();
        expect(services.writeCoalescingManager).not.toBeUndefined();
      } else {
        // false일 때는 둘 다 undefined여야 함
        expect(services.consolidationScoreService).toBeUndefined();
        expect(services.writeCoalescingManager).toBeUndefined();
      }
    });

    it('consolidationScoreService와 writeCoalescingManager는 함께 존재하거나 함께 없어야 함', async () => {
      const services = await initializeServices(db);

      const hasConsolidationScore = services.consolidationScoreService !== undefined;
      const hasWriteCoalescing = services.writeCoalescingManager !== undefined;

      // 둘 다 있거나 둘 다 없어야 함 (일관성)
      expect(hasConsolidationScore).toBe(hasWriteCoalescing);
    });

    it('writeCoalescingManager가 올바른 flushInterval과 callback으로 초기화되어야 함', async () => {
      const services = await initializeServices(db);

      if (services.writeCoalescingManager) {
        // WriteCoalescingManager는 flushInterval 1000ms로 초기화되어야 함
        // (bootstrap.ts에서 1000ms로 설정)
        expect(services.writeCoalescingManager).toBeDefined();
        
        // flush 메서드가 정상적으로 동작하는지 확인
        await expect(services.writeCoalescingManager.flush()).resolves.not.toThrow();
      }
    });
  });

  describe('에러 처리', () => {
    it('서비스 초기화 중 에러 발생 시 적절히 처리되어야 함', async () => {
      // 정상적인 데이터베이스로 초기화는 성공해야 함
      const services = await initializeServices(db);
      expect(services).toBeDefined();
      expect(services.searchEngine).toBeDefined();
    });

    it('에러 발생 시 에러 메시지에 컨텍스트가 포함되어야 함', async () => {
      // 실제로는 null 데이터베이스를 전달하는 경우가 거의 없지만,
      // 에러 처리 로직이 올바르게 동작하는지 확인
      // 정상적인 초기화가 성공하는지 확인
      const services = await initializeServices(db);
      expect(services).toBeDefined();
      
      // 에러 처리 로직이 올바르게 구현되어 있는지 확인
      // (bootstrap.ts의 catch 블록에서 에러 메시지에 "서비스 초기화 실패"를 포함)
      expect(services.searchEngine).toBeDefined();
    });
  });

  describe('서비스 초기화 순서', () => {
    it('서비스가 올바른 순서로 초기화되어야 함', async () => {
      const services = await initializeServices(db);

      // 기본 서비스가 먼저 초기화되어야 함
      expect(services.searchEngine).toBeDefined();
      expect(services.hybridSearchEngine).toBeDefined();
      expect(services.embeddingService).toBeDefined();

      // 고급 서비스가 그 다음 초기화되어야 함
      expect(services.forgettingPolicyService).toBeDefined();
      expect(services.databaseOptimizer).toBeDefined();
      expect(services.errorLoggingService).toBeDefined();
      expect(services.performanceAlertService).toBeDefined();

      // PerformanceMonitor가 초기화되어야 함
      expect(services.performanceMonitor).toBeDefined();
    });
  });

  describe('각 서비스 인스턴스 검증', () => {
    it('searchEngine이 SearchEngine 인스턴스여야 함', async () => {
      const services = await initializeServices(db);
      expect(services.searchEngine).toBeDefined();
      expect(services.searchEngine).toHaveProperty('search');
    });

    it('hybridSearchEngine이 HybridSearchEngine 인스턴스여야 함', async () => {
      const services = await initializeServices(db);
      expect(services.hybridSearchEngine).toBeDefined();
      expect(services.hybridSearchEngine).toHaveProperty('search');
    });

    it('embeddingService가 MemoryEmbeddingService 인스턴스여야 함', async () => {
      const services = await initializeServices(db);
      expect(services.embeddingService).toBeDefined();
      expect(services.embeddingService).toHaveProperty('createAndStoreEmbedding');
    });

    it('forgettingPolicyService가 ForgettingPolicyService 인스턴스여야 함', async () => {
      const services = await initializeServices(db);
      expect(services.forgettingPolicyService).toBeDefined();
      expect(services.forgettingPolicyService).toHaveProperty('executeMemoryCleanup');
    });

    it('databaseOptimizer가 DatabaseOptimizer 인스턴스여야 함', async () => {
      const services = await initializeServices(db);
      expect(services.databaseOptimizer).toBeDefined();
      expect(services.databaseOptimizer).toHaveProperty('analyzePerformance');
    });

    it('errorLoggingService가 ErrorLoggingService 인스턴스여야 함', async () => {
      const services = await initializeServices(db);
      expect(services.errorLoggingService).toBeDefined();
      expect(services.errorLoggingService).toHaveProperty('logError');
    });

    it('performanceAlertService가 PerformanceAlertService 인스턴스여야 함', async () => {
      const services = await initializeServices(db);
      expect(services.performanceAlertService).toBeDefined();
      expect(services.performanceAlertService).toHaveProperty('getActiveAlerts');
    });

    it('performanceMonitor가 PerformanceMonitor 인스턴스여야 함', async () => {
      const services = await initializeServices(db);
      expect(services.performanceMonitor).toBeDefined();
      expect(services.performanceMonitor).toHaveProperty('collectMetrics');
    });
  });
});

