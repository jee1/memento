-- Migration: 009 - Quality Assurance Schema
-- Description: Create quality measurement tables for quality assurance system
-- Version: 9.0
-- Date: 2025-01-XX
--
-- This migration:
-- 1. Creates quality_measurement_history table for tracking quality measurement history
-- 2. Creates quality_metrics table for storing latest quality metric values
-- 3. Creates quality_thresholds table for managing quality thresholds
-- 4. Creates indexes for efficient queries

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- ============================================================================
-- 1. Create quality_measurement_history table
-- ============================================================================
-- 품질 측정 이력 테이블: 각 품질 측정 실행의 전체 이력을 저장
-- measurement_type: 'batch', 'test', 'manual'
-- status: 'success', 'warning', 'error'
-- metrics: JSON 형식으로 측정된 모든 지표 데이터 저장
-- warnings: 임계값 미달 시 경고 정보 저장

CREATE TABLE IF NOT EXISTS quality_measurement_history (
  id TEXT PRIMARY KEY,
  measurement_type TEXT NOT NULL CHECK (measurement_type IN ('batch', 'test', 'manual')),
  measured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metrics TEXT NOT NULL, -- JSON 형식: 품질 지표 데이터
  -- metrics JSON 구조 예시:
  -- {
  --   "metric_namespace": "search",
  --   "metric_key": "precision_at_5",
  --   "context": "default",
  --   "value": 0.85,
  --   "threshold_value": 0.8,
  --   "evaluator_version": "1.0.0"
  -- }
  status TEXT NOT NULL CHECK (status IN ('success', 'warning', 'error')) DEFAULT 'success',
  warnings TEXT, -- JSON 형식: 경고 정보 (임계값 미달 시)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. Create quality_metrics table
-- ============================================================================
-- 품질 지표 테이블: 최신 측정값을 저장 (namespace, key, context 조합별로 최신 값 유지)
-- metric_namespace: 'search', 'relation', 'consolidation', 'storage' 등
-- metric_key: 'precision_at_5', 'f1_score', 'duplication_rate' 등
-- context: 'default', 'ci', 'nightly' 등 (측정 컨텍스트)
-- status: 'pass', 'warning', 'fail' (임계값 비교 결과)

CREATE TABLE IF NOT EXISTS quality_metrics (
  metric_namespace TEXT NOT NULL, -- 'search', 'relation', 'consolidation', 'storage'
  metric_key TEXT NOT NULL, -- 'precision_at_5', 'f1_score', 'duplication_rate' 등
  context TEXT NOT NULL DEFAULT 'default', -- 'default', 'ci', 'nightly'
  metric_value REAL NOT NULL,
  measured_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warning', 'fail')) DEFAULT 'pass',
  threshold_value REAL, -- 임계값 (측정 시점의 임계값)
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_namespace, metric_key, context)
);

-- ============================================================================
-- 3. Create quality_thresholds table
-- ============================================================================
-- 품질 임계값 테이블: 각 품질 지표별 임계값 관리
-- threshold_type: 'min' (최소값, 이상이어야 함), 'max' (최대값, 이하여야 함)
-- 예: precision_at_5의 threshold_type='min', threshold_value=0.7
--     duplication_rate의 threshold_type='max', threshold_value=0.05

CREATE TABLE IF NOT EXISTS quality_thresholds (
  metric_namespace TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT 'default',
  threshold_value REAL NOT NULL,
  threshold_type TEXT NOT NULL CHECK (threshold_type IN ('min', 'max')),
  description TEXT, -- 임계값 설명
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_namespace, metric_key, context)
);

-- ============================================================================
-- 4. Create indexes for efficient queries
-- ============================================================================

-- quality_measurement_history indexes
-- 측정 시간 기준 조회 (이력 조회)
CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_measured_at 
  ON quality_measurement_history(measured_at);

-- 측정 타입 기준 조회 (배치/테스트/수동 구분)
CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_type 
  ON quality_measurement_history(measurement_type);

-- 상태 기준 조회 (경고/에러 필터링)
CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_status 
  ON quality_measurement_history(status);

-- quality_metrics indexes
-- namespace와 key 조합 기준 조회 (특정 지표 조회)
CREATE INDEX IF NOT EXISTS idx_quality_metrics_namespace_key 
  ON quality_metrics(metric_namespace, metric_key);

-- context 기준 조회 (컨텍스트별 조회)
CREATE INDEX IF NOT EXISTS idx_quality_metrics_context 
  ON quality_metrics(context);

-- 상태 기준 조회 (경고/실패 필터링)
CREATE INDEX IF NOT EXISTS idx_quality_metrics_status 
  ON quality_metrics(status);

-- 측정 시간 기준 조회 (최신 측정값 조회)
CREATE INDEX IF NOT EXISTS idx_quality_metrics_measured_at 
  ON quality_metrics(measured_at);

-- quality_thresholds indexes
-- namespace와 key 조합 기준 조회 (특정 임계값 조회)
CREATE INDEX IF NOT EXISTS idx_quality_thresholds_namespace_key 
  ON quality_thresholds(metric_namespace, metric_key);

-- context 기준 조회 (컨텍스트별 임계값 조회)
CREATE INDEX IF NOT EXISTS idx_quality_thresholds_context 
  ON quality_thresholds(context);

COMMIT;
PRAGMA foreign_keys = ON;

