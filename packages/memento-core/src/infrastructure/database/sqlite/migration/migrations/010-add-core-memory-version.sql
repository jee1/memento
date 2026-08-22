-- Migration: 010 - Add Core Memory Version Column
-- Description: Add version column to core_memory table for cache invalidation
-- Version: 10.0
-- Date: 2025-12-25

-- Core Memory 테이블에 version 컬럼 추가
-- version 컬럼은 캐시 무효화를 위한 단조 증가하는 버전 번호입니다.
-- INSERT 시: version = 1
-- UPDATE 시: version = version + 1

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- 1. version 컬럼 추가 (기본값 0)
ALTER TABLE core_memory ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- 2. 기존 행에 version = 1 설정 (마이그레이션 전 데이터는 초기 버전으로 설정)
UPDATE core_memory SET version = 1 WHERE version = 0;

-- 3. version 컬럼에 대한 인덱스 생성 (버전 기반 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_core_memory_version ON core_memory(version);

COMMIT;
PRAGMA foreign_keys = ON;

