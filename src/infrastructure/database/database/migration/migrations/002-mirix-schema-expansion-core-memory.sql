-- Migration: 002 - MIRIX Schema Expansion - Core Memory Table
-- Description: Create core_memory table for storing agent's core persona, instructions, and identity data
-- Version: 002
-- Date: 2025-01-XX

-- Core Memory 테이블 생성
-- Core Memory는 에이전트의 핵심 정체성, 지침, 인격 데이터를 저장합니다.
-- always_load=true인 항목은 서버 시작 시 자동으로 로드되어 메모리에 유지됩니다.

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS core_memory (
  core_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  always_load BOOLEAN NOT NULL DEFAULT 0,
  origin_source TEXT, -- JSON 형식: {"tool": "remember", "caller": "user", "timestamp": "...", "context": {...}}
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_id, key)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_core_memory_agent_id ON core_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_core_memory_key ON core_memory(key);
CREATE INDEX IF NOT EXISTS idx_core_memory_created_at ON core_memory(created_at);
CREATE INDEX IF NOT EXISTS idx_core_memory_always_load ON core_memory(always_load);

-- updated_at 자동 업데이트 트리거
CREATE TRIGGER IF NOT EXISTS core_memory_update_timestamp 
AFTER UPDATE ON core_memory
BEGIN
  UPDATE core_memory 
  SET updated_at = CURRENT_TIMESTAMP 
  WHERE core_id = NEW.core_id;
END;

COMMIT;
PRAGMA foreign_keys = ON;

