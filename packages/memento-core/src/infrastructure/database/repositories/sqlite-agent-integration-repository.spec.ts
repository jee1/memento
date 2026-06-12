import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentCaptureStatus,
  AgentSessionStatus,
  PersistedAgentEventInput,
} from '../../../domains/agent-integration/types.js';
import { AgentIntegrationSchemaMigration } from '../database/migration/migrations/035-agent-integration-schema.js';
import { SqliteAgentIntegrationRepository } from './sqlite-agent-integration-repository.js';

describe('SqliteAgentIntegrationRepository session read models', () => {
  let db: Database.Database;
  let repository: SqliteAgentIntegrationRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
    await new AgentIntegrationSchemaMigration().up(db);
    repository = new SqliteAgentIntegrationRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function createSession(input: {
    id: string;
    lastEventAt: string;
    adapterName?: string;
    ownerId?: string;
    projectId?: string;
    status?: AgentSessionStatus;
  }): void {
    const event: PersistedAgentEventInput = {
      contractVersion: 1,
      eventId: `${input.id}-start`,
      eventType: 'SESSION_START',
      occurredAt: input.lastEventAt,
      adapterName: input.adapterName ?? 'codex',
      adapterVersion: '1.0.0',
      sessionId: input.id,
      sequenceNo: 0,
      scope: {
        ownerId: input.ownerId,
        projectId: input.projectId,
      },
      payloadJson: '{}',
      payloadSha256: input.id.padEnd(64, '0'),
      redactionMetadataJson: '{}',
      captureStatus: 'ACCEPTED',
    };
    repository.createSession(event, input.lastEventAt);
    if (input.status) {
      repository.updateSession(input.id, { status: input.status }, input.lastEventAt);
    }
  }

  function createObservation(input: {
    id: string;
    sessionId: string;
    status: AgentCaptureStatus;
    eventType?: PersistedAgentEventInput['eventType'];
    lateArrival?: boolean;
  }): void {
    repository.createObservation({
      id: input.id,
      contractVersion: 1,
      eventId: `${input.id}-event`,
      eventType: input.eventType ?? 'USER_PROMPT',
      occurredAt: '2026-06-07T00:00:00.000Z',
      adapterName: 'codex',
      adapterVersion: '1.0.0',
      sessionId: input.sessionId,
      sequenceNo: 1,
      scope: {},
      payloadJson: input.status === 'DROPPED' ? null : '{}',
      payloadSha256: input.id.padEnd(64, 'a'),
      redactionMetadataJson: '{}',
      captureStatus: input.status as Exclude<AgentCaptureStatus, 'DUPLICATE' | 'INVALID'>,
      lateArrival: input.lateArrival ?? false,
      receivedAt: '2026-06-07T00:00:01.000Z',
      expiresAt: null,
    });
  }

  it('paginates sessions by lastEventAt and id descending with stable cursors', () => {
    createSession({ id: 'session-a', lastEventAt: '2026-06-07T03:00:00.000Z' });
    createSession({ id: 'session-c', lastEventAt: '2026-06-07T02:00:00.000Z' });
    createSession({ id: 'session-b', lastEventAt: '2026-06-07T02:00:00.000Z' });
    createSession({ id: 'session-old', lastEventAt: '2026-06-07T01:00:00.000Z' });

    const firstPage = repository.listSessions({ limit: 2 });
    const secondPage = repository.listSessions({
      limit: 2,
      cursor: firstPage.nextCursor!,
    });

    expect(firstPage.items.map(item => item.session.id)).toEqual(['session-a', 'session-c']);
    expect(secondPage.items.map(item => item.session.id)).toEqual(['session-b', 'session-old']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('filters sessions and attaches complete observation aggregates', () => {
    createSession({
      id: 'target',
      lastEventAt: '2026-06-07T03:00:00.000Z',
      adapterName: 'claude-code',
      ownerId: 'owner-1',
      projectId: 'project-1',
      status: 'DEGRADED',
    });
    createSession({
      id: 'other',
      lastEventAt: '2026-06-07T02:00:00.000Z',
      ownerId: 'owner-2',
      projectId: 'project-2',
    });
    createObservation({ id: 'accepted', sessionId: 'target', status: 'ACCEPTED' });
    createObservation({
      id: 'redacted',
      sessionId: 'target',
      status: 'REDACTED',
      eventType: 'TOOL_RESULT',
      lateArrival: true,
    });
    createObservation({ id: 'dropped', sessionId: 'target', status: 'DROPPED' });
    createObservation({ id: 'degraded', sessionId: 'target', status: 'DEGRADED' });

    const page = repository.listSessions({
      status: 'DEGRADED',
      adapterName: 'claude-code',
      ownerId: 'owner-1',
      projectId: 'project-1',
    });

    expect(page.items).toEqual([
      expect.objectContaining({
        session: expect.objectContaining({ id: 'target' }),
        aggregate: {
          total: 4,
          late: 1,
          byEventType: { USER_PROMPT: 3, TOOL_RESULT: 1 },
          byStatus: { ACCEPTED: 1, REDACTED: 1, DROPPED: 1, DEGRADED: 1 },
          redacted: 1,
          dropped: 1,
          degraded: 1,
        },
      }),
    ]);
  });

  it('returns global session and observation aggregates', () => {
    createSession({
      id: 'active',
      lastEventAt: '2026-06-07T03:00:00.000Z',
      status: 'ACTIVE',
    });
    createSession({
      id: 'degraded-session',
      lastEventAt: '2026-06-07T02:00:00.000Z',
      status: 'DEGRADED',
    });
    createObservation({ id: 'accepted', sessionId: 'active', status: 'ACCEPTED' });
    createObservation({
      id: 'redacted',
      sessionId: 'active',
      status: 'REDACTED',
      eventType: 'TOOL_RESULT',
      lateArrival: true,
    });
    createObservation({
      id: 'dropped',
      sessionId: 'degraded-session',
      status: 'DROPPED',
    });
    createObservation({
      id: 'degraded',
      sessionId: 'degraded-session',
      status: 'DEGRADED',
    });

    expect(repository.getDashboardAggregate()).toEqual({
      sessionsTotal: 2,
      sessionsByStatus: { ACTIVE: 1, DEGRADED: 1 },
      observationsTotal: 4,
      observationsByStatus: { ACCEPTED: 1, REDACTED: 1, DROPPED: 1, DEGRADED: 1 },
      observationsByEventType: { USER_PROMPT: 3, TOOL_RESULT: 1 },
      redactedTotal: 1,
      droppedTotal: 1,
      degradedTotal: 1,
      lateTotal: 1,
    });
  });
});
