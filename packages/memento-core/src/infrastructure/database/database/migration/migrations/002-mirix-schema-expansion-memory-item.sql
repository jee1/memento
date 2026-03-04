-- Migration: 002 - MIRIX Schema Expansion - Memory Item Table Fields
-- Description: Add new fields to memory_item table (origin_source, task_goal, steps, reflection_notes)
-- Version: 002
-- Date: 2025-01-XX

-- memory_item 테이블에 새 필드 추가
-- origin_source: 모든 메모리 타입에 사용되는 데이터 출처 추적 필드 (JSON 형식)
-- task_goal, steps, reflection_notes: Procedural Memory 전용 필드

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- origin_source 필드 추가 (JSON 형식, 모든 메모리 타입에 사용)
-- 형식: {"tool": "remember", "caller": "user|system|reflexion_worker", "timestamp": "...", "context": {...}}
ALTER TABLE memory_item ADD COLUMN origin_source TEXT;

-- task_goal 필드 추가 (Procedural Memory 전용, 작업 목표)
ALTER TABLE memory_item ADD COLUMN task_goal TEXT;

-- steps 필드 추가 (Procedural Memory 전용, JSON 배열 형식)
-- 예시: "[\"step1\", \"step2\", \"step3\"]"
ALTER TABLE memory_item ADD COLUMN steps TEXT;

-- reflection_notes 필드 추가 (Procedural Memory 전용, JSON 형식)
-- 예시: {"failure_type": "tool_error", "failure_description": "...", "lessons_learned": "...", ...}
ALTER TABLE memory_item ADD COLUMN reflection_notes TEXT;

-- 기존 데이터의 origin_source 필드 기본값 설정 (NULL → 빈 JSON 객체)
UPDATE memory_item 
SET origin_source = '{}' 
WHERE origin_source IS NULL;

COMMIT;
PRAGMA foreign_keys = ON;

