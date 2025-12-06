-- Migration: 007 - Procedural Memory Enhancement
-- Description: Add workflow_name, skill_name, trigger_conditions fields to memory_item table and extend memory_link relation_type enum
-- Version: 7.0
-- Date: 2025-01-XX
--
-- This migration:
-- 1. Adds workflow_name, skill_name, trigger_conditions fields to memory_item table
-- 2. Creates indexes for new fields (workflow_name, skill_name)
-- 3. Extends memory_link relation_type enum to include 'version_of' for version management

-- ============================================================================
-- 1. Add new fields to memory_item table
-- ============================================================================

-- Add workflow_name field (TEXT, NULL allowed for backward compatibility)
ALTER TABLE memory_item ADD COLUMN workflow_name TEXT;

-- Add skill_name field (TEXT, NULL allowed for backward compatibility)
ALTER TABLE memory_item ADD COLUMN skill_name TEXT;

-- Add trigger_conditions field (TEXT, NULL allowed, JSON object string)
ALTER TABLE memory_item ADD COLUMN trigger_conditions TEXT;

-- ============================================================================
-- 2. Create indexes for new fields
-- ============================================================================

-- Index for workflow_name (for search performance)
CREATE INDEX IF NOT EXISTS idx_memory_item_workflow_name ON memory_item(workflow_name);

-- Index for skill_name (for search performance)
CREATE INDEX IF NOT EXISTS idx_memory_item_skill_name ON memory_item(skill_name);

-- ============================================================================
-- 3. Extend memory_link relation_type enum to include 'version_of'
-- ============================================================================
-- Note: SQLite does not support direct modification of CHECK constraints.
-- We need to recreate the table with the extended enum values.

-- Step 3.1: Create new memory_link table with extended relation_type enum
CREATE TABLE memory_link_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT CHECK (relation_type IN ('cause_of', 'derived_from', 'duplicates', 'contradicts', 'version_of')) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(source_id, target_id, relation_type)
);

-- Step 3.2: Copy existing data from old table to new table
INSERT INTO memory_link_new (id, source_id, target_id, relation_type, created_at)
SELECT id, source_id, target_id, relation_type, created_at
FROM memory_link;

-- Step 3.3: Drop old table
DROP TABLE memory_link;

-- Step 3.4: Rename new table to original name
ALTER TABLE memory_link_new RENAME TO memory_link;

-- Step 3.5: Recreate indexes (they are automatically dropped when table is dropped)
CREATE INDEX IF NOT EXISTS idx_memory_link_source ON memory_link(source_id);
CREATE INDEX IF NOT EXISTS idx_memory_link_target ON memory_link(target_id);

