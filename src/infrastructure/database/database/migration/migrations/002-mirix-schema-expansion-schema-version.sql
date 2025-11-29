-- Migration: 002 - MIRIX Schema Expansion - Schema Version Table
-- Description: Create memento_schema_version table for tracking database schema versions
-- Version: 002
-- Date: 2025-01-XX

-- memento_schema_version 테이블 생성
-- 스키마 버전 관리를 위한 메타데이터 테이블입니다.
-- 클라이언트가 지원하는 기능을 확인하고, 마이그레이션 상태를 추적하는 데 사용됩니다.

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS memento_schema_version (
  version TEXT PRIMARY KEY, -- 스키마 버전 (예: "1.0", "2.0")
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 적용 시간
  migration_name TEXT NOT NULL, -- 마이그레이션 이름 (예: "mirix-schema-expansion")
  checksum TEXT, -- 마이그레이션 스크립트 체크섬 (선택적, 무결성 검증용)
  applied_by TEXT DEFAULT 'system', -- 적용한 사용자/시스템
  description TEXT -- 스키마 버전 설명 (선택적)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_schema_version_applied_at ON memento_schema_version(applied_at);

-- Note: Initial schema version (1.0) should be recorded separately, not in migration SQL
-- MigrationRunner will record the migration version (2.0) after successful execution

COMMIT;
PRAGMA foreign_keys = ON;

