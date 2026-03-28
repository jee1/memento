-- Migration: feedback_event optional score_breakdown_json (mirrors TS migration 023-feedback-event-score-breakdown)
-- Stores JSON snapshot of recall score_breakdown when provided with feedback (US3).

ALTER TABLE feedback_event ADD COLUMN score_breakdown_json TEXT;
