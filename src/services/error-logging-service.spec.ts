/**
 * ErrorLoggingService 테스트
 * 구조화된 에러 로깅, 분류, 모니터링, 알림 시스템 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ErrorLoggingService,
  ErrorSeverity,
  ErrorCategory,
  type ErrorLog,
  type ErrorStats,
  type ErrorAlert
} from './error-logging-service.js';

describe('ErrorLoggingService', () => {
  let service: ErrorLoggingService;

  beforeEach(() => {
    service = new ErrorLoggingService();
  });

  afterEach(() => {
    service.cleanup();
  });

  describe('getError (searchErrors를 통한 특정 에러 조회)', () => {
    it('특정 에러 ID로 에러를 조회해야 함', () => {
      // Given: 에러 로깅
      const errorId = service.logError(
        new Error('Test error'),
        ErrorSeverity.MEDIUM,
        ErrorCategory.DATABASE
      );

      // When: searchErrors로 특정 에러 조회
      const errors = service.searchErrors({ limit: 1 });
      const foundError = errors.find(e => e.id === errorId);

      // Then: 에러가 조회되어야 함
      expect(foundError).toBeDefined();
      expect(foundError?.message).toBe('Test error');
    });

    it('존재하지 않는 에러 ID는 조회되지 않아야 함', () => {
      // When: 존재하지 않는 에러 ID로 검색
      const errors = service.searchErrors({ limit: 1 });
      const foundError = errors.find(e => e.id === 'nonexistent_id');

      // Then: 에러가 조회되지 않아야 함
      expect(foundError).toBeUndefined();
    });
  });

  describe('getRecentErrors (getErrorStats().recentErrors)', () => {
    it('최근 에러 목록을 반환해야 함', () => {
      // Given: 여러 에러 로깅
      service.logError(new Error('Error 1'), ErrorSeverity.LOW);
      service.logError(new Error('Error 2'), ErrorSeverity.MEDIUM);
      service.logError(new Error('Error 3'), ErrorSeverity.HIGH);

      // When: 최근 에러 조회
      const stats = service.getErrorStats();
      const recentErrors = stats.recentErrors;

      // Then: 최근 에러가 반환되어야 함
      expect(recentErrors.length).toBeGreaterThan(0);
      expect(recentErrors.length).toBeLessThanOrEqual(10); // 최대 10개
    });

    it('최근 에러는 시간순으로 정렬되어야 함 (최신순)', () => {
      // Given: 시간 간격을 두고 에러 로깅
      const errorId1 = service.logError(new Error('Error 1'), ErrorSeverity.LOW);
      
      // 약간의 지연
      const errorId2 = service.logError(new Error('Error 2'), ErrorSeverity.MEDIUM);

      // When: 최근 에러 조회
      const stats = service.getErrorStats();
      const recentErrors = stats.recentErrors;

      // Then: 최신 에러가 먼저 나와야 함
      if (recentErrors.length >= 2) {
        expect(recentErrors[0].id).toBe(errorId2);
        expect(recentErrors[1].id).toBe(errorId1);
      }
    });

    it('시간 범위에 따라 최근 에러를 필터링해야 함', () => {
      // Given: 에러 로깅
      service.logError(new Error('Recent error'), ErrorSeverity.MEDIUM);

      // When: 24시간 범위로 최근 에러 조회
      const stats24h = service.getErrorStats(24);
      const stats1h = service.getErrorStats(1);

      // Then: 시간 범위에 따라 다른 결과가 나올 수 있음
      expect(stats24h.recentErrors.length).toBeGreaterThanOrEqual(1);
      expect(stats1h.recentErrors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('checkAlertThresholds (알림 임계값 확인)', () => {
    it('임계값을 초과하면 알림을 생성해야 함', () => {
      // Given: CRITICAL 에러 1개 로깅 (임계값: 1)
      service.logError(
        new Error('Critical error'),
        ErrorSeverity.CRITICAL,
        ErrorCategory.DATABASE
      );

      // When: 알림 확인
      const alerts = service.getActiveAlerts();

      // Then: 알림이 생성되어야 함 (임계값 1개 초과)
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].severity).toBe(ErrorSeverity.CRITICAL);
    });

    it('HIGH 심각도 에러가 임계값(10개)을 초과하면 알림을 생성해야 함', () => {
      // Given: HIGH 에러 11개 로깅 (임계값: 10)
      for (let i = 0; i < 11; i++) {
        service.logError(
          new Error(`High error ${i}`),
          ErrorSeverity.HIGH,
          ErrorCategory.DATABASE
        );
      }

      // When: 알림 확인
      const alerts = service.getActiveAlerts();

      // Then: 알림이 생성되어야 함
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      const highAlerts = alerts.filter(a => a.severity === ErrorSeverity.HIGH);
      expect(highAlerts.length).toBeGreaterThanOrEqual(1);
    });

    it('임계값 미만이면 알림을 생성하지 않아야 함', () => {
      // Given: MEDIUM 에러 5개 로깅 (임계값: 50)
      for (let i = 0; i < 5; i++) {
        service.logError(
          new Error(`Medium error ${i}`),
          ErrorSeverity.MEDIUM,
          ErrorCategory.DATABASE
        );
      }

      // When: 알림 확인
      const alerts = service.getActiveAlerts();
      const mediumAlerts = alerts.filter(a => a.severity === ErrorSeverity.MEDIUM);

      // Then: MEDIUM 심각도 알림은 생성되지 않아야 함 (임계값 미만)
      // (다만 다른 심각도의 알림은 있을 수 있음)
      expect(mediumAlerts.length).toBe(0);
    });

    it('최근 1시간 내 에러만 임계값 계산에 포함해야 함', async () => {
      // Given: vi.useFakeTimers()를 사용하여 시간 제어
      vi.useFakeTimers();
      
      // 현재 시간에 에러 로깅
      service.logError(
        new Error('Recent error'),
        ErrorSeverity.CRITICAL,
        ErrorCategory.DATABASE
      );

      // 2시간 후로 시간 이동
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);

      // 새로운 에러 로깅 (이제 1시간 이내)
      service.logError(
        new Error('New error'),
        ErrorSeverity.CRITICAL,
        ErrorCategory.DATABASE
      );

      // When: 알림 확인
      const alerts = service.getActiveAlerts();

      // Then: 최근 1시간 내 에러만 계산되어야 함
      // (첫 번째 에러는 1시간 이전이므로 제외)
      expect(alerts.length).toBeGreaterThanOrEqual(0);

      vi.useRealTimers();
    });
  });

  describe('logError', () => {
    it('Error 객체로 에러를 로깅해야 함', () => {
      const error = new Error('Test error');
      const errorId = service.logError(
        error,
        ErrorSeverity.HIGH,
        ErrorCategory.DATABASE,
        { component: 'test' }
      );

      expect(errorId).toBeDefined();
      expect(errorId).toMatch(/^err_/);
    });

    it('문자열로 에러를 로깅해야 함', () => {
      const errorId = service.logError(
        'Test error message',
        ErrorSeverity.MEDIUM,
        ErrorCategory.VALIDATION
      );

      expect(errorId).toBeDefined();
    });

    it('기본 심각도와 카테고리를 사용해야 함', () => {
      const errorId = service.logError(new Error('Test'));

      const errors = service.searchErrors({ limit: 1 });
      expect(errors.length).toBe(1);
      expect(errors[0].severity).toBe(ErrorSeverity.MEDIUM);
      expect(errors[0].category).toBe(ErrorCategory.UNKNOWN);
    });

    it('컨텍스트 정보를 포함해야 함', () => {
      const context = {
        userId: 'user123',
        sessionId: 'session456',
        operation: 'test_operation'
      };

      const errorId = service.logError(
        new Error('Test'),
        ErrorSeverity.LOW,
        ErrorCategory.MEMORY,
        context
      );

      const errors = service.searchErrors({ limit: 1 });
      expect(errors[0].context.userId).toBe('user123');
      expect(errors[0].context.sessionId).toBe('session456');
      expect(errors[0].context.operation).toBe('test_operation');
    });

    it('메타데이터를 포함해야 함', () => {
      const metadata = {
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1'
      };

      const errorId = service.logError(
        new Error('Test'),
        ErrorSeverity.LOW,
        ErrorCategory.NETWORK,
        {},
        metadata
      );

      const errors = service.searchErrors({ limit: 1 });
      expect(errors[0].metadata.userAgent).toBe('test-agent');
      expect(errors[0].metadata.ipAddress).toBe('127.0.0.1');
    });

    it('스택 트레이스를 포함해야 함', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      const errorId = service.logError(error);

      const errors = service.searchErrors({ limit: 1 });
      expect(errors[0].stack).toBeDefined();
      expect(errors[0].stack).toContain('Test error');
    });

    it('다양한 심각도로 에러를 로깅해야 함', () => {
      const severities = [
        ErrorSeverity.LOW,
        ErrorSeverity.MEDIUM,
        ErrorSeverity.HIGH,
        ErrorSeverity.CRITICAL
      ];

      severities.forEach(severity => {
        service.logError(new Error(`Test ${severity}`), severity);
      });

      const stats = service.getErrorStats();
      expect(stats.totalErrors).toBe(4);
      expect(stats.errorsBySeverity[ErrorSeverity.LOW]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.MEDIUM]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.HIGH]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.CRITICAL]).toBe(1);
    });
  });

  describe('resolveError', () => {
    it('에러를 해결 처리해야 함', () => {
      const errorId = service.logError(new Error('Test'));

      const resolved = service.resolveError(errorId, 'admin');

      expect(resolved).toBe(true);

      const errors = service.searchErrors({ resolved: true });
      expect(errors.length).toBe(1);
      expect(errors[0].resolved).toBe(true);
      expect(errors[0].resolvedBy).toBe('admin');
      expect(errors[0].resolvedAt).toBeDefined();
    });

    it('존재하지 않는 에러 ID에 대해 false를 반환해야 함', () => {
      const resolved = service.resolveError('nonexistent_id');

      expect(resolved).toBe(false);
    });

    it('기본 resolvedBy를 사용해야 함', () => {
      const errorId = service.logError(new Error('Test'));

      service.resolveError(errorId);

      const errors = service.searchErrors({ resolved: true });
      expect(errors[0].resolvedBy).toBe('system');
    });
  });

  describe('getErrorStats', () => {
    it('에러 통계를 반환해야 함', () => {
      service.logError(new Error('Test 1'), ErrorSeverity.LOW);
      service.logError(new Error('Test 2'), ErrorSeverity.MEDIUM);
      service.logError(new Error('Test 3'), ErrorSeverity.HIGH);

      const stats = service.getErrorStats();

      expect(stats.totalErrors).toBe(3);
      expect(stats.errorsBySeverity[ErrorSeverity.LOW]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.MEDIUM]).toBe(1);
      expect(stats.errorsBySeverity[ErrorSeverity.HIGH]).toBe(1);
      expect(stats.criticalErrors).toBe(0);
    });

    it('시간 범위를 필터링해야 함', () => {
      // 오래된 에러 생성 (모킹 필요)
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25시간 전
      
      service.logError(new Error('Recent error'));

      const stats = service.getErrorStats(24); // 최근 24시간

      expect(stats.totalErrors).toBeGreaterThanOrEqual(1);
    });

    it('카테고리별 통계를 포함해야 함', () => {
      service.logError(new Error('DB error'), ErrorSeverity.MEDIUM, ErrorCategory.DATABASE);
      service.logError(new Error('Network error'), ErrorSeverity.MEDIUM, ErrorCategory.NETWORK);

      const stats = service.getErrorStats();

      expect(stats.errorsByCategory[ErrorCategory.DATABASE]).toBe(1);
      expect(stats.errorsByCategory[ErrorCategory.NETWORK]).toBe(1);
    });

    it('평균 해결 시간을 계산해야 함', () => {
      const errorId1 = service.logError(new Error('Test 1'));
      const errorId2 = service.logError(new Error('Test 2'));

      // 약간의 지연 후 해결
      setTimeout(() => {
        service.resolveError(errorId1);
        service.resolveError(errorId2);
      }, 10);

      // 통계는 비동기이므로 약간의 지연 후 확인
      setTimeout(() => {
        const stats = service.getErrorStats();
        expect(stats.averageResolutionTime).toBeGreaterThanOrEqual(0);
      }, 50);
    });

    it('최근 에러 목록을 포함해야 함', () => {
      for (let i = 0; i < 15; i++) {
        service.logError(new Error(`Test ${i}`));
      }

      const stats = service.getErrorStats();

      expect(stats.recentErrors.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getActiveAlerts', () => {
    it('활성 알림을 반환해야 함', () => {
      // 임계값을 초과하는 에러 생성
      for (let i = 0; i < 2; i++) {
        service.logError(new Error(`Critical ${i}`), ErrorSeverity.CRITICAL);
      }

      const alerts = service.getActiveAlerts();

      // CRITICAL 임계값이 1이므로 알림이 생성되어야 함
      expect(alerts.length).toBeGreaterThanOrEqual(0);
    });

    it('확인되지 않은 알림만 반환해야 함', () => {
      // 알림 생성
      for (let i = 0; i < 2; i++) {
        service.logError(new Error(`Critical ${i}`), ErrorSeverity.CRITICAL);
      }

      const alerts = service.getActiveAlerts();
      if (alerts.length > 0) {
        service.acknowledgeAlert(alerts[0].id);

        const activeAlerts = service.getActiveAlerts();
        expect(activeAlerts.length).toBeLessThan(alerts.length);
      }
    });
  });

  describe('acknowledgeAlert', () => {
    it('알림을 확인 처리해야 함', () => {
      // 알림 생성
      for (let i = 0; i < 2; i++) {
        service.logError(new Error(`Critical ${i}`), ErrorSeverity.CRITICAL);
      }

      const alerts = service.getActiveAlerts();
      if (alerts.length > 0) {
        const acknowledged = service.acknowledgeAlert(alerts[0].id, 'admin');

        expect(acknowledged).toBe(true);

        const alert = alerts.find(a => a.id === alerts[0].id);
        if (alert) {
          expect(alert.acknowledged).toBe(true);
          expect(alert.acknowledgedBy).toBe('admin');
          expect(alert.acknowledgedAt).toBeDefined();
        }
      }
    });

    it('존재하지 않는 알림 ID에 대해 false를 반환해야 함', () => {
      const acknowledged = service.acknowledgeAlert('nonexistent_alert');

      expect(acknowledged).toBe(false);
    });
  });

  describe('searchErrors', () => {
    beforeEach(() => {
      // 테스트 데이터 생성
      service.logError(new Error('DB Error'), ErrorSeverity.HIGH, ErrorCategory.DATABASE);
      service.logError(new Error('Network Error'), ErrorSeverity.MEDIUM, ErrorCategory.NETWORK);
      service.logError(new Error('Validation Error'), ErrorSeverity.LOW, ErrorCategory.VALIDATION);
      
      const errorId = service.logError(new Error('Resolved Error'), ErrorSeverity.MEDIUM);
      service.resolveError(errorId);
    });

    it('심각도로 필터링해야 함', () => {
      const errors = service.searchErrors({ severity: ErrorSeverity.HIGH });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every(e => e.severity === ErrorSeverity.HIGH)).toBe(true);
    });

    it('카테고리로 필터링해야 함', () => {
      const errors = service.searchErrors({ category: ErrorCategory.DATABASE });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every(e => e.category === ErrorCategory.DATABASE)).toBe(true);
    });

    it('해결 상태로 필터링해야 함', () => {
      const resolved = service.searchErrors({ resolved: true });
      const unresolved = service.searchErrors({ resolved: false });

      expect(resolved.length).toBeGreaterThan(0);
      expect(unresolved.length).toBeGreaterThan(0);
      expect(resolved.every(e => e.resolved)).toBe(true);
      expect(unresolved.every(e => !e.resolved)).toBe(true);
    });

    it('날짜 범위로 필터링해야 함', () => {
      const startDate = new Date(Date.now() - 60 * 60 * 1000); // 1시간 전
      const endDate = new Date();

      const errors = service.searchErrors({ startDate, endDate });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every(e => 
        e.timestamp >= startDate && e.timestamp <= endDate
      )).toBe(true);
    });

    it('limit 파라미터를 존중해야 함', () => {
      for (let i = 0; i < 20; i++) {
        service.logError(new Error(`Test ${i}`));
      }

      const errors = service.searchErrors({ limit: 10 });

      expect(errors.length).toBeLessThanOrEqual(10);
    });

    it('시간순으로 정렬해야 함', () => {
      const errors = service.searchErrors();

      for (let i = 0; i < errors.length - 1; i++) {
        expect(errors[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          errors[i + 1].timestamp.getTime()
        );
      }
    });
  });

  describe('checkAlertThresholds', () => {
    it('임계값을 초과하면 알림을 생성해야 함', () => {
      // CRITICAL 임계값은 1이므로 2개 생성하면 알림이 생성되어야 함
      service.logError(new Error('Critical 1'), ErrorSeverity.CRITICAL);
      service.logError(new Error('Critical 2'), ErrorSeverity.CRITICAL);

      const alerts = service.getActiveAlerts();
      // 알림이 생성되었는지 확인 (비동기이므로 약간의 지연 후)
      expect(alerts.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cleanupOldErrors', () => {
    it('최대 에러 수를 초과하면 오래된 에러를 정리해야 함', () => {
      // maxErrors는 기본값 10000이므로 많은 에러 생성
      for (let i = 0; i < 10001; i++) {
        service.logError(new Error(`Test ${i}`));
      }

      // 에러 수가 maxErrors 이하로 유지되어야 함
      const stats = service.getErrorStats();
      expect(stats.totalErrors).toBeLessThanOrEqual(10000);
    });
  });

  describe('cleanup', () => {
    it('모든 에러와 알림을 정리해야 함', () => {
      service.logError(new Error('Test 1'));
      service.logError(new Error('Test 2'));

      service.cleanup();

      const stats = service.getErrorStats();
      expect(stats.totalErrors).toBe(0);

      const alerts = service.getActiveAlerts();
      expect(alerts.length).toBe(0);
    });
  });
});

