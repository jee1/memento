-- Migration: 006 - FTS5 Reflection Notes Column
-- Description: Create new FTS5 table (memory_item_fts_new) with reflection_notes column for Zero-Downtime migration
-- Version: 6.0
-- Date: 2025-01-XX
--
-- This is Step 1 of the Zero-Downtime migration strategy:
-- 1. Create new FTS5 table with reflection_notes column
-- 2. Re-index existing data (Step 2, handled separately)
-- 3. Create temporary dual triggers (Step 3, handled separately)
-- 4. Atomic table replacement (Step 4, handled separately)
-- 5. Activate new triggers (Step 5, handled separately)

-- Create new FTS5 virtual table with reflection_notes column
CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts_new USING fts5(
  content,
  tags,
  source,
  reflection_notes,  -- New column for reflection notes search
  content='memory_item',
  content_rowid='rowid'
);

-- Note: This migration only creates the new table.
-- Data re-indexing, trigger creation, and table replacement are handled in subsequent steps
-- to ensure Zero-Downtime migration.

