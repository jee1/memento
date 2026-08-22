-- Migration: 002 - MIRIX Schema Expansion - Knowledge Vault Table
-- Description: Create knowledge_vault table for storing immutable knowledge data
-- Version: 002
-- Date: 2025-01-XX

-- Knowledge Vault 테이블 생성
-- Knowledge Vault는 변경 불가능한 영구 지식 저장소입니다.
-- immutable=true인 경우 업데이트/삭제가 제한되며, 버전 관리가 가능합니다.
-- 향후 확장 필드(admin_override, deleted_at)는 스키마만 준비하고 실제 로직은 후속 작업으로 진행합니다.

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS knowledge_vault (
  vault_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  immutable BOOLEAN NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  previous_version_id TEXT, -- 이전 버전의 vault_id 참조
  admin_override BOOLEAN NOT NULL DEFAULT 0, -- 향후 관리자 Override 기능용 (Phase 2)
  deleted_at TIMESTAMP, -- 향후 Soft Delete 기능용 (Phase 2)
  origin_source TEXT, -- JSON 형식: {"tool": "remember", "caller": "user", "timestamp": "...", "context": {...}}
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_id, key, version)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_knowledge_vault_agent_id ON knowledge_vault(agent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_vault_key ON knowledge_vault(key);
CREATE INDEX IF NOT EXISTS idx_knowledge_vault_version ON knowledge_vault(version);
CREATE INDEX IF NOT EXISTS idx_knowledge_vault_deleted_at ON knowledge_vault(deleted_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_vault_agent_key ON knowledge_vault(agent_id, key);

-- updated_at 자동 업데이트 트리거
CREATE TRIGGER IF NOT EXISTS knowledge_vault_update_timestamp 
AFTER UPDATE ON knowledge_vault
BEGIN
  UPDATE knowledge_vault 
  SET updated_at = CURRENT_TIMESTAMP 
  WHERE vault_id = NEW.vault_id;
END;

COMMIT;
PRAGMA foreign_keys = ON;

