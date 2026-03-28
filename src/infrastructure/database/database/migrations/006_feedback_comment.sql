-- Migration: feedback_event optional comment (mirrors TS migration 022-feedback-event-comment)
-- Optional text from HTTP client (e.g. @memento/client feedback comment)

ALTER TABLE feedback_event ADD COLUMN comment TEXT;
