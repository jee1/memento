import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { queryFeedbackQuality } from './telemetry-feedback-quality-query.js';

describe('queryFeedbackQuality', () => {
  it('helpful_rate와 ranking context 집계를 반환한다', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE feedback_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        event TEXT NOT NULL,
        score REAL,
        comment TEXT,
        session_id TEXT,
        agent_id TEXT,
        score_breakdown_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const insert = db.prepare(
      `INSERT INTO feedback_event (memory_id, event, agent_id, score_breakdown_json, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );
    insert.run('m1', 'helpful', 'agent-a', '{"relevance":{"score":0.5,"pct":50}}');
    insert.run('m2', 'helpful', 'agent-a', null);
    insert.run('m3', 'not_helpful', 'agent-a', '{"feedback":{"score":0.1,"pct":5}}');
    insert.run('m4', 'helpful', 'agent-b', null);

    const all = queryFeedbackQuality(db, '24h', null);
    expect(all.positive_count).toBe(3);
    expect(all.negative_count).toBe(1);
    expect(all.helpful_rate).toBeCloseTo(0.75);
    expect(all.feedback_with_ranking_context_count).toBe(2);

    const filtered = queryFeedbackQuality(db, '24h', 'agent-a');
    expect(filtered.positive_count).toBe(2);
    expect(filtered.negative_count).toBe(1);
    expect(filtered.helpful_rate).toBeCloseTo(2 / 3);
    expect(filtered.feedback_with_ranking_context_count).toBe(2);

    db.close();
  });

  it('피드백이 없으면 helpful_rate는 null', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE feedback_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        event TEXT NOT NULL,
        agent_id TEXT,
        score_breakdown_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const result = queryFeedbackQuality(db, '7d', null);
    expect(result.positive_count).toBe(0);
    expect(result.negative_count).toBe(0);
    expect(result.helpful_rate).toBeNull();
    expect(result.feedback_with_ranking_context_count).toBe(0);
    db.close();
  });
});
