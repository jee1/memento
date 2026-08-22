import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentIntegrationSchemaMigration } from '../../../infrastructure/database/sqlite/migration/migrations/035-agent-integration-schema.js';
import { SqliteAgentIntegrationRepository } from '../../../infrastructure/database/repositories/sqlite-agent-integration-repository.js';
import type { PersistedAgentEventInput } from '../types.js';
import {
  AgentSessionSummaryService,
  type AgentSummaryTelemetryEvent,
} from './agent-session-summary-service.js';

const startEvent: PersistedAgentEventInput = {
  contractVersion: 1,
  eventId: 'evt-start',
  eventType: 'SESSION_START',
  occurredAt: '2026-06-06T00:00:00.000Z',
  adapterName: 'codex',
  adapterVersion: '1.0.0',
  sessionId: 'session-1',
  sequenceNo: 0,
  scope: { ownerId: 'owner-1', projectId: 'project-1', processId: 'issue-464' },
  payloadJson: '{"client_version":"1.0.0"}',
  payloadSha256: 'a'.repeat(64),
  redactionMetadataJson: '{}',
  captureStatus: 'ACCEPTED',
};

describe('AgentSessionSummaryService', () => {
  let db: Database.Database;
  let repository: SqliteAgentIntegrationRepository;
  let telemetry: AgentSummaryTelemetryEvent[];
  let service: AgentSessionSummaryService;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'episodic',
        content TEXT NOT NULL DEFAULT '',
        importance REAL DEFAULT 0.5,
        privacy_scope TEXT DEFAULT 'private',
        tags TEXT,
        source TEXT,
        origin_source TEXT,
        owner_id TEXT,
        process_id TEXT,
        session_id TEXT,
        project_id TEXT,
        source_session_id TEXT,
        created_at TEXT
      )
    `);
    await new AgentIntegrationSchemaMigration().up(db);
    repository = new SqliteAgentIntegrationRepository(db);
    telemetry = [];
    service = new AgentSessionSummaryService(repository, {
      now: () => new Date('2026-06-06T00:00:10.000Z'),
      recordTelemetry: event => telemetry.push(event),
    });
  });

  afterEach(() => {
    db.close();
  });

  function createSession(): void {
    repository.createSession(startEvent, '2026-06-06T00:00:01.000Z');
    repository.createObservation({
      ...startEvent,
      id: 'observation-start',
      lateArrival: false,
      receivedAt: '2026-06-06T00:00:01.000Z',
      expiresAt: null,
    });
  }

  function addObservation(input: Partial<PersistedAgentEventInput> & { id: string }): void {
    repository.createObservation({
      ...startEvent,
      eventId: `evt-${input.id}`,
      eventType: 'USER_PROMPT',
      sequenceNo: 1,
      payloadJson: '{"prompt":"fix the retry bug"}',
      payloadSha256: input.id.padEnd(64, '0').slice(0, 64),
      ...input,
      lateArrival: false,
      receivedAt: '2026-06-06T00:00:02.000Z',
      expiresAt: null,
    });
  }

  it('creates one episodic summary and provenance for every used observation', () => {
    createSession();
    addObservation({ id: 'observation-prompt' });
    addObservation({
      id: 'observation-tool',
      eventType: 'TOOL_RESULT',
      sequenceNo: 2,
      toolName: 'exec_command',
      outcome: 'success',
      payloadJson: JSON.stringify({
        decision: 'use a bounded retry',
        files: ['src/retry.ts'],
        result: 'tests pass',
      }),
    });
    repository.updateSession('session-1', {
      status: 'COMPLETED',
      endedAt: '2026-06-06T00:00:09.000Z',
    }, '2026-06-06T00:00:09.000Z');

    const result = service.summarize('session-1');
    const session = repository.getSession('session-1');
    const memory = db.prepare(`
      SELECT type, content, owner_id, project_id, process_id, session_id, source_session_id
      FROM memory_item WHERE id = ?
    `).get(result.memoryId) as Record<string, unknown>;
    const provenance = repository.listProvenance({ memoryId: result.memoryId! });

    expect(result).toMatchObject({ status: 'CREATED', observationCount: 3 });
    expect(session?.summaryMemoryId).toBe(result.memoryId);
    expect(memory).toMatchObject({
      type: 'episodic',
      owner_id: 'owner-1',
      project_id: 'project-1',
      process_id: 'issue-464',
      session_id: 'session-1',
      source_session_id: 'session-1',
    });
    expect(memory.content).toContain('use a bounded retry');
    expect(memory.content).toContain('src/retry.ts');
    expect(provenance).toHaveLength(3);
    expect(provenance.every(row => row.derivationType === 'summary')).toBe(true);
    expect(telemetry).toEqual([
      expect.objectContaining({
        outcome: 'success',
        sessionId: 'session-1',
        observationCount: 3,
      }),
    ]);
  });

  it('returns the existing summary without creating duplicates', () => {
    createSession();
    addObservation({ id: 'observation-prompt' });
    repository.updateSession('session-1', { status: 'COMPLETED' }, '2026-06-06T00:00:09.000Z');

    const first = service.summarize('session-1');
    const second = service.summarize('session-1');

    expect(second).toEqual({
      status: 'EXISTING',
      memoryId: first.memoryId,
      observationCount: 2,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_item').get()).toEqual({ count: 1 });
    expect(repository.listProvenance({ memoryId: first.memoryId! })).toHaveLength(2);
  });

  it('summarizes abandoned sessions from the observations that remain available', () => {
    createSession();
    addObservation({
      id: 'observation-partial',
      eventType: 'TOOL_RESULT',
      outcome: 'failed',
      payloadJson: '{"error":"build failed before the agent stopped"}',
    });
    repository.updateSession('session-1', {
      status: 'ABANDONED',
      endedAt: '2026-06-06T00:00:09.000Z',
    }, '2026-06-06T00:00:09.000Z');

    const result = service.summarize('session-1');
    const content = db.prepare('SELECT content FROM memory_item WHERE id = ?')
      .get(result.memoryId) as { content: string };

    expect(result.status).toBe('CREATED');
    expect(content.content).toContain('ABANDONED');
    expect(content.content).toContain('build failed before the agent stopped');
  });

  it('skips empty sessions with an explicit reason and telemetry', () => {
    repository.createSession(
      { ...startEvent, payloadJson: null, captureStatus: 'DROPPED', dropReason: 'SENSITIVE_PATH' },
      '2026-06-06T00:00:01.000Z',
    );
    repository.createObservation({
      ...startEvent,
      id: 'observation-dropped',
      payloadJson: null,
      captureStatus: 'DROPPED',
      dropReason: 'SENSITIVE_PATH',
      lateArrival: false,
      receivedAt: '2026-06-06T00:00:01.000Z',
      expiresAt: null,
    });
    repository.updateSession('session-1', { status: 'ABANDONED' }, '2026-06-06T00:00:09.000Z');

    expect(service.summarize('session-1')).toEqual({
      status: 'SKIPPED',
      memoryId: null,
      observationCount: 0,
      reason: 'NO_USABLE_OBSERVATIONS',
    });
    expect(telemetry).toEqual([
      expect.objectContaining({
        outcome: 'empty',
        reason: 'NO_USABLE_OBSERVATIONS',
        observationCount: 0,
      }),
    ]);
  });

  it('redacts secrets again and bounds the final summary payload', () => {
    createSession();
    addObservation({
      id: 'observation-secret',
      payloadJson: JSON.stringify({
        prompt: `token=sk-${'a'.repeat(48)}`,
        output: 'x'.repeat(20_000),
      }),
    });
    repository.updateSession('session-1', { status: 'COMPLETED' }, '2026-06-06T00:00:09.000Z');

    const result = service.summarize('session-1');
    const memory = db.prepare('SELECT content FROM memory_item WHERE id = ?')
      .get(result.memoryId) as { content: string };

    expect(memory.content).not.toContain(`sk-${'a'.repeat(48)}`);
    expect(memory.content).toContain('[REDACTED]');
    expect(Buffer.byteLength(memory.content, 'utf8')).toBeLessThanOrEqual(16 * 1024);
    expect(JSON.stringify(telemetry)).not.toContain(`sk-${'a'.repeat(48)}`);
  });

  it('records failure telemetry and allows a later retry', () => {
    createSession();
    addObservation({ id: 'observation-prompt' });
    repository.updateSession('session-1', { status: 'COMPLETED' }, '2026-06-06T00:00:09.000Z');
    const original = repository.persistSessionSummary.bind(repository);
    const persist = vi.spyOn(repository, 'persistSessionSummary')
      .mockImplementationOnce(() => {
        throw new Error('database unavailable with secret=do-not-record');
      })
      .mockImplementation(original);

    expect(() => service.summarize('session-1')).toThrow('database unavailable');
    expect(repository.getSession('session-1')?.summaryMemoryId).toBeNull();
    expect(telemetry).toEqual([
      expect.objectContaining({
        outcome: 'failure',
        reason: 'SUMMARY_PERSIST_FAILED',
      }),
    ]);
    expect(JSON.stringify(telemetry)).not.toContain('do-not-record');

    expect(service.summarize('session-1').status).toBe('CREATED');
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
