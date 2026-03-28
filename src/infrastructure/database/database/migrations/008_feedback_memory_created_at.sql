-- Migration: composite index for getNetScores-style filters (memory_id IN (...) AND created_at window)
-- Mirrors TS migration 024-feedback-event-memory-created-at-index for reference.

CREATE INDEX IF NOT EXISTS idx_feedback_memory_created_at ON feedback_event(memory_id, created_at);
