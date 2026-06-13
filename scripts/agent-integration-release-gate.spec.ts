import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  evaluateAgentIntegrationReleaseGate,
  type ReleaseGateEvidence,
} from './agent-integration-release-gate.js';

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE agent_session (
      id TEXT PRIMARY KEY,
      summary_memory_id TEXT
    );
    CREATE TABLE agent_observation (
      id TEXT PRIMARY KEY,
      adapter_name TEXT NOT NULL,
      event_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT,
      received_at TEXT NOT NULL
    );
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL
    );
    CREATE TABLE memory_provenance (
      memory_id TEXT NOT NULL,
      observation_id TEXT,
      derivation_type TEXT NOT NULL
    );
    CREATE TABLE agent_memory_promotion_candidate (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      memory_id TEXT
    );
    CREATE TABLE telemetry_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      latency_ms REAL,
      outcome TEXT NOT NULL,
      extra_data TEXT
    );
  `);
  return db;
}

function passingEvidence(): ReleaseGateEvidence {
  return {
    hook_return_latency_ms: [10, 20, 30],
    agent_attempts: 3,
    agent_unblocked_attempts: 3,
    queue_dropped_count: 0,
    secret_fixtures: ['release-gate-secret'],
    regressions: {
      benchmark_v3: true,
      mcp_tools: true,
      assistant: true,
    },
  };
}

function seedPassingDatabase(db: Database.Database): void {
  db.prepare('INSERT INTO agent_session VALUES (?, ?)').run('session-1', 'summary-1');
  db.prepare('INSERT INTO memory_item VALUES (?, ?)').run('summary-1', 'safe summary');
  db.prepare(`
    INSERT INTO agent_observation
      (id, adapter_name, event_id, session_id, status, payload_json, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('observation-1', 'codex', 'event-1', 'session-1', 'ACCEPTED', '{}', '2026-06-13T00:00:00Z');
  db.prepare('INSERT INTO memory_provenance VALUES (?, ?, ?)').run(
    'summary-1',
    'observation-1',
    'summary',
  );
  db.prepare(`
    INSERT INTO telemetry_events VALUES (?, ?, ?, ?, ?)
  `).run(
    'telemetry-1',
    'agent.injection.completed',
    100,
    'success',
    JSON.stringify({ token_budget: 1000, token_used: 400, budget_exceeded: false }),
  );
}

describe('agent integration release gate', () => {
  it('passes only when every KPI has measured evidence', () => {
    const db = createDatabase();
    seedPassingDatabase(db);

    const report = evaluateAgentIntegrationReleaseGate(db, passingEvidence());

    expect(report.status).toBe('pass');
    expect(report.checks.every(check => check.status === 'pass')).toBe(true);
    db.close();
  });

  it('fails closed when evidence is absent', () => {
    const db = createDatabase();

    const report = evaluateAgentIntegrationReleaseGate(db, {
      hook_return_latency_ms: [],
      agent_attempts: 0,
      agent_unblocked_attempts: 0,
      queue_dropped_count: 0,
      secret_fixtures: [],
      regressions: {},
    });

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'capture_success_rate', status: 'insufficient_evidence' }),
      expect.objectContaining({ name: 'hook_return_p95_ms', status: 'insufficient_evidence' }),
      expect.objectContaining({ name: 'secret_leak_count', status: 'insufficient_evidence' }),
      expect.objectContaining({ name: 'regression_suite', status: 'insufficient_evidence' }),
    ]));
    db.close();
  });

  it('detects provenance gaps, budget overflow, duplicate events, and secret leaks', () => {
    const db = createDatabase();
    seedPassingDatabase(db);
    db.prepare('INSERT INTO agent_session VALUES (?, ?)').run('session-2', 'summary-2');
    db.prepare('INSERT INTO memory_item VALUES (?, ?)').run(
      'summary-2',
      'contains release-gate-secret',
    );
    db.prepare(`
      INSERT INTO agent_observation
        (id, adapter_name, event_id, session_id, status, payload_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('observation-2', 'codex', 'event-1', 'session-2', 'DROPPED', '{}', '2026-06-13T00:00:01Z');
    db.prepare(`
      INSERT INTO telemetry_events VALUES (?, ?, ?, ?, ?)
    `).run(
      'telemetry-2',
      'agent.injection.completed',
      2000,
      'success',
      JSON.stringify({ token_budget: 100, token_used: 101, budget_exceeded: true }),
    );

    const report = evaluateAgentIntegrationReleaseGate(db, passingEvidence());

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'provenance_coverage', status: 'fail' }),
      expect.objectContaining({ name: 'injection_budget_exceeded', status: 'fail' }),
      expect.objectContaining({ name: 'duplicate_event_rows', status: 'fail' }),
      expect.objectContaining({ name: 'secret_leak_count', status: 'fail' }),
    ]));
    db.close();
  });
});
