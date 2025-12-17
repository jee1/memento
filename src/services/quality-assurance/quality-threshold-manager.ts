/**
 * Quality Threshold Manager
 * 
 * 품질 임계값 관리 서비스
 * 
 * 주요 기능:
 * - 품질 임계값 CRUD (생성, 조회, 업데이트, 삭제)
 * - 기본 임계값 초기화
 * - 임계값 검증
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../shared/utils/database.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * 품질 임계값 정보
 */
export interface QualityThreshold {
  metric_namespace: string;
  metric_key: string;
  context: string;
  threshold_value: number;
  threshold_type: 'min' | 'max';
  description: string | null;
  updated_at: string;
}

/**
 * 임계값 생성/업데이트 옵션
 */
export interface ThresholdOptions {
  threshold_value: number;
  threshold_type: 'min' | 'max';
  description?: string;
}

/**
 * 기본 임계값 정의
 * 
 * PRD 4.1: 기본 품질 임계값 초기화 로직
 * 보수적 초기값 설정 원칙 적용
 */
const DEFAULT_THRESHOLDS: Array<{
  namespace: string;
  key: string;
  value: number;
  type: 'min' | 'max';
  description: string;
}> = [
  // 검색 품질 지표
  { namespace: 'search', key: 'precision_at_5', value: 0.7, type: 'min', description: 'Precision@5 최소값 (0.7 이상)' },
  { namespace: 'search', key: 'precision_at_10', value: 0.65, type: 'min', description: 'Precision@10 최소값 (0.65 이상)' },
  { namespace: 'search', key: 'recall_at_5', value: 0.6, type: 'min', description: 'Recall@5 최소값 (0.6 이상)' },
  { namespace: 'search', key: 'recall_at_10', value: 0.7, type: 'min', description: 'Recall@10 최소값 (0.7 이상)' },
  { namespace: 'search', key: 'ndcg_at_5', value: 0.65, type: 'min', description: 'NDCG@5 최소값 (0.65 이상)' },
  { namespace: 'search', key: 'ndcg_at_10', value: 0.7, type: 'min', description: 'NDCG@10 최소값 (0.7 이상)' },
  { namespace: 'search', key: 'mrr', value: 0.6, type: 'min', description: 'MRR 최소값 (0.6 이상)' },
  { namespace: 'search', key: 'kendalls_tau', value: 0.5, type: 'min', description: "Kendall's Tau 최소값 (0.5 이상)" },
  
  // 관계 추출 품질 지표
  { namespace: 'relation', key: 'precision', value: 0.6, type: 'min', description: '관계 추출 Precision 최소값 (0.6 이상)' },
  { namespace: 'relation', key: 'recall', value: 0.5, type: 'min', description: '관계 추출 Recall 최소값 (0.5 이상)' },
  { namespace: 'relation', key: 'f1_score', value: 0.6, type: 'min', description: '관계 추출 F1-Score 최소값 (0.6 이상)' },
  
  // Consolidation 점수 품질 지표
  { namespace: 'consolidation', key: 'score_stability', value: 0.7, type: 'min', description: 'Consolidation 점수 안정성 최소값 (0.7 이상)' },
  { namespace: 'consolidation', key: 'order_preservation', value: 0.8, type: 'min', description: '순서 보존율 최소값 (0.8 이상)' },
  
  // 저장 품질 지표
  { namespace: 'storage', key: 'duplication_rate', value: 0.05, type: 'max', description: '중복 비율 최대값 (5% 이하)' },
  { namespace: 'storage', key: 'data_integrity', value: 0.95, type: 'min', description: '데이터 무결성 최소값 (95% 이상)' },
  { namespace: 'storage', key: 'schema_compliance', value: 0.98, type: 'min', description: '스키마 준수율 최소값 (98% 이상)' }
];

/**
 * Quality Threshold Manager
 */
export class QualityThresholdManager {
  constructor(private db: Database.Database) {
    if (!db) {
      throw new Error('Database instance is required');
    }
  }

  /**
   * 임계값 조회
   * 
   * @param namespace - 지표 네임스페이스 (예: 'search', 'relation')
   * @param key - 지표 키 (예: 'precision_at_5')
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 임계값 정보 또는 null
   */
  getThreshold(
    namespace: string,
    key: string,
    context: string = 'default'
  ): QualityThreshold | null {
    const sql = `
      SELECT 
        metric_namespace,
        metric_key,
        context,
        threshold_value,
        threshold_type,
        description,
        updated_at
      FROM quality_thresholds
      WHERE metric_namespace = ? AND metric_key = ? AND context = ?
    `;

    const result = DatabaseUtils.get(this.db, sql, [namespace, key, context]) as QualityThreshold | null;
    return result || null;
  }

