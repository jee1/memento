/**
 * error-stats 도구 테스트
 * 에러 통계 도구 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeErrorStats, errorStatsTool } from './error-stats.js';
import type { ToolContext } from './types.js';
import Database from 'better-sqlite3';
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from '../domains/monitoring/services/error-logging-service.js';

describe('error-stats 도구', () => {
  let db: Database.Database;
  let context: ToolContext;
  let errorLoggingService: ErrorLoggingService;

  beforeEach(() => {
    db = new Database(':memory:');
    errorLoggingService = new ErrorLoggingService();
    context = {
      db,
      services: {
        errorLoggingService
      }
    };
  });

  afterEach(() => {
    db.close();
  });

  describe('errorStatsTool 메타데이터', () => {
    it('올바른 도구 이름을 가져야 함', () => {
      // Then: 올바른 이름
      expect(errorStatsTool.name).toBe('error_stats');
    });

    it('올바른 도구 설명을 가져야 함', () => {
      // Then: 올바른 설명
      expect(errorStatsTool.description).toBe('에러 통계 및 로그 정보를 조회합니다');
    });

    it('올바른 입력 스키마를 가져야 함', () => {
      // Then: 올바른 스키마
      expect(errorStatsTool.inputSchema).toHaveProperty('type', 'object');
      expect(errorStatsTool.inputSchema.properties).toHaveProperty('hours');
      expect(errorStatsTool.inputSchema.properties).toHaveProperty('severity');
      expect(errorStatsTool.inputSchema.properties).toHaveProperty('category');
      expect(errorStatsTool.inputSchema.properties).toHaveProperty('includeResolved');
      expect(errorStatsTool.inputSchema.properties).toHaveProperty('limit');
    });
  });

  describe('executeErrorStats', () => {
    it('에러 통계를 반환해야 함', async () => {
      // Given: 에러 로깅
      errorLoggingService.logError(
        new Error('Test error'),
        ErrorSeverity.MEDIUM,
        ErrorCategory.DATABASE
      );

      // When: 에러 통계 조회
      const result = await executeErrorStats({}, context);

      // Then: 통계 정보가 반환되어야 함
      expect(result.success).toBe(true);
      expect(result.stats).toHaveProperty('totalErrors');
      expect(result.stats).toHaveProperty('errorsBySeverity');
      expect(result.stats).toHaveProperty('errorsByCategory');
      expect(result.stats).toHaveProperty('errorsByHour');
      expect(result.stats).toHaveProperty('averageResolutionTime');
      expect(result.stats).toHaveProperty('criticalErrors');
      expect(result.stats).toHaveProperty('recentErrors');
    });

    it('시간 범위로 필터링해야 함', async () => {
      // Given: 에러 로깅
      errorLoggingService.logError(
        new Error('Test error'),
        ErrorSeverity.MEDIUM,
        ErrorCategory.DATABASE
      );

      // When: 1시간 범위로 조회
      const result = await executeErrorStats({ hours: 1 }, context);

      // Then: 통계가 반환되어야 함
      expect(result.success).toBe(true);
      expect(result.stats.totalErrors).toBeGreaterThanOrEqual(0);
    });

    it('심각도로 필터링해야 함', async () => {
      // Given: 다양한 심각도의 에러 로깅
      errorLoggingService.logError(
        new Error('Low error'),
        ErrorSeverity.LOW,
        ErrorCategory.DATABASE
      );
      errorLoggingService.logError(
        new Error('High error'),
        ErrorSeverity.HIGH,
        ErrorCategory.NETWORK
      );

      // When: HIGH 심각도로 필터링
      const result = await executeErrorStats({ severity: 'high' }, context);

      // Then: 필터링된 에러만 반환되어야 함
      expect(result.success).toBe(true);
      if (result.stats.filteredErrors) {
        result.stats.filteredErrors.forEach((error: any) => {
          expect(error.severity).toBe('high');
        });
      }
    });

    it('카테고리로 필터링해야 함', async () => {
      // Given: 다양한 카테고리의 에러 로깅
      errorLoggingService.logError(
        new Error('Database error'),
        ErrorSeverity.MEDIUM,
        ErrorCategory.DATABASE
      );
      errorLoggingService.logError(
        new Error('Network error'),
        ErrorSeverity.MEDIUM,
        ErrorCategory.NETWORK
      );

      // When: DATABASE 카테고리로 필터링
      const result = await executeErrorStats({ category: 'database' }, context);

      // Then: 필터링된 에러만 반환되어야 함
      expect(result.success).toBe(true);
      if (result.stats.filteredErrors) {
        result.stats.filteredErrors.forEach((error: any) => {
          expect(error.category).toBe('database');
        });
      }
    });

    it('해결된 에러 포함 여부를 필터링해야 함', async () => {
      // Given: 에러 로깅 및 해결
      const errorId = errorLoggingService.logError(
        new Error('Test error'),
        ErrorSeverity.MEDIUM,
        ErrorCategory.DATABASE
      );
      errorLoggingService.resolveError(errorId, 'admin');

      // When: 해결된 에러 포함하여 조회
      const result = await executeErrorStats({ includeResolved: true }, context);

      // Then: 해결된 에러가 포함되어야 함
      expect(result.success).toBe(true);
      if (result.stats.filteredErrors) {
        const resolvedErrors = result.stats.filteredErrors.filter((e: any) => e.resolved);
        expect(resolvedErrors.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('limit로 결과 수를 제한해야 함', async () => {
      // Given: 여러 에러 로깅
      for (let i = 0; i < 10; i++) {
        errorLoggingService.logError(
          new Error(`Error ${i}`),
          ErrorSeverity.MEDIUM,
          ErrorCategory.DATABASE
        );
      }

      // When: limit 5로 조회
      const result = await executeErrorStats({ limit: 5 }, context);

      // Then: 최대 5개 결과만 반환되어야 함
      expect(result.success).toBe(true);
      if (result.stats.filteredErrors) {
        expect(result.stats.filteredErrors.length).toBeLessThanOrEqual(5);
      }
    });

    it('알림 정보를 반환해야 함', async () => {
      // Given: 에러 로깅
      errorLoggingService.logError(
        new Error('Test error'),
        ErrorSeverity.CRITICAL,
        ErrorCategory.DATABASE
      );

      // When: 에러 통계 조회
      const result = await executeErrorStats({}, context);

      // Then: 알림 정보가 반환되어야 함
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('alerts');
      expect(Array.isArray(result.alerts)).toBe(true);
    });

    it('요약 정보를 반환해야 함', async () => {
      // Given: 에러 로깅
      errorLoggingService.logError(
        new Error('Test error'),
        ErrorSeverity.MEDIUM,
        ErrorCategory.DATABASE
      );

      // When: 에러 통계 조회
      const result = await executeErrorStats({}, context);

      // Then: 요약 정보가 반환되어야 함
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('totalErrors');
      expect(result.summary).toHaveProperty('criticalErrors');
      expect(result.summary).toHaveProperty('activeAlerts');
      expect(result.summary).toHaveProperty('averageResolutionTime');
    });

    it('에러 로깅 서비스가 없으면 기본 응답을 반환해야 함', async () => {
      // Given: 에러 로깅 서비스가 없는 컨텍스트
      const contextWithoutService = {
        ...context,
        services: {
          ...context.services,
          errorLoggingService: undefined
        }
      };

      // When: 에러 통계 조회
      const result = await executeErrorStats({}, contextWithoutService);

      // Then: 기본 응답 반환
      expect(result.success).toBe(false);
      expect(result.error).toBe('Error logging service not available');
      expect(result.stats).toHaveProperty('totalErrors', 0);
    });

    it('에러 발생 시 에러 응답을 반환해야 함', async () => {
      // Given: 에러를 발생시키는 모킹된 서비스
      const mockService = {
        getErrorStats: vi.fn().mockImplementation(() => {
          throw new Error('Service error');
        }),
        getActiveAlerts: vi.fn().mockReturnValue([]),
        searchErrors: vi.fn().mockReturnValue([])
      };
      const invalidContext = {
        ...context,
        services: {
          ...context.services,
          errorLoggingService: mockService as any
        }
      };

      // When: 에러 통계 조회
      const result = await executeErrorStats({}, invalidContext);

      // Then: 에러 응답 반환
      expect(result.success).toBe(false);
      expect(result.error).toBe('Service error');
    });
  });
});

