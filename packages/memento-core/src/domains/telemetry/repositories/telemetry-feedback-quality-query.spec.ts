import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { queryFeedbackQuality } from './telemetry-feedback-quality-query.js';

function createTelemetryEventsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE telemetry_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      request_id TEXT,
      owner_id TEXT,
      latency_ms INTEGER,
      outcome TEXT,
      error_code TEXT,
      extra_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function insertSearchRequested(
  db: Database.Database,
  ownerId: string | null,
  id = randomUUID()
): void {
  db.prepare(
    `INSERT INTO telemetry_events (id, event_type, owner_id, created_at)
     VALUES (?, 'memory.search.requested', ?, datetime('now'))`
  ).run(id, ownerId);
}

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
    createTelemetryEventsTable(db);
    const insert = db.prepare(
      `INSERT INTO feedback_event (memory_id, event, agent_id, score_breakdown_json, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );
    insert.run('m1', 'helpful', 'agent-a', '{"relevance":{"score":0.5,"pct":50}}');
    insert.run('m2', 'helpful', 'agent-a', null);
    insert.run('m3', 'not_helpful', 'agent-a', '{"feedback":{"score":0.1,"pct":5}}');
    insert.run('m4', 'helpful', 'agent-b', null);
    // recall 10건 중 4건만 feedback → 미피드백 비율 0.6
    for (let i = 0; i < 8; i++) insertSearchRequested(db, 'agent-a');
    for (let i = 0; i < 2; i++) insertSearchRequested(db, 'agent-b');

    const all = queryFeedbackQuality(db, '24h', null);
    expect(all.positive_count).toBe(3);
    expect(all.negative_count).toBe(1);
    expect(all.helpful_rate).toBeCloseTo(0.75);
    expect(all.feedback_with_ranking_context_count).toBe(2);
    expect(all.recall_count).toBe(10);
    expect(all.recall_without_feedback_rate).toBeCloseTo(0.6);

    const filtered = queryFeedbackQuality(db, '24h', 'agent-a');
    expect(filtered.positive_count).toBe(2);
    expect(filtered.negative_count).toBe(1);
    expect(filtered.helpful_rate).toBeCloseTo(2 / 3);
    expect(filtered.feedback_with_ranking_context_count).toBe(2);
    expect(filtered.recall_count).toBe(8);
    expect(filtered.recall_without_feedback_rate).toBeCloseTo(1 - 3 / 8);

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
    createTelemetryEventsTable(db);
    const result = queryFeedbackQuality(db, '7d', null);
    expect(result.positive_count).toBe(0);
    expect(result.negative_count).toBe(0);
    expect(result.helpful_rate).toBeNull();
    expect(result.feedback_with_ranking_context_count).toBe(0);
    expect(result.recall_count).toBe(0);
    expect(result.recall_without_feedback_rate).toBeNull();
    db.close();
  });

  it('recall은 있지만 feedback이 전혀 없으면 미피드백 비율은 1', () => {
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
    createTelemetryEventsTable(db);
    insertSearchRequested(db, null);
    insertSearchRequested(db, null);
    const result = queryFeedbackQuality(db, '24h', null);
    expect(result.recall_count).toBe(2);
    expect(result.recall_without_feedback_rate).toBe(1);
    db.close();
  });
});
