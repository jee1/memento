-- Migration: 003 - Consolidation Score Fields
-- Description: Add consolidation score system fields to memory_item table
-- Version: 3.0
-- Date: 2025-01-XX
--
-- This migration adds the following fields to memory_item table:
-- - recall_count: Number of times the memory has been successfully retrieved
-- - last_accessed_at: Timestamp of the last access
-- - consolidation_score: Dynamic consolidation score (0.0 ~ 1.0)
-- - g_value: Current value of decay constant g_n (for performance optimization)
--
-- Also creates indexes for performance optimization:
-- - idx_memory_item_last_accessed: Index on last_accessed_at DESC
-- - idx_memory_item_consol_desc: Index on consolidation_score DESC
-- - idx_memory_item_consol_active: Partial index on consolidation_score > 0.2

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- recall_count 필드 추가 (INTEGER, NOT NULL, DEFAULT 0)
-- 해당 기억이 성공적으로 검색되어 활용된 횟수
ALTER TABLE memory_item ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;

-- last_accessed_at 필드 추가 (TIMESTAMP, NULL 허용)
-- 해당 기억이 마지막으로 접근된 시간
ALTER TABLE memory_item ADD COLUMN last_accessed_at TIMESTAMP;

-- consolidation_score 필드 추가 (REAL, NULL 허용)
-- 동적 기억 통합 점수 (0.0 ~ 1.0 범위)
ALTER TABLE memory_item ADD COLUMN consolidation_score REAL;

-- g_value 필드 추가 (REAL, NULL 허용)
-- 감쇠 상수 g_n의 현재 값 (성능 최적화용)
-- 점화식 g_n = g_{n-1} + S(t)의 결과를 저장하여 배치 작업 시 연산 비용 절감
ALTER TABLE memory_item ADD COLUMN g_value REAL;

-- 인덱스 생성: last_accessed_at DESC
-- 최근 접근된 메모리를 빠르게 조회하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed_at DESC);

-- 인덱스 생성: consolidation_score DESC
-- 높은 통합 점수를 가진 메모리를 빠르게 조회하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_memory_item_consol_desc ON memory_item(consolidation_score DESC);

-- Partial Index 생성: consolidation_score > 0.2
-- 활성화된 메모리(점수 > 0.2)에 대해서만 인덱스를 생성하여 인덱스 크기 최적화
-- 저점수 메모리는 인덱스에서 제외하여 검색 성능 향상 및 저장 공간 절약
CREATE INDEX IF NOT EXISTS idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2;

COMMIT;
PRAGMA foreign_keys = ON;

