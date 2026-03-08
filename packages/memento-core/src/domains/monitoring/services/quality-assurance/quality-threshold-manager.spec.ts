import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { QualityThresholdManager, type QualityThreshold, type ThresholdOptions } from './quality-threshold-manager.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';

/**
 * quality_thresholds 테이블 생성
 */
function createQualityThresholdsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_thresholds (
      metric_namespace TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT 'default',
      threshold_value REAL NOT NULL,
      threshold_type TEXT CHECK (threshold_type IN ('min', 'max')) NOT NULL,
      description TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (metric_namespace, metric_key, context)
    );

    CREATE INDEX IF NOT EXISTS idx_quality_thresholds_namespace_key 
      ON quality_thresholds(metric_namespace, metric_key);
    CREATE INDEX IF NOT EXISTS idx_quality_thresholds_context 
      ON quality_thresholds(context);
  `);
}

describe('QualityThresholdManager', () => {
  let db: Database.Database;
  let manager: QualityThresholdManager;

  beforeEach(async () => {
    db = await setupTestDatabase();
    createQualityThresholdsTable(db);
    manager = new QualityThresholdManager(db);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('초기화', () => {
    it('should initialize successfully with database', () => {
      // Given: 데이터베이스가 있는 경우
      // When: QualityThresholdManager 생성
      // Then: 인스턴스가 생성되어야 함
      expect(manager).toBeDefined();
    });

    it('should throw error when database is not provided', () => {
      // Given: 데이터베이스가 없는 경우
      // When/Then: 에러가 발생해야 함
      expect(() => {
        new QualityThresholdManager(null as any);
      }).toThrow('Database instance is required');
    });
  });

  describe('getThreshold', () => {
    it('should return null when threshold does not exist', () => {
      // Given: 임계값이 없는 경우
      // When: 임계값 조회
      const result = manager.getThreshold('search', 'precision_at_5', 'default');

      // Then: null이 반환되어야 함
      expect(result).toBeNull();
    });

    it('should return threshold when it exists', () => {
      // Given: 임계값이 설정된 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      // When: 임계값 조회
      const result = manager.getThreshold('search', 'precision_at_5', 'default');

      // Then: 임계값이 반환되어야 함
      expect(result).toBeDefined();
      expect(result?.metric_namespace).toBe('search');
      expect(result?.metric_key).toBe('precision_at_5');
      expect(result?.context).toBe('default');
      expect(result?.threshold_value).toBe(0.7);
      expect(result?.threshold_type).toBe('min');
      expect(result?.description).toBe('Test threshold');
    });

    it('should return threshold with different context', () => {
      // Given: 다른 컨텍스트의 임계값이 설정된 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      }, 'ci');

      // When: 해당 컨텍스트의 임계값 조회
      const result = manager.getThreshold('search', 'precision_at_5', 'ci');

      // Then: 임계값이 반환되어야 함
      expect(result).toBeDefined();
      expect(result?.context).toBe('ci');
    });
  });

  describe('getAllThresholds', () => {
    it('should return empty array when no thresholds exist', () => {
      // Given: 임계값이 없는 경우
      // When: 모든 임계값 조회
      const result = manager.getAllThresholds();

      // Then: 빈 배열이 반환되어야 함
      expect(result).toEqual([]);
    });

    it('should return all thresholds', () => {
      // Given: 여러 임계값이 설정된 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      });
      manager.setThreshold('search', 'recall_at_5', {
        threshold_value: 0.6,
        threshold_type: 'min'
      });
      manager.setThreshold('relation', 'f1_score', {
        threshold_value: 0.6,
        threshold_type: 'min'
      });

      // When: 모든 임계값 조회
      const result = manager.getAllThresholds();

      // Then: 모든 임계값이 반환되어야 함
      expect(result.length).toBe(3);
      expect(result.some(t => t.metric_key === 'precision_at_5')).toBe(true);
      expect(result.some(t => t.metric_key === 'recall_at_5')).toBe(true);
      expect(result.some(t => t.metric_key === 'f1_score')).toBe(true);
    });

    it('should filter by namespace', () => {
      // Given: 여러 네임스페이스의 임계값이 설정된 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      });
      manager.setThreshold('relation', 'f1_score', {
        threshold_value: 0.6,
        threshold_type: 'min'
      });

      // When: 특정 네임스페이스의 임계값 조회
      const result = manager.getAllThresholds('search');

      // Then: 해당 네임스페이스의 임계값만 반환되어야 함
      expect(result.length).toBe(1);
      expect(result[0].metric_namespace).toBe('search');
      expect(result[0].metric_key).toBe('precision_at_5');
    });

    it('should filter by context', () => {
      // Given: 여러 컨텍스트의 임계값이 설정된 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      }, 'default');
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.8,
        threshold_type: 'min'
      }, 'ci');

      // When: 특정 컨텍스트의 임계값 조회
      const result = manager.getAllThresholds(undefined, 'ci');

      // Then: 해당 컨텍스트의 임계값만 반환되어야 함
      expect(result.length).toBe(1);
      expect(result[0].context).toBe('ci');
      expect(result[0].threshold_value).toBe(0.8);
    });

    it('should filter by both namespace and context', () => {
      // Given: 여러 네임스페이스와 컨텍스트의 임계값이 설정된 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      }, 'default');
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.8,
        threshold_type: 'min'
      }, 'ci');
      manager.setThreshold('relation', 'f1_score', {
        threshold_value: 0.6,
        threshold_type: 'min'
      }, 'default');

      // When: 특정 네임스페이스와 컨텍스트의 임계값 조회
      const result = manager.getAllThresholds('search', 'ci');

      // Then: 해당 조건의 임계값만 반환되어야 함
      expect(result.length).toBe(1);
      expect(result[0].metric_namespace).toBe('search');
      expect(result[0].context).toBe('ci');
    });
  });

  describe('setThreshold', () => {
    it('should create new threshold', () => {
      // Given: 임계값이 없는 경우
      // When: 임계값 설정
      const result = manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      // Then: 임계값이 생성되어야 함
      expect(result).toBeDefined();
      expect(result.metric_namespace).toBe('search');
      expect(result.metric_key).toBe('precision_at_5');
      expect(result.threshold_value).toBe(0.7);
      expect(result.threshold_type).toBe('min');
      expect(result.description).toBe('Test threshold');

      // 데이터베이스에서 확인
      const dbResult = manager.getThreshold('search', 'precision_at_5');
      expect(dbResult).toBeDefined();
      expect(dbResult?.threshold_value).toBe(0.7);
    });

    it('should update existing threshold', () => {
      // Given: 기존 임계값이 있는 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      });

      // When: 임계값 업데이트
      const result = manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.8,
        threshold_type: 'min',
        description: 'Updated threshold'
      });

      // Then: 임계값이 업데이트되어야 함
      expect(result.threshold_value).toBe(0.8);
      expect(result.description).toBe('Updated threshold');

      // 데이터베이스에서 확인
      const dbResult = manager.getThreshold('search', 'precision_at_5');
      expect(dbResult?.threshold_value).toBe(0.8);
    });

    it('should throw error when threshold_value is out of range', () => {
      // Given: 유효하지 않은 임계값
      // When/Then: 에러가 발생해야 함
      expect(() => {
        manager.setThreshold('search', 'precision_at_5', {
          threshold_value: 1.5,
          threshold_type: 'min'
        });
      }).toThrow('임계값은 0과 1 사이의 값이어야 합니다');

      expect(() => {
        manager.setThreshold('search', 'precision_at_5', {
          threshold_value: -0.1,
          threshold_type: 'min'
        });
      }).toThrow('임계값은 0과 1 사이의 값이어야 합니다');
    });

    it('should support max threshold type', () => {
      // Given: max 타입 임계값
      // When: 임계값 설정
      const result = manager.setThreshold('storage', 'duplication_rate', {
        threshold_value: 0.05,
        threshold_type: 'max',
        description: 'Maximum duplication rate'
      });

      // Then: 임계값이 설정되어야 함
      expect(result.threshold_type).toBe('max');
      expect(result.threshold_value).toBe(0.05);
    });

    it('should set default context when not provided', () => {
      // Given: 컨텍스트를 제공하지 않은 경우
      // When: 임계값 설정
      const result = manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      });

      // Then: 기본 컨텍스트 'default'가 사용되어야 함
      expect(result.context).toBe('default');
    });
  });

  describe('deleteThreshold', () => {
    it('should return false when threshold does not exist', () => {
      // Given: 임계값이 없는 경우
      // When: 임계값 삭제 시도
      const result = manager.deleteThreshold('search', 'precision_at_5', 'default');

      // Then: false가 반환되어야 함
      expect(result).toBe(false);
    });

    it('should delete existing threshold', () => {
      // Given: 임계값이 있는 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      });

      // When: 임계값 삭제
      const result = manager.deleteThreshold('search', 'precision_at_5', 'default');

      // Then: 삭제가 성공해야 함
      expect(result).toBe(true);

      // 데이터베이스에서 확인
      const dbResult = manager.getThreshold('search', 'precision_at_5');
      expect(dbResult).toBeNull();
    });

    it('should not delete threshold with different context', () => {
      // Given: 다른 컨텍스트의 임계값이 있는 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      }, 'ci');

      // When: 다른 컨텍스트의 임계값 삭제 시도
      const result = manager.deleteThreshold('search', 'precision_at_5', 'default');

      // Then: 삭제가 실패해야 함
      expect(result).toBe(false);

      // 원래 임계값은 유지되어야 함
      const dbResult = manager.getThreshold('search', 'precision_at_5', 'ci');
      expect(dbResult).toBeDefined();
    });
  });

  describe('initializeDefaultThresholds', () => {
    it('should initialize all default thresholds', () => {
      // Given: 기본 임계값이 없는 경우
      // When: 기본 임계값 초기화
      const count = manager.initializeDefaultThresholds();

      // Then: 모든 기본 임계값이 초기화되어야 함
      expect(count).toBeGreaterThan(0);

      // 일부 임계값 확인
      const precisionAt5 = manager.getThreshold('search', 'precision_at_5');
      expect(precisionAt5).toBeDefined();
      expect(precisionAt5?.threshold_value).toBe(0.7);
      expect(precisionAt5?.threshold_type).toBe('min');

      const f1Score = manager.getThreshold('relation', 'f1_score');
      expect(f1Score).toBeDefined();
      expect(f1Score?.threshold_value).toBe(0.6);
      expect(f1Score?.threshold_type).toBe('min');

      const duplicationRate = manager.getThreshold('storage', 'duplication_rate');
      expect(duplicationRate).toBeDefined();
      expect(duplicationRate?.threshold_value).toBe(0.05);
      expect(duplicationRate?.threshold_type).toBe('max');
    });

    it('should not overwrite existing thresholds by default', () => {
      // Given: 기존 임계값이 있는 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.9,
        threshold_type: 'min'
      });

      // When: 기본 임계값 초기화 (덮어쓰기 없음)
      const count = manager.initializeDefaultThresholds();

      // Then: 기존 임계값이 유지되어야 함
      const result = manager.getThreshold('search', 'precision_at_5');
      expect(result?.threshold_value).toBe(0.9); // 기존 값 유지

      // 다른 임계값은 초기화되어야 함
      expect(count).toBeGreaterThan(0);
    });

    it('should overwrite existing thresholds when overwrite is true', () => {
      // Given: 기존 임계값이 있는 경우
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.9,
        threshold_type: 'min'
      });

      // When: 기본 임계값 초기화 (덮어쓰기)
      const count = manager.initializeDefaultThresholds('default', true);

      // Then: 기존 임계값이 기본값으로 덮어써져야 함
      const result = manager.getThreshold('search', 'precision_at_5');
      expect(result?.threshold_value).toBe(0.7); // 기본값으로 변경

      expect(count).toBeGreaterThan(0);
    });

    it('should initialize thresholds for specific context', () => {
      // Given: 특정 컨텍스트
      // When: 해당 컨텍스트의 기본 임계값 초기화
      const count = manager.initializeDefaultThresholds('ci');

      // Then: 해당 컨텍스트의 임계값이 초기화되어야 함
      expect(count).toBeGreaterThan(0);

      const result = manager.getThreshold('search', 'precision_at_5', 'ci');
      expect(result).toBeDefined();
      expect(result?.context).toBe('ci');

      // default 컨텍스트는 초기화되지 않아야 함
      const defaultResult = manager.getThreshold('search', 'precision_at_5', 'default');
      expect(defaultResult).toBeNull();
    });
  });

  describe('validateThreshold', () => {
    beforeEach(() => {
      // 테스트용 임계값 설정
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      });
      manager.setThreshold('storage', 'duplication_rate', {
        threshold_value: 0.05,
        threshold_type: 'max'
      });
    });

    it('should return passed=true when threshold does not exist', () => {
      // Given: 임계값이 없는 경우
      // When: 임계값 검증
      const result = manager.validateThreshold('search', 'unknown_metric', 0.8);

      // Then: 통과로 간주되어야 함
      expect(result.passed).toBe(true);
      expect(result.threshold).toBeNull();
      expect(result.message).toContain('임계값이 설정되지 않음');
    });

    it('should pass when value meets min threshold', () => {
      // Given: min 타입 임계값과 만족하는 값
      // When: 임계값 검증
      const result = manager.validateThreshold('search', 'precision_at_5', 0.75);

      // Then: 통과해야 함
      expect(result.passed).toBe(true);
      expect(result.threshold).toBeDefined();
      expect(result.message).toContain('통과');
      expect(result.message).toContain('0.75 >= 0.7');
    });

    it('should fail when value does not meet min threshold', () => {
      // Given: min 타입 임계값과 만족하지 않는 값
      // When: 임계값 검증
      const result = manager.validateThreshold('search', 'precision_at_5', 0.65);

      // Then: 실패해야 함
      expect(result.passed).toBe(false);
      expect(result.threshold).toBeDefined();
      expect(result.message).toContain('실패');
      expect(result.message).toContain('0.65 < 0.7');
    });

    it('should pass when value meets max threshold', () => {
      // Given: max 타입 임계값과 만족하는 값
      // When: 임계값 검증
      const result = manager.validateThreshold('storage', 'duplication_rate', 0.03);

      // Then: 통과해야 함
      expect(result.passed).toBe(true);
      expect(result.threshold).toBeDefined();
      expect(result.message).toContain('통과');
      expect(result.message).toContain('0.03 <= 0.05');
    });

    it('should fail when value does not meet max threshold', () => {
      // Given: max 타입 임계값과 만족하지 않는 값
      // When: 임계값 검증
      const result = manager.validateThreshold('storage', 'duplication_rate', 0.1);

      // Then: 실패해야 함
      expect(result.passed).toBe(false);
      expect(result.threshold).toBeDefined();
      expect(result.message).toContain('실패');
      expect(result.message).toContain('0.1 > 0.05');
    });

    it('should pass when value exactly equals min threshold', () => {
      // Given: min 타입 임계값과 정확히 같은 값
      // When: 임계값 검증
      const result = manager.validateThreshold('search', 'precision_at_5', 0.7);

      // Then: 통과해야 함 (>=)
      expect(result.passed).toBe(true);
    });

    it('should pass when value exactly equals max threshold', () => {
      // Given: max 타입 임계값과 정확히 같은 값
      // When: 임계값 검증
      const result = manager.validateThreshold('storage', 'duplication_rate', 0.05);

      // Then: 통과해야 함 (<=)
      expect(result.passed).toBe(true);
    });

    it('should use correct context for validation', () => {
      // Given: 다른 컨텍스트의 임계값
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.8,
        threshold_type: 'min'
      }, 'ci');

      // When: 해당 컨텍스트의 임계값 검증
      const result = manager.validateThreshold('search', 'precision_at_5', 0.75, 'ci');

      // Then: 해당 컨텍스트의 임계값으로 검증되어야 함
      expect(result.passed).toBe(false); // 0.75 < 0.8
      expect(result.threshold?.threshold_value).toBe(0.8);
    });
  });

  describe('통합 테스트', () => {
    it('should complete full CRUD cycle', () => {
      // Given: 새로운 임계값
      // When: 생성
      const created = manager.setThreshold('search', 'test_metric', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test metric'
      });
      expect(created).toBeDefined();

      // When: 조회
      const retrieved = manager.getThreshold('search', 'test_metric');
      expect(retrieved).toBeDefined();
      expect(retrieved?.threshold_value).toBe(0.7);

      // When: 업데이트
      const updated = manager.setThreshold('search', 'test_metric', {
        threshold_value: 0.8,
        threshold_type: 'min',
        description: 'Updated test metric'
      });
      expect(updated.threshold_value).toBe(0.8);

      // When: 검증
      const validation = manager.validateThreshold('search', 'test_metric', 0.75);
      expect(validation.passed).toBe(false); // 0.75 < 0.8

      // When: 삭제
      const deleted = manager.deleteThreshold('search', 'test_metric');
      expect(deleted).toBe(true);

      // Then: 삭제 확인
      const afterDelete = manager.getThreshold('search', 'test_metric');
      expect(afterDelete).toBeNull();
    });

    it('should handle multiple contexts independently', () => {
      // Given: 여러 컨텍스트의 임계값
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min'
      }, 'default');
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.8,
        threshold_type: 'min'
      }, 'ci');
      manager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.9,
        threshold_type: 'min'
      }, 'nightly');

      // When: 각 컨텍스트의 임계값 조회
      const defaultThreshold = manager.getThreshold('search', 'precision_at_5', 'default');
      const ciThreshold = manager.getThreshold('search', 'precision_at_5', 'ci');
      const nightlyThreshold = manager.getThreshold('search', 'precision_at_5', 'nightly');

      // Then: 각 컨텍스트의 임계값이 독립적으로 관리되어야 함
      expect(defaultThreshold?.threshold_value).toBe(0.7);
      expect(ciThreshold?.threshold_value).toBe(0.8);
      expect(nightlyThreshold?.threshold_value).toBe(0.9);
    });
  });
});

