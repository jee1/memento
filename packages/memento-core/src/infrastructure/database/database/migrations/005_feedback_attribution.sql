-- Migration: feedback_event attribution (session_id, agent_id)
-- Mirrors TS migration 021-feedback-event-attribution for reference.
-- SQLite는 ALTER TABLE 구간에서 외래키 검사가 방해될 수 있어, 트랜잭션 전에 잠시 끄고 끝에서 다시 켠다.

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

ALTER TABLE feedback_event ADD COLUMN session_id TEXT;
ALTER TABLE feedback_event ADD COLUMN agent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback_event(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_event(agent_id);

COMMIT;
PRAGMA foreign_keys = ON;
