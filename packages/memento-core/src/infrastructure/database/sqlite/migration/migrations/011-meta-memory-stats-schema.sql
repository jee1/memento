-- Migration: 011 - Meta Memory Statistics Schema
-- Description: Create meta_memory_stats table for collecting recall statistics
-- Version: 11.0
-- Date: 2025-01-XX
--
-- This migration creates the meta_memory_stats table to track:
-- - recall_count: Total number of times a memory has been recalled
-- - success_count: Number of successful recalls (final_score >= 0.5)
-- - failure_count: Number of failed recalls (final_score < 0.5)
-- - avg_confidence: Average confidence score (0.6 * final_score + 0.3 * consolidation_score + 0.1 * vector_score)
-- - last_recalled_at: Timestamp of the last recall
-- - created_at: Timestamp when the record was created
-- - updated_at: Timestamp when the record was last updated (auto-updated via trigger)
--
-- Also creates indexes for performance optimization:
-- - idx_meta_memory_stats_recall_count: Index on recall_count DESC
-- - idx_meta_memory_stats_avg_confidence: Index on avg_confidence DESC
-- - idx_meta_memory_stats_last_recalled_at: Index on last_recalled_at DESC
-- - idx_meta_memory_stats_failure_count: Index on failure_count DESC

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- meta_memory_stats 테이블 생성
-- 각 메모리 항목의 recall 통계를 저장하는 테이블
CREATE TABLE IF NOT EXISTS meta_memory_stats (
  memory_id TEXT PRIMARY KEY,
  recall_count INTEGER DEFAULT 0 NOT NULL,
  success_count INTEGER DEFAULT 0 NOT NULL,
  failure_count INTEGER DEFAULT 0 NOT NULL,
  avg_confidence REAL DEFAULT 0.0 NOT NULL,
  last_recalled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
);

-- 인덱스 생성: recall_count DESC
-- 자주 호출되는 메모리를 빠르게 조회하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_recall_count ON meta_memory_stats(recall_count DESC);

-- 인덱스 생성: avg_confidence DESC
-- 높은 신뢰도를 가진 메모리를 빠르게 조회하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_avg_confidence ON meta_memory_stats(avg_confidence DESC);

-- 인덱스 생성: last_recalled_at DESC
-- 최근에 호출된 메모리를 빠르게 조회하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_last_recalled_at ON meta_memory_stats(last_recalled_at DESC);

-- 인덱스 생성: failure_count DESC
-- 자주 실패하는 메모리를 빠르게 조회하기 위한 인덱스 (품질 개선 대상 식별)
CREATE INDEX IF NOT EXISTS idx_meta_memory_stats_failure_count ON meta_memory_stats(failure_count DESC);

-- 트리거 생성: updated_at 자동 업데이트
-- 레코드가 업데이트될 때마다 updated_at을 현재 시간으로 자동 업데이트
-- updated_at이 명시적으로 변경되지 않은 경우에만 업데이트 (무한 루프 방지)
CREATE TRIGGER IF NOT EXISTS trigger_meta_memory_stats_updated_at
  AFTER UPDATE ON meta_memory_stats
  FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE meta_memory_stats
  SET updated_at = CURRENT_TIMESTAMP
  WHERE memory_id = NEW.memory_id;
END;

COMMIT;
PRAGMA foreign_keys = ON;
