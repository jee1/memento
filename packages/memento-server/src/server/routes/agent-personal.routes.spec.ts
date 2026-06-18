import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeterministicMockLlmAdapter } from '@memento/core';
import { createAgentRouter } from './agent.routes.js';
import {
  cleanupTestDatabase,
  setupTestDatabase,
  type TestDatabaseContext,
} from '../test/helpers/test-database.js';

describe('personal knowledge agent HTTP routes', () => {
  let ctx: TestDatabaseContext;
  let router: ReturnType<typeof createAgentRouter>;
  let response: Partial<Response>;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
    router = createAgentRouter(ctx.db, {
      serverServices: ctx.services,
      personalAgentLlm: new DeterministicMockLlmAdapter(),
    } as Parameters<typeof createAgentRouter>[1]);
    response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  });

  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await cleanupTestDatabase(ctx);
  });

  async function invoke(method: 'post', path: string, request: Partial<Request> = {}) {
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

  it('runs one turn without persisting candidates', async () => {
    await invoke('post', '/personal\\:run', {
      body: {
        user_message: '앞으로는 커밋 메시지는 영어로 쓰자',
        project_id: 'issue-390',
        token_budget: 128,
      },
    });

    expect(response.status).not.toHaveBeenCalled();
    const payload = vi.mocked(response.json!).mock.calls.at(-1)?.[0] as {
      ok: true;
      candidates: Array<{ id: string; content: string }>;
      persistence: { attempted: boolean };
    };
    expect(payload.ok).toBe(true);
    expect(payload.persistence.attempted).toBe(false);
    expect(payload.candidates).toHaveLength(1);
    expect(payload.candidates[0]?.id).toMatch(/^kc_/);

    const stored = ctx.db.prepare('SELECT COUNT(*) AS count FROM memory_item').get() as { count: number };
    expect(stored.count).toBe(0);
  });

  it('persists approved candidates through the server ToolContext', async () => {
    await invoke('post', '/personal\\:run', {
      body: {
        user_message: '앞으로는 커밋 메시지는 영어로 쓰자',
        project_id: 'issue-390',
      },
    });
    const runPayload = vi.mocked(response.json!).mock.calls.at(-1)?.[0] as {
      candidates: Array<{ id: string; content: string }>;
    };

    await invoke('post', '/personal\\:persist-approved', {
      body: {
        candidates: runPayload.candidates,
        approved_candidate_ids: [runPayload.candidates[0]!.id],
        project_id: 'issue-390',
        session_id: 'session-390',
        process_id: 'server-route-test',
      },
    });

    expect(response.status).not.toHaveBeenCalled();
    const persistPayload = vi.mocked(response.json!).mock.calls.at(-1)?.[0] as {
      ok: true;
      persistence: { attempted: boolean; persistedCount: number; errorCount: number };
    };
    expect(persistPayload.ok).toBe(true);
    expect(persistPayload.persistence).toMatchObject({
      attempted: true,
      persistedCount: 1,
      errorCount: 0,
    });

    const stored = ctx.db.prepare(`
      SELECT content, type, project_id, session_id, process_id
      FROM memory_item
      WHERE source = 'personal-knowledge-agent'
    `).get() as {
      content: string;
      type: string;
      project_id: string;
      session_id: string;
      process_id: string;
    };
    expect(stored).toMatchObject({
      content: '커밋 메시지는 영어로 쓰자',
      type: 'semantic',
      project_id: 'issue-390',
      session_id: 'session-390',
      process_id: 'server-route-test',
    });
  });
});