  /**
   * 모든 임계값 조회
   * 
   * @param namespace - 네임스페이스 필터 (선택적)
   * @param context - 컨텍스트 필터 (선택적)
   * @returns 임계값 목록
   */
  getAllThresholds(namespace?: string, context?: string): QualityThreshold[] {
    let sql = `
      SELECT 
        metric_namespace,
        metric_key,
        context,
        threshold_value,
        threshold_type,
        description,
        updated_at
      FROM quality_thresholds
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (namespace) {
      conditions.push('metric_namespace = ?');
      params.push(namespace);
    }

    if (context) {
      conditions.push('context = ?');
      params.push(context);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY metric_namespace, metric_key, context';

    return DatabaseUtils.all(this.db, sql, params) as QualityThreshold[];
  }

  /**
   * 임계값 설정 (생성 또는 업데이트)
   * 
   * @param namespace - 지표 네임스페이스
   * @param key - 지표 키
   * @param options - 임계값 옵션
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 설정된 임계값 정보
   */
  setThreshold(
    namespace: string,
    key: string,
    options: ThresholdOptions,
    context: string = 'default'
  ): QualityThreshold {
    const { threshold_value, threshold_type, description } = options;

    // 임계값 검증
    if (threshold_value < 0 || threshold_value > 1) {
      throw new Error(`임계값은 0과 1 사이의 값이어야 합니다: ${threshold_value}`);
    }

    const now = new Date().toISOString();

    const sql = `
      INSERT INTO quality_thresholds (
        metric_namespace,
        metric_key,
        context,
        threshold_value,
        threshold_type,
        description,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(metric_namespace, metric_key, context) 
      DO UPDATE SET
        threshold_value = excluded.threshold_value,
        threshold_type = excluded.threshold_type,
        description = excluded.description,
        updated_at = excluded.updated_at
    `;

    DatabaseUtils.run(this.db, sql, [
      namespace,
      key,
      context,
      threshold_value,
      threshold_type,
      description || null,
      now
    ]);

    logger.info(`품질 임계값 설정: ${namespace}.${key} (${context}) = ${threshold_value} (${threshold_type})`);

    // 설정된 임계값 반환
    const result = this.getThreshold(namespace, key, context);
    if (!result) {
      throw new Error('임계값 설정 후 조회 실패');
    }
    return result;
  }

  /**
   * 임계값 삭제
   * 
   * @param namespace - 지표 네임스페이스
   * @param key - 지표 키
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 삭제 성공 여부
   */
  deleteThreshold(
    namespace: string,
    key: string,
    context: string = 'default'
  ): boolean {
    const sql = `
      DELETE FROM quality_thresholds
      WHERE metric_namespace = ? AND metric_key = ? AND context = ?
    `;

    const result = DatabaseUtils.run(this.db, sql, [namespace, key, context]);
    
    if (result.changes > 0) {
      logger.info(`품질 임계값 삭제: ${namespace}.${key} (${context})`);
      return true;
    }
    return false;
  }

  /**
   * 기본 임계값 초기화
   * 
   * PRD 4.1: 기본 품질 임계값 초기화 로직
   * 기존 임계값이 있으면 건너뛰고, 없으면 기본값으로 설정
   * 
   * @param context - 컨텍스트 (기본값: 'default')
   * @param overwrite - 기존 임계값 덮어쓰기 여부 (기본값: false)
   * @returns 초기화된 임계값 개수
   */
  initializeDefaultThresholds(context: string = 'default', overwrite: boolean = false): number {
    let initializedCount = 0;

    for (const threshold of DEFAULT_THRESHOLDS) {
      const existing = this.getThreshold(threshold.namespace, threshold.key, context);

      if (existing && !overwrite) {
        // 기존 임계값이 있고 덮어쓰지 않는 경우 건너뛰기
        continue;
      }

      this.setThreshold(
        threshold.namespace,
        threshold.key,
        {
          threshold_value: threshold.value,
          threshold_type: threshold.type,
          description: threshold.description
        },
        context
      );

      initializedCount++;
    }

    logger.info(`기본 품질 임계값 초기화 완료: ${initializedCount}개 (context: ${context})`);
    return initializedCount;
  }

  /**
   * 임계값 검증
   * 
   * 측정값이 임계값을 만족하는지 검증
   * 
   * @param namespace - 지표 네임스페이스
   * @param key - 지표 키
   * @param value - 측정값
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 검증 결과: { passed: boolean, threshold: QualityThreshold | null, message: string }
   */
  validateThreshold(
    namespace: string,
    key: string,
    value: number,
    context: string = 'default'
  ): { passed: boolean; threshold: QualityThreshold | null; message: string } {
    const threshold = this.getThreshold(namespace, key, context);

    if (!threshold) {
      return {
        passed: true, // 임계값이 없으면 통과로 간주
        threshold: null,
        message: `임계값이 설정되지 않음: ${namespace}.${key} (${context})`
      };
    }

    let passed = false;
    let message = '';

    if (threshold.threshold_type === 'min') {
      passed = value >= threshold.threshold_value;
      message = passed
        ? `통과: ${value} >= ${threshold.threshold_value} (최소값)`
        : `실패: ${value} < ${threshold.threshold_value} (최소값)`;
    } else if (threshold.threshold_type === 'max') {
      passed = value <= threshold.threshold_value;
      message = passed
        ? `통과: ${value} <= ${threshold.threshold_value} (최대값)`
        : `실패: ${value} > ${threshold.threshold_value} (최대값)`;
    }

    return {
      passed,
      threshold,
      message
    };
  }
}

