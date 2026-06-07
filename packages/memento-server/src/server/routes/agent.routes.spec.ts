import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentIntegrationSchemaMigration } from '@memento/core';
import { createAgentRouter } from './agent.routes.js';

function event(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: 1,
    event_id: 'evt-start',
    event_type: 'SESSION_START',
    occurred_at: '2026-06-06T00:00:00.000Z',
    adapter_name: 'codex',
    adapter_version: '1.0.0',
    session_id: 'session-1',
    sequence_no: 0,
    scope: {
      owner_id: 'owner-1',
      project_id: 'project-1',
      process_id: 'issue-454',
    },
    payload: { client_version: '1.0.0' },
    ...overrides,
  };
}

describe('agent integration routes', () => {
  let db: Database.Database;
  let router: ReturnType<typeof createAgentRouter>;
  let response: Partial<Response>;

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
      );
      CREATE TABLE telemetry_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        request_id TEXT NOT NULL,
        owner_id TEXT,
        latency_ms INTEGER,
        outcome TEXT NOT NULL,
        error_code TEXT,
        extra_data TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE telemetry_daily_metrics (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        event_type TEXT NOT NULL,
        owner_id TEXT NOT NULL DEFAULT '',
        event_count INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms REAL,
        error_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(date, event_type, owner_id)
      )
    `);
    await new AgentIntegrationSchemaMigration().up(db);
    router = createAgentRouter(db, {
      now: () => new Date('2026-06-06T00:00:10.000Z'),
    });
    response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  });

  afterEach(() => {
    db.close();
  });

  async function invoke(
    method: 'get' | 'post' | 'delete',
    path: string,
    request: Partial<Request> = {},
  ) {
    const layer = router.stack.find(
      candidate => candidate.route?.path === path && candidate.route.methods[method],
    );
    expect(layer?.route).toBeTruthy();
    await layer!.route!.stack[0]!.handle(
      {
        body: {},
        params: {},
        query: {},
        ...request,
      } as Request,
      response as Response,
      vi.fn(),
    );
  }

  it('publishes schema readiness and lifecycle capabilities', async () => {
    await invoke('get', '/capabilities');

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      contract_versions: [1],
      event_types: ['SESSION_START', 'USER_PROMPT', 'TOOL_RESULT', 'PRE_COMPACT', 'STOP'],
      schema_ready: true,
      limits: expect.objectContaining({
        event_payload_bytes: 32768,
        batch_events: 50,
        batch_payload_bytes: 524288,
      }),
    }));
  });

  it('starts, reads, paginates, and stops a session', async () => {
    await invoke('post', '/sessions', { body: event() });
    expect(response.status).toHaveBeenCalledWith(201);

    response.status = vi.fn().mockReturnThis();
    response.json = vi.fn().mockReturnThis();
    await invoke('post', '/observations:ingest', {
      body: {
        events: [
          event({
            event_id: 'evt-prompt',
            event_type: 'USER_PROMPT',
            sequence_no: 1,
            payload: { content: 'hello', content_format: 'text' },
          }),
        ],
      },
    });
    expect(response.json).toHaveBeenCalledWith({
      results: [expect.objectContaining({ event_id: 'evt-prompt', status: 'ACCEPTED' })],
    });

    response.json = vi.fn().mockReturnThis();
    await invoke('get', '/sessions/:id', { params: { id: 'session-1' } });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ id: 'session-1', status: 'ACTIVE' }),
      aggregate: expect.objectContaining({ total: 2 }),
    }));

    response.json = vi.fn().mockReturnThis();
    await invoke('get', '/sessions/:id/observations', {
      params: { id: 'session-1' },
      query: { limit: '1' },
    });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      observations: [expect.objectContaining({ sequence_no: 0 })],
      next_cursor: expect.any(String),
    }));

    response.json = vi.fn().mockReturnThis();
    await invoke('post', '/sessions/:id\\:stop', {
      params: { id: 'session-1' },
      body: event({
        event_id: 'evt-stop',
        event_type: 'STOP',
        sequence_no: 2,
        payload: { outcome: 'completed' },
      }),
    });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ status: 'COMPLETED' }),
      result: expect.objectContaining({ status: 'ACCEPTED' }),
      summary_job_id: expect.any(String),
    }));
    const stopped = vi.mocked(response.json).mock.calls.at(-1)?.[0] as {
      summary_job_id: string;
    };
    expect(db.prepare(`
      SELECT type, session_id, source_session_id
      FROM memory_item WHERE id = ?
    `).get(stopped.summary_job_id)).toEqual({
      type: 'episodic',
      session_id: 'session-1',
      source_session_id: 'session-1',
    });
    expect(db.prepare(`
      SELECT event_type, outcome, extra_data
      FROM telemetry_events
      WHERE event_type = 'agent.summary.completed'
    `).get()).toEqual(expect.objectContaining({
      event_type: 'agent.summary.completed',
      outcome: 'success',
      extra_data: expect.stringContaining('"observation_count":3'),
    }));
  });

  it('links and queries provenance, exports, and deletes session capture data', async () => {
    await invoke('post', '/sessions', { body: event() });
    const startResponse = vi.mocked(response.json).mock.calls.at(-1)?.[0] as {
      observation: { id: string };
    };
    db.prepare('INSERT INTO memory_item (id, session_id) VALUES (?, ?)').run(
      'memory-1',
      'session-1',
    );

    response.json = vi.fn().mockReturnThis();
    await invoke('post', '/provenance', {
      body: {
        memory_id: 'memory-1',
        session_id: 'session-1',
        observation_id: startResponse.observation.id,
        derivation_type: 'agent_capture',
      },
    });
    expect(response.status).toHaveBeenCalledWith(201);

    response.json = vi.fn().mockReturnThis();
    await invoke('get', '/provenance', { query: { memory_id: 'memory-1' } });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({ kind: 'memory', id: 'memory-1' }),
        expect.objectContaining({ kind: 'session', id: 'session-1' }),
      ]),
    }));

    response.json = vi.fn().mockReturnThis();
    await invoke('get', '/sessions/:id/export', { params: { id: 'session-1' } });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ id: 'session-1' }),
      observations: [
        expect.objectContaining({
          payload_json: expect.any(String),
          payload_sha256: expect.any(String),
          redaction_metadata_json: expect.any(String),
        }),
      ],
    }));

    response.json = vi.fn().mockReturnThis();
    await invoke('delete', '/sessions/:id', { params: { id: 'session-1' } });
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.send).toHaveBeenCalled();
  });

  it('maps idempotency conflicts to the stable 409 error envelope', async () => {
    await invoke('post', '/sessions', { body: event() });

    response.status = vi.fn().mockReturnThis();
    response.json = vi.fn().mockReturnThis();
    await invoke('post', '/observations:ingest', {
      body: {
        events: [event({ payload: { client_version: 'different' } })],
      },
    });

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 409,
      reason_code: 'IDEMPOTENCY_CONFLICT',
      retryable: false,
    }));
  });

  it('returns stable unsupported-version and batch-limit reason codes', async () => {
    await invoke('post', '/sessions', {
      body: event({ contract_version: 2 }),
    });
    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      reason_code: 'UNSUPPORTED_CONTRACT_VERSION',
    }));

    response.status = vi.fn().mockReturnThis();
    response.json = vi.fn().mockReturnThis();
    await invoke('post', '/observations:ingest', {
      body: { events: Array.from({ length: 51 }, (_, index) => event({ event_id: `evt-${index}` })) },
    });
    expect(response.status).toHaveBeenCalledWith(413);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      reason_code: 'BATCH_TOO_LARGE',
    }));
  });

  it('returns ordered partial-success results for independently invalid batch events', async () => {
    await invoke('post', '/sessions', { body: event() });
    response.status = vi.fn().mockReturnThis();
    response.json = vi.fn().mockReturnThis();

    await invoke('post', '/observations:ingest', {
      body: {
        events: [
          event({
            event_id: 'evt-valid',
            event_type: 'USER_PROMPT',
            sequence_no: 1,
            payload: { content: 'hello', content_format: 'text' },
          }),
          event({
            event_id: 'evt-missing-session',
            event_type: 'USER_PROMPT',
            session_id: 'missing-session',
            sequence_no: 1,
            payload: { content: 'hello', content_format: 'text' },
          }),
        ],
      },
    });

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      results: [
        expect.objectContaining({ event_id: 'evt-valid', status: 'ACCEPTED' }),
        expect.objectContaining({
          event_id: 'evt-missing-session',
          status: 'INVALID',
          reason_code: 'SESSION_NOT_STARTED',
        }),
      ],
    });
  });

  it('redacts secrets before hashing and persistence', async () => {
    const secret = ['sk', 'live', '1234567890ABCDEF1234567890ABCDEF'].join('_');
    await invoke('post', '/sessions', {
      body: event({
        payload: {
          client_version: '1.0.0',
          initial_context: `token=${secret} user@example.com`,
        },
      }),
    });

    const row = db.prepare(`
      SELECT payload_json, status, redaction_metadata_json
      FROM agent_observation
      WHERE event_id = 'evt-start'
    `).get() as {
      payload_json: string;
      status: string;
      redaction_metadata_json: string;
    };

    expect(row.payload_json).not.toContain(secret);
    expect(row.payload_json).toContain('[REDACTED:');
    expect(row.status).toBe('REDACTED');
    expect(row.redaction_metadata_json).toContain('EMAIL');
  });

  it('normalizes identifiers before validation and persistence', async () => {
    await invoke('post', '/sessions', {
      body: event({
        event_id: '  evt-trimmed  ',
        adapter_name: '  codex  ',
        adapter_version: '  1.0.0  ',
        session_id: '  session-trimmed  ',
      }),
    });

    expect(response.status).toHaveBeenCalledWith(201);
    expect(
      db.prepare(`
        SELECT adapter_name, event_id, session_id
        FROM agent_observation
        WHERE event_id = 'evt-trimmed'
      `).get(),
    ).toEqual({
      adapter_name: 'codex',
      event_id: 'evt-trimmed',
      session_id: 'session-trimmed',
    });
  });

  it('returns 404 when listing observations for a missing session', async () => {
    await invoke('get', '/sessions/:id/observations', {
      params: { id: 'missing-session' },
    });

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      reason_code: 'SESSION_NOT_STARTED',
    }));
  });
});
