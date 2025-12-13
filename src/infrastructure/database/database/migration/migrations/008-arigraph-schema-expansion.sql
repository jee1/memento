-- Migration: 008 - AriGraph Schema Expansion
-- Description: Add triple extraction fields to memory_item table for AriGraph pipeline
-- Version: 8.0
-- Date: 2025-01-XX
--
-- This migration:
-- 1. Adds subject, predicate, object columns to memory_item table (for semantic memory structural storage)
-- 2. Adds triple_extracted, triple_extracted_status, triple_extraction_metadata columns to memory_item table
-- 3. Creates indexes for triple extraction fields
-- 4. Inserts initial relation types (extracted_from, supported_by) into relation_type_registry

-- ============================================================================
-- 1. Add triple structure columns to memory_item table (for semantic memory)
-- ============================================================================

-- Add subject column (TEXT, NULL allowed, for semantic memory only)
ALTER TABLE memory_item ADD COLUMN subject TEXT;

-- Add predicate column (TEXT, NULL allowed, for semantic memory only)
ALTER TABLE memory_item ADD COLUMN predicate TEXT;

-- Add object column (TEXT, NULL allowed, for semantic memory only)
ALTER TABLE memory_item ADD COLUMN object TEXT;

-- ============================================================================
-- 2. Add triple extraction tracking columns to memory_item table
-- ============================================================================

-- Add triple_extracted column (BOOLEAN, NULL allowed, default NULL)
-- NULL: 미처리, TRUE: 성공, FALSE: 실패 또는 미처리
ALTER TABLE memory_item ADD COLUMN triple_extracted BOOLEAN DEFAULT NULL;

-- Add triple_extracted_status column (TEXT, NULL allowed, default NULL)
-- NULL: 미처리, 'success': 성공, 'failed': 실패, 'abandoned': 포기
ALTER TABLE memory_item ADD COLUMN triple_extracted_status TEXT DEFAULT NULL;

-- Add triple_extraction_metadata column (TEXT, NULL allowed, JSON format, default NULL)
-- 성공 시: {"triple_count": 3, "confidence_avg": 0.85, "extracted_at": "2025-01-XX"}
-- 실패 시: {"failureReason": "no_triple", "retry_count": 2, "last_attempt": "2025-01-XX"}
-- 포기 시: {"failureReason": "llm_api_error", "retry_count": 3, "last_attempt": "2025-01-XX", "abandoned_at": "2025-01-XX"}
ALTER TABLE memory_item ADD COLUMN triple_extraction_metadata TEXT DEFAULT NULL;

-- ============================================================================
-- 3. Create indexes for triple extraction fields
-- ============================================================================

-- Partial index for triple structure (only for semantic memory with triple data)
-- This index is used for efficient triple-based queries
CREATE INDEX IF NOT EXISTS idx_memory_item_triple ON memory_item(subject, predicate, object)
WHERE type='semantic' AND subject IS NOT NULL AND predicate IS NOT NULL AND object IS NOT NULL;

-- Index for triple_extracted field (for batch job queries)
CREATE INDEX IF NOT EXISTS idx_memory_item_triple_extracted ON memory_item(triple_extracted);

-- Index for triple_extracted_status field (for batch job queries and statistics)
CREATE INDEX IF NOT EXISTS idx_memory_item_triple_status ON memory_item(triple_extracted_status);

-- ============================================================================
-- 4. Insert initial relation types for AriGraph pipeline
-- ============================================================================
-- Note: These relation types are used for Episodic-Edge creation
-- extracted_from: Episodic → Semantic (source: Episodic, target: Semantic)
-- supported_by: Semantic → Episodic (source: Semantic, target: Episodic)

-- Insert extracted_from relation type (Structural category)
INSERT OR IGNORE INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
VALUES (
  'extracted_from',
  'Structural',
  '추출 관계: Semantic Memory가 Episodic Memory에서 추출됨',
  '["episodic", "semantic"]',
  0.7,
  1.1
);

-- Insert supported_by relation type (Structural category)
INSERT OR IGNORE INTO relation_type_registry (type_name, category, description, applicable_types, default_confidence, search_boost)
VALUES (
  'supported_by',
  'Structural',
  '근거 관계: Semantic Memory가 Episodic Memory에 의해 근거를 가짐',
  '["semantic", "episodic"]',
  0.7,
  1.0
);

