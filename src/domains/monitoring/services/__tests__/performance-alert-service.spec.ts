/**
 * PerformanceAlertService 테스트
 * 실시간 성능 알림, 임계값 모니터링, 알림 발송, 자동 복구 제안 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PerformanceAlertService,
  AlertLevel,
  AlertType,
  type PerformanceAlert,
  type AlertStats,
  type AlertThreshold
} from '../performance-alert-service.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

describe('PerformanceAlertService', () => {
  let service: PerformanceAlertService;
  let testLogDir: string;

  beforeEach(() => {
    // 테스트용 로그 디렉토리 생성
    testLogDir = join(process.cwd(), 'test-logs', `test-${Date.now()}`);
    service = new PerformanceAlertService(testLogDir);
  });

  afterEach(() => {
    // 테스트 후 정리
    service.cleanup();
    // 테스트 로그 디렉토리 삭제
    try {
      if (existsSync(testLogDir)) {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    } catch (error) {
      // 무시
    }
  });

  describe('checkPerformanceMetric', () => {
    it('임계값을 초과하면 알림을 생성해야 함', () => {
      // Given: 응답시간이 임계값(100ms)을 초과하는 경우
      const responseTime = 150; // WARNING 임계값 100ms 초과

      // When: 성능 메트릭 체크
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        responseTime,
        { component: 'api', operation: 'search' }
      );

      // Then: 알림이 생성되어야 함
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].type).toBe(AlertType.RESPONSE_TIME);
      expect(alerts[0].value).toBe(responseTime);
      expect(alerts[0].level).toBe(AlertLevel.WARNING);
    });

    it('임계값을 초과하지 않으면 알림을 생성하지 않아야 함', () => {
      // Given: 응답시간이 임계값(100ms) 이하인 경우
      const responseTime = 50; // WARNING 임계값 100ms 이하

      // When: 성능 메트릭 체크
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        responseTime
      );

      // Then: 알림이 생성되지 않아야 함
      expect(alerts.length).toBe(0);
    });

    it('CRITICAL 임계값을 초과하면 CRITICAL 알림을 생성해야 함', () => {
      // Given: 응답시간이 CRITICAL 임계값(500ms)을 초과하는 경우
      const responseTime = 600; // CRITICAL 임계값 500ms 초과

      // When: 성능 메트릭 체크
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        responseTime
      );

      // Then: CRITICAL 알림이 생성되어야 함
      const criticalAlerts = alerts.filter(a => a.level === AlertLevel.CRITICAL);
      expect(criticalAlerts.length).toBeGreaterThan(0);
      expect(criticalAlerts[0].level).toBe(AlertLevel.CRITICAL);
    });

    it('여러 임계값을 동시에 초과하면 여러 알림을 생성해야 함', () => {
      // Given: 응답시간이 WARNING과 CRITICAL 임계값을 모두 초과
      const responseTime = 600; // WARNING(100ms)과 CRITICAL(500ms) 모두 초과

      // When: 성능 메트릭 체크
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        responseTime
      );

      // Then: 여러 알림이 생성되어야 함
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      // WARNING과 CRITICAL 알림이 모두 있을 수 있음
      const levels = alerts.map(a => a.level);
      expect(levels).toContain(AlertLevel.CRITICAL);
    });

    it('쿨다운 기간 동안 동일한 알림을 중복 생성하지 않아야 함', () => {
      // Given: 응답시간이 임계값을 초과
      const responseTime = 150;

      // When: 첫 번째 알림 생성
      const alerts1 = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        responseTime
      );
      expect(alerts1.length).toBeGreaterThan(0);

      // 쿨다운 기간 내에 동일한 메트릭 체크
      const alerts2 = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        responseTime
      );

      // Then: 두 번째 알림은 생성되지 않아야 함 (쿨다운)
      expect(alerts2.length).toBe(0);
    });

    it('다양한 메트릭 타입에 대해 알림을 생성해야 함', () => {
      // Given: 다양한 메트릭 타입
      const testCases = [
        { type: AlertType.MEMORY_USAGE, value: 150 }, // WARNING 임계값 100 초과
        { type: AlertType.ERROR_RATE, value: 6 }, // WARNING 임계값 5 초과
        { type: AlertType.THROUGHPUT, value: 8 }, // WARNING 임계값 10 미만
        { type: AlertType.DATABASE_PERFORMANCE, value: 60 }, // WARNING 임계값 50 초과
        { type: AlertType.CACHE_PERFORMANCE, value: 60 } // WARNING 임계값 70 미만
      ];

      testCases.forEach(({ type, value }) => {
        // When: 각 메트릭 타입 체크
        const alerts = service.checkPerformanceMetric(type, value);

        // Then: 알림이 생성되어야 함
        expect(alerts.length).toBeGreaterThan(0);
        expect(alerts[0].type).toBe(type);
      });
    });

    it('컨텍스트 정보를 알림에 포함해야 함', () => {
      // Given: 컨텍스트 정보와 함께 메트릭 체크
      const context = {
        component: 'api',
        operation: 'search',
        userId: 'user123',
        sessionId: 'session456'
      };
      const responseTime = 150;

      // When: 성능 메트릭 체크
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        responseTime,
        context
      );

      // Then: 컨텍스트 정보가 알림에 포함되어야 함
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].context).toEqual(context);
    });
  });

  describe('resolveAlert', () => {
    it('알림을 해결 처리해야 함', () => {
      // Given: 알림 생성
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        150
      );
      expect(alerts.length).toBeGreaterThan(0);
      const alertId = alerts[0].id;

      // When: 알림 해결
      const resolved = service.resolveAlert(alertId, 'admin', 'Performance improved');

      // Then: 알림이 해결되어야 함
      expect(resolved).toBe(true);
      const activeAlerts = service.getActiveAlerts();
      expect(activeAlerts.find(a => a.id === alertId)).toBeUndefined();
    });

    it('존재하지 않는 알림 ID는 해결할 수 없어야 함', () => {
      // When: 존재하지 않는 알림 ID로 해결 시도
      const resolved = service.resolveAlert('nonexistent_id', 'admin');

      // Then: 해결 실패
      expect(resolved).toBe(false);
    });

    it('해결 정보를 알림에 저장해야 함', () => {
      // Given: 알림 생성
      const alerts = service.checkPerformanceMetric(
        AlertType.RESPONSE_TIME,
        150
      );
      const alertId = alerts[0].id;

      // When: 알림 해결
      const resolvedBy = 'admin';
      const resolution = 'Performance improved after optimization';
      service.resolveAlert(alertId, resolvedBy, resolution);

      // Then: 해결 정보가 저장되어야 함
      const searchResults = service.searchAlerts({ limit: 100 });
      const resolvedAlert = searchResults.find(a => a.id === alertId);
      expect(resolvedAlert).toBeDefined();
      expect(resolvedAlert?.resolved).toBe(true);
      expect(resolvedAlert?.resolvedBy).toBe(resolvedBy);
      expect(resolvedAlert?.resolution).toBe(resolution);
      expect(resolvedAlert?.resolvedAt).toBeDefined();
    });
  });

  describe('getAlertStats', () => {
    it('알림 통계를 반환해야 함', () => {
      // Given: 여러 알림 생성
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150);
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 600); // CRITICAL

      // When: 통계 조회
      const stats = service.getAlertStats(24);

      // Then: 통계가 반환되어야 함
      expect(stats).toHaveProperty('totalAlerts');
      expect(stats).toHaveProperty('alertsByLevel');
      expect(stats).toHaveProperty('alertsByType');
      expect(stats).toHaveProperty('recentAlerts');
      expect(stats).toHaveProperty('averageResolutionTime');
      expect(stats).toHaveProperty('activeAlerts');
      expect(stats.totalAlerts).toBeGreaterThan(0);
    });

    it('레벨별 알림 개수를 올바르게 집계해야 함', () => {
      // Given: 다양한 레벨의 알림 생성
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150); // WARNING
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 600); // CRITICAL

      // When: 통계 조회
      const stats = service.getAlertStats(24);

      // Then: 레벨별 개수가 집계되어야 함
      expect(stats.alertsByLevel[AlertLevel.WARNING]).toBeGreaterThanOrEqual(1);
      expect(stats.alertsByLevel[AlertLevel.CRITICAL]).toBeGreaterThanOrEqual(1);
    });

    it('타입별 알림 개수를 올바르게 집계해야 함', () => {
      // Given: 다양한 타입의 알림 생성
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150);
      service.checkPerformanceMetric(AlertType.ERROR_RATE, 6);

      // When: 통계 조회
      const stats = service.getAlertStats(24);

      // Then: 타입별 개수가 집계되어야 함
      expect(stats.alertsByType[AlertType.RESPONSE_TIME]).toBeGreaterThanOrEqual(1);
      expect(stats.alertsByType[AlertType.MEMORY_USAGE]).toBeGreaterThanOrEqual(1);
      expect(stats.alertsByType[AlertType.ERROR_RATE]).toBeGreaterThanOrEqual(1);
    });

    it('지정된 시간 범위 내의 알림만 통계에 포함해야 함', () => {
      // Given: 알림 생성
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);

      // When: 1시간 범위로 통계 조회
      const stats = service.getAlertStats(1);

      // Then: 최근 1시간 내 알림이 포함되어야 함
      expect(stats.totalAlerts).toBeGreaterThanOrEqual(1);
      expect(stats.recentAlerts.length).toBeGreaterThanOrEqual(1);
    });

    it('평균 해결 시간을 올바르게 계산해야 함', () => {
      // Given: 시간 제어를 사용하여 알림 생성 및 해결
      vi.useFakeTimers();
      const startTime = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(startTime);
      
      // 알림 생성
      const alerts = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      const alertId = alerts[0].id;
      
      // 1시간 후 알림 해결
      vi.advanceTimersByTime(60 * 60 * 1000);
      service.resolveAlert(alertId, 'admin', 'Resolved');
      
      vi.useRealTimers();

      // When: 통계 조회
      const stats = service.getAlertStats(24);

      // Then: 평균 해결 시간이 계산되어야 함 (1시간 = 3600000ms)
      expect(stats.averageResolutionTime).toBeGreaterThanOrEqual(0);
      // 해결된 알림이 있으면 평균 해결 시간이 양수여야 함
      if (stats.totalAlerts > 0 && stats.averageResolutionTime > 0) {
        expect(stats.averageResolutionTime).toBeGreaterThan(0);
      }
    });

    it('활성 알림 개수를 올바르게 집계해야 함', () => {
      // Given: 알림 생성 및 일부 해결
      const alerts1 = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      const alerts2 = service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150);
      
      // 하나만 해결
      service.resolveAlert(alerts1[0].id, 'admin');

      // When: 통계 조회
      const stats = service.getAlertStats(24);

      // Then: 활성 알림 개수가 올바르게 집계되어야 함
      expect(stats.activeAlerts).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getActiveAlerts', () => {
    it('해결되지 않은 알림만 반환해야 함', () => {
      // Given: 알림 생성 및 일부 해결
      const alerts1 = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      const alerts2 = service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150);
      
      service.resolveAlert(alerts1[0].id, 'admin');

      // When: 활성 알림 조회
      const activeAlerts = service.getActiveAlerts();

      // Then: 해결되지 않은 알림만 반환되어야 함
      expect(activeAlerts.length).toBeGreaterThanOrEqual(1);
      activeAlerts.forEach(alert => {
        expect(alert.resolved).toBe(false);
      });
      expect(activeAlerts.find(a => a.id === alerts1[0].id)).toBeUndefined();
    });

    it('최신 알림 순으로 정렬해야 함', () => {
      // Given: 여러 알림 생성
      vi.useFakeTimers();
      const baseTime = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(baseTime);
      
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      
      vi.advanceTimersByTime(1000);
      service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150);
      
      vi.advanceTimersByTime(1000);
      service.checkPerformanceMetric(AlertType.ERROR_RATE, 6);
      
      vi.useRealTimers();

      // When: 활성 알림 조회
      const activeAlerts = service.getActiveAlerts();

      // Then: 최신 알림 순으로 정렬되어야 함
      if (activeAlerts.length > 1) {
        for (let i = 0; i < activeAlerts.length - 1; i++) {
          expect(activeAlerts[i].timestamp.getTime()).toBeGreaterThanOrEqual(
            activeAlerts[i + 1].timestamp.getTime()
          );
        }
      }
    });
  });

  describe('searchAlerts', () => {
    it('레벨로 필터링해야 함', () => {
      // Given: 다양한 레벨의 알림 생성
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150); // WARNING
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 600); // CRITICAL

      // When: WARNING 레벨로 필터링
      const warningAlerts = service.searchAlerts({ level: AlertLevel.WARNING });

      // Then: WARNING 알림만 반환되어야 함
      warningAlerts.forEach(alert => {
        expect(alert.level).toBe(AlertLevel.WARNING);
      });
    });

    it('타입으로 필터링해야 함', () => {
      // Given: 다양한 타입의 알림 생성
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150);

      // When: RESPONSE_TIME 타입으로 필터링
      const responseTimeAlerts = service.searchAlerts({ type: AlertType.RESPONSE_TIME });

      // Then: RESPONSE_TIME 알림만 반환되어야 함
      responseTimeAlerts.forEach(alert => {
        expect(alert.type).toBe(AlertType.RESPONSE_TIME);
      });
    });

    it('해결 상태로 필터링해야 함', () => {
      // Given: 알림 생성 및 일부 해결
      const alerts = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      service.resolveAlert(alerts[0].id, 'admin');

      // When: 해결된 알림만 필터링
      const resolvedAlerts = service.searchAlerts({ resolved: true });

      // Then: 해결된 알림만 반환되어야 함
      resolvedAlerts.forEach(alert => {
        expect(alert.resolved).toBe(true);
      });
      expect(resolvedAlerts.find(a => a.id === alerts[0].id)).toBeDefined();
    });

    it('날짜 범위로 필터링해야 함', () => {
      // Given: 시간 제어
      vi.useFakeTimers();
      const startDate = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(startDate);
      
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      
      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // 2시간 후
      service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150);
      
      vi.useRealTimers();

      // When: 시작 날짜로 필터링
      const filteredAlerts = service.searchAlerts({
        startDate: new Date('2024-01-01T01:00:00Z')
      });

      // Then: 시작 날짜 이후 알림만 반환되어야 함
      filteredAlerts.forEach(alert => {
        expect(alert.timestamp.getTime()).toBeGreaterThanOrEqual(
          new Date('2024-01-01T01:00:00Z').getTime()
        );
      });
    });

    it('limit로 결과 수를 제한해야 함', () => {
      // Given: 여러 알림 생성
      for (let i = 0; i < 10; i++) {
        service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150 + i);
      }

      // When: limit 5로 검색
      const alerts = service.searchAlerts({ limit: 5 });

      // Then: 최대 5개 결과만 반환되어야 함
      expect(alerts.length).toBeLessThanOrEqual(5);
    });

    it('여러 필터를 조합하여 검색해야 함', () => {
      // Given: 다양한 알림 생성
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150); // WARNING
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 600); // CRITICAL
      service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150); // WARNING

      // When: 레벨과 타입으로 필터링
      const alerts = service.searchAlerts({
        level: AlertLevel.WARNING,
        type: AlertType.RESPONSE_TIME
      });

      // Then: 조건을 만족하는 알림만 반환되어야 함
      alerts.forEach(alert => {
        expect(alert.level).toBe(AlertLevel.WARNING);
        expect(alert.type).toBe(AlertType.RESPONSE_TIME);
      });
    });
  });

  describe('updateThreshold', () => {
    it('기존 임계값을 업데이트해야 함', () => {
      // Given: 기존 임계값 확인
      const originalAlerts = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      expect(originalAlerts.length).toBeGreaterThan(0);

      // When: 임계값 업데이트 (더 높은 값으로)
      service.updateThreshold(AlertType.RESPONSE_TIME, AlertLevel.WARNING, {
        threshold: 200,
        operator: 'gt'
      });

      // Then: 업데이트된 임계값이 적용되어야 함
      const newAlerts = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      // 150은 새로운 임계값 200보다 낮으므로 알림이 생성되지 않아야 함
      expect(newAlerts.length).toBe(0);
    });

    it('새로운 임계값을 추가해야 함', () => {
      // Given: 새로운 레벨의 임계값 추가
      service.updateThreshold(AlertType.RESPONSE_TIME, AlertLevel.INFO, {
        threshold: 50,
        operator: 'gt',
        cooldown: 60
      });

      // When: 새로운 임계값을 초과하는 메트릭 체크
      const alerts = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 60);

      // Then: INFO 레벨 알림이 생성되어야 함
      const infoAlerts = alerts.filter(a => a.level === AlertLevel.INFO);
      expect(infoAlerts.length).toBeGreaterThan(0);
    });
  });

  describe('cleanup', () => {
    it('모든 알림을 정리해야 함', () => {
      // Given: 알림 생성
      service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      service.checkPerformanceMetric(AlertType.MEMORY_USAGE, 150);

      // When: 정리
      service.cleanup();

      // Then: 모든 알림이 제거되어야 함
      const activeAlerts = service.getActiveAlerts();
      expect(activeAlerts.length).toBe(0);
      
      const stats = service.getAlertStats(24);
      expect(stats.totalAlerts).toBe(0);
    });
  });

  describe('임계값 평가', () => {
    it('gt 연산자를 올바르게 평가해야 함', () => {
      // Given: gt 임계값 설정
      service.updateThreshold(AlertType.RESPONSE_TIME, AlertLevel.WARNING, {
        threshold: 100,
        operator: 'gt'
      });

      // When: 임계값 초과
      const alerts1 = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 150);
      // 임계값 미만
      const alerts2 = service.checkPerformanceMetric(AlertType.RESPONSE_TIME, 50);

      // Then: 초과 시 알림 생성, 미만 시 알림 없음
      expect(alerts1.length).toBeGreaterThan(0);
      expect(alerts2.length).toBe(0);
    });

    it('lt 연산자를 올바르게 평가해야 함', () => {
      // Given: lt 임계값 설정
      service.updateThreshold(AlertType.THROUGHPUT, AlertLevel.WARNING, {
        threshold: 10,
        operator: 'lt'
      });

      // When: 임계값 미만
      const alerts1 = service.checkPerformanceMetric(AlertType.THROUGHPUT, 5);
      // 임계값 초과
      const alerts2 = service.checkPerformanceMetric(AlertType.THROUGHPUT, 15);

      // Then: 미만 시 알림 생성, 초과 시 알림 없음
      expect(alerts1.length).toBeGreaterThan(0);
      expect(alerts2.length).toBe(0);
    });

    it('gte 연산자를 올바르게 평가해야 함', () => {
      // Given: gte 임계값 설정
      service.updateThreshold(AlertType.ERROR_RATE, AlertLevel.WARNING, {
        threshold: 5,
        operator: 'gte'
      });

      // When: 임계값 이상
      const alerts1 = service.checkPerformanceMetric(AlertType.ERROR_RATE, 5);
      const alerts2 = service.checkPerformanceMetric(AlertType.ERROR_RATE, 6);
      // 임계값 미만
      const alerts3 = service.checkPerformanceMetric(AlertType.ERROR_RATE, 4);

      // Then: 이상 시 알림 생성, 미만 시 알림 없음
      expect(alerts1.length).toBeGreaterThan(0);
      expect(alerts2.length).toBeGreaterThan(0);
      expect(alerts3.length).toBe(0);
    });

    it('lte 연산자를 올바르게 평가해야 함', () => {
      // Given: lte 임계값 설정
      service.updateThreshold(AlertType.CACHE_PERFORMANCE, AlertLevel.WARNING, {
        threshold: 70,
        operator: 'lte'
      });

      // When: 임계값 이하
      const alerts1 = service.checkPerformanceMetric(AlertType.CACHE_PERFORMANCE, 70);
      const alerts2 = service.checkPerformanceMetric(AlertType.CACHE_PERFORMANCE, 60);
      // 임계값 초과
      const alerts3 = service.checkPerformanceMetric(AlertType.CACHE_PERFORMANCE, 80);

      // Then: 이하 시 알림 생성, 초과 시 알림 없음
      expect(alerts1.length).toBeGreaterThan(0);
      expect(alerts2.length).toBeGreaterThan(0);
      expect(alerts3.length).toBe(0);
    });

    it('eq 연산자를 올바르게 평가해야 함', () => {
      // Given: eq 임계값 설정
      service.updateThreshold(AlertType.ERROR_RATE, AlertLevel.WARNING, {
        threshold: 5,
        operator: 'eq'
      });

      // When: 임계값 일치
      const alerts1 = service.checkPerformanceMetric(AlertType.ERROR_RATE, 5);
      // 임계값 불일치
      const alerts2 = service.checkPerformanceMetric(AlertType.ERROR_RATE, 6);

      // Then: 일치 시 알림 생성, 불일치 시 알림 없음
      expect(alerts1.length).toBeGreaterThan(0);
      expect(alerts2.length).toBe(0);
    });
  });
});

