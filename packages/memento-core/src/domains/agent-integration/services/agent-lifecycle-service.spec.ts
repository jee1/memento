import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentIntegrationSchemaMigration } from '../../../infrastructure/database/database/migration/migrations/035-agent-integration-schema.js';
import { SqliteAgentIntegrationRepository } from '../../../infrastructure/database/repositories/sqlite-agent-integration-repository.js';
import { AgentIntegrationError, AgentLifecycleService } from './agent-lifecycle-service.js';

const startEvent = {
  contractVersion: 1,
  eventId: 'evt-start',
  eventType: 'SESSION_START' as const,
  occurredAt: '2026-06-06T00:00:00.000Z',
  adapterName: 'codex',
  adapterVersion: '1.0.0',
  sessionId: 'session-1',
  sequenceNo: 0,
  scope: { ownerId: 'owner-1', projectId: 'project-1', processId: 'issue-454' },
  payloadJson: '{"client_version":"1.0.0"}',
  payloadSha256: 'a'.repeat(64),
  redactionMetadataJson: '{}',
  captureStatus: 'ACCEPTED' as const,
};

describe('AgentLifecycleService', () => {
  let db: Database.Database;
  let repository: SqliteAgentIntegrationRepository;
  let service: AgentLifecycleService;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
    await new AgentIntegrationSchemaMigration().up(db);
    repository = new SqliteAgentIntegrationRepository(db);
    service = new AgentLifecycleService(repository, {
      retentionDays: 30,
      abandonedTtlMs: 60_000,
      terminalGraceMs: 300_000,
      now: () => new Date('2026-06-06T00:00:10.000Z'),
    });
  });

  afterEach(() => {
    db.close();
  });

  it('creates an active session and its start observation', () => {
    const result = service.capture(startEvent);

    expect(result.status).toBe('ACCEPTED');
    expect(result.lateArrival).toBe(false);
    expect(repository.getSession('session-1')).toMatchObject({
      status: 'ACTIVE',
      adapterName: 'codex',
      maxSequenceNo: 0,
    });
    expect(repository.countObservations('session-1')).toBe(1);
  });

  it('returns the existing observation for an identical idempotent retry', () => {
    const first = service.capture(startEvent);
    const duplicate = service.capture(startEvent);

    expect(duplicate).toMatchObject({
      status: 'DUPLICATE',
      observationId: first.observationId,
    });
    expect(repository.countObservations('session-1')).toBe(1);
  });

  it('rejects the same idempotency key with a different redacted hash', () => {
    service.capture(startEvent);

    expect(() =>
      service.capture({ ...startEvent, payloadSha256: 'b'.repeat(64) }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentIntegrationError>>({
        reasonCode: 'IDEMPOTENCY_CONFLICT',
        httpStatus: 409,
      }),
    );
  });

  it('accepts sequence inversion as a late arrival', () => {
    service.capture(startEvent);
    service.capture({
      ...startEvent,
      eventId: 'evt-high',
      eventType: 'USER_PROMPT',
      sequenceNo: 3,
      payloadSha256: 'c'.repeat(64),
    });

    const late = service.capture({
      ...startEvent,
      eventId: 'evt-low',
      eventType: 'TOOL_RESULT',
      sequenceNo: 2,
      payloadSha256: 'd'.repeat(64),
      toolName: 'exec_command',
      outcome: 'success',
    });

    expect(late.lateArrival).toBe(true);
    expect(repository.getSession('session-1')?.maxSequenceNo).toBe(3);
  });

  it('stores terminal late arrivals within five minutes without reopening the session', () => {
    service.capture(startEvent);
    service.capture({
      ...startEvent,
      eventId: 'evt-stop',
      eventType: 'STOP',
      sequenceNo: 4,
      occurredAt: '2026-06-06T00:00:05.000Z',
      payloadSha256: 'e'.repeat(64),
      outcome: 'completed',
    });

    const late = service.capture({
      ...startEvent,
      eventId: 'evt-terminal-late',
      eventType: 'TOOL_RESULT',
      sequenceNo: 3,
      occurredAt: '2026-06-06T00:04:59.000Z',
      payloadSha256: 'f'.repeat(64),
      outcome: 'success',
    });

    expect(late.lateArrival).toBe(true);
    expect(repository.getSession('session-1')?.status).toBe('COMPLETED');
  });

  it('rejects events received after the terminal grace window', () => {
    service.capture(startEvent);
    service.capture({
      ...startEvent,
      eventId: 'evt-stop',
      eventType: 'STOP',
      sequenceNo: 1,
      occurredAt: '2026-06-06T00:00:05.000Z',
      payloadSha256: '1'.repeat(64),
      outcome: 'completed',
    });

    const afterGrace = new AgentLifecycleService(repository, {
      retentionDays: 30,
      abandonedTtlMs: 60_000,
      terminalGraceMs: 300_000,
      now: () => new Date('2026-06-06T00:05:11.000Z'),
    });

    expect(() =>
      afterGrace.capture({
        ...startEvent,
        eventId: 'evt-too-late',
        eventType: 'TOOL_RESULT',
        sequenceNo: 2,
        payloadSha256: '2'.repeat(64),
      }),
    ).toThrowError(expect.objectContaining({ reasonCode: 'INVALID_SESSION_STATE' }));
  });

  it('marks inactive non-terminal sessions abandoned after the configured TTL', () => {
    service.capture(startEvent);

    const count = service.abandonExpiredSessions(new Date('2026-06-06T00:01:01.000Z'));

    expect(count).toBe(1);
    expect(repository.getSession('session-1')?.status).toBe('ABANDONED');
  });

  it('does not rewrite a failed terminal session as abandoned', () => {
    service.capture(startEvent);
    service.capture({
      ...startEvent,
      eventId: 'evt-failed-stop',
      eventType: 'STOP',
      sequenceNo: 1,
      payloadSha256: '7'.repeat(64),
      outcome: 'failed',
    });

    expect(service.abandonExpiredSessions(new Date('2026-06-06T00:10:00.000Z'))).toBe(0);
    expect(repository.getSession('session-1')?.status).toBe('DEGRADED');
  });

  it('rejects events that do not match the session adapter contract or scope', () => {
    service.capture(startEvent);

    expect(() =>
      service.capture({
        ...startEvent,
        eventId: 'evt-wrong-adapter',
        eventType: 'USER_PROMPT',
        sequenceNo: 1,
        adapterName: 'claude-code',
        payloadSha256: '8'.repeat(64),
      }),
    ).toThrowError(expect.objectContaining({ reasonCode: 'INVALID_SESSION_STATE' }));
  });

  it('applies abandoned TTL before accepting a later lifecycle event', () => {
    service.capture(startEvent);
    const afterTtl = new AgentLifecycleService(repository, {
      retentionDays: 30,
      abandonedTtlMs: 60_000,
      terminalGraceMs: 300_000,
      now: () => new Date('2026-06-06T00:06:00.000Z'),
    });

    expect(() =>
      afterTtl.capture({
        ...startEvent,
        eventId: 'evt-after-abandon',
        eventType: 'USER_PROMPT',
        sequenceNo: 1,
        payloadSha256: '9'.repeat(64),
      }),
    ).toThrowError(expect.objectContaining({ reasonCode: 'INVALID_SESSION_STATE' }));
    expect(repository.getSession('session-1')?.status).toBe('ABANDONED');
  });

  it('links memories to observations and traces their source session', () => {
    const capture = service.capture(startEvent);
    db.prepare('INSERT INTO memory_item (id) VALUES (?)').run('memory-1');

    const provenance = service.linkProvenance({
      memoryId: 'memory-1',
      sessionId: 'session-1',
      observationId: capture.observationId,
      derivationType: 'agent_capture',
    });
    const trace = service.getProvenance({ memoryId: 'memory-1', direction: 'sources' });

    expect(provenance.memoryId).toBe('memory-1');
    expect(trace.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'memory', id: 'memory-1' }),
        expect.objectContaining({ kind: 'observation', id: capture.observationId }),
        expect.objectContaining({ kind: 'session', id: 'session-1' }),
      ]),
    );
  });

  it('respects provenance direction and depth bounds', () => {
    const capture = service.capture(startEvent);
    db.prepare('INSERT INTO memory_item (id) VALUES (?)').run('memory-1');
    service.linkProvenance({
      memoryId: 'memory-1',
      sessionId: 'session-1',
      observationId: capture.observationId,
      derivationType: 'agent_capture',
    });

    expect(service.getProvenance({
      observationId: capture.observationId,
      direction: 'derived',
      maxDepth: 1,
    })).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ kind: 'observation', id: capture.observationId }),
        expect.objectContaining({ kind: 'memory', id: 'memory-1' }),
      ]),
      edges: [
        expect.objectContaining({
          from: `observation:${capture.observationId}`,
          to: 'memory:memory-1',
        }),
      ],
      truncated: false,
    });

    const bounded = service.getProvenance({
      memoryId: 'memory-1',
      direction: 'sources',
      maxDepth: 1,
    });
    expect(bounded.nodes).not.toContainEqual(
      expect.objectContaining({ kind: 'session', id: 'session-1' }),
    );
    expect(bounded.truncated).toBe(true);
  });

  it('rejects provenance links to missing capture sources', () => {
    db.prepare('INSERT INTO memory_item (id) VALUES (?)').run('memory-1');

    expect(() =>
      service.linkProvenance({
        memoryId: 'memory-1',
        sessionId: 'missing-session',
        observationId: 'missing-observation',
        derivationType: 'agent_capture',
      }),
    ).toThrowError(expect.objectContaining({ reasonCode: 'SESSION_NOT_STARTED' }));
  });

  it('expires observation payloads while preserving audit rows and provenance', () => {
    const capture = service.capture(startEvent);
    db.prepare('INSERT INTO memory_item (id) VALUES (?)').run('memory-1');
    service.linkProvenance({
      memoryId: 'memory-1',
      sessionId: 'session-1',
      observationId: capture.observationId,
      derivationType: 'agent_capture',
    });

    const result = service.enforceRetention(new Date('2026-07-07T00:00:11.000Z'));
    const observation = repository.getObservation(capture.observationId);

    expect(result.payloadsCleared).toBe(1);
    expect(observation).toMatchObject({ payloadJson: null, status: 'ACCEPTED' });
    expect(service.getProvenance({ memoryId: 'memory-1' }).edges).toHaveLength(2);
  });

  it('paginates the canonical timeline and returns session aggregates', () => {
    service.capture(startEvent);
    for (let sequenceNo = 1; sequenceNo <= 3; sequenceNo += 1) {
      service.capture({
        ...startEvent,
        eventId: `evt-${sequenceNo}`,
        eventType: sequenceNo === 2 ? 'TOOL_RESULT' : 'USER_PROMPT',
        sequenceNo,
        payloadSha256: String(sequenceNo).repeat(64),
      });
    }

    const firstPage = service.listObservations('session-1', { limit: 2 });
    const secondPage = service.listObservations('session-1', {
      limit: 2,
      cursor: firstPage.nextCursor!,
    });

    expect(firstPage.items.map(item => item.sequenceNo)).toEqual([0, 1]);
    expect(secondPage.items.map(item => item.sequenceNo)).toEqual([2, 3]);
    expect(firstPage.aggregate).toMatchObject({
      total: 4,
      late: 0,
      byEventType: { SESSION_START: 1, USER_PROMPT: 2, TOOL_RESULT: 1 },
      byStatus: { ACCEPTED: 4 },
    });
  });

  it('exports a session and deletes capture rows while preserving deleted provenance', () => {
    const capture = service.capture(startEvent);
    db.prepare('INSERT INTO memory_item (id) VALUES (?)').run('memory-1');
    service.linkProvenance({
      memoryId: 'memory-1',
      sessionId: 'session-1',
      observationId: capture.observationId,
      derivationType: 'agent_capture',
    });

    expect(service.exportSession('session-1')).toMatchObject({
      session: { id: 'session-1' },
      observations: [expect.objectContaining({ id: capture.observationId })],
      provenance: [expect.objectContaining({ memoryId: 'memory-1' })],
    });

    expect(service.deleteSession('session-1')).toBe(true);
    expect(repository.getSession('session-1')).toBeNull();
    expect(repository.countObservations('session-1')).toBe(0);
    expect(service.getProvenance({ memoryId: 'memory-1' }).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'observation', sourceDeleted: true }),
        expect.objectContaining({ kind: 'session', sourceDeleted: true }),
      ]),
    );
  });

  it('exports every observation when a session exceeds one read page', () => {
    service.capture(startEvent);
    for (let sequenceNo = 1; sequenceNo <= 101; sequenceNo += 1) {
      service.capture({
        ...startEvent,
        eventId: `evt-export-${sequenceNo}`,
        eventType: 'USER_PROMPT',
        sequenceNo,
        payloadSha256: sequenceNo.toString(16).padStart(64, '0'),
      });
    }

    expect(service.exportSession('session-1')?.observations).toHaveLength(102);
  });
});
