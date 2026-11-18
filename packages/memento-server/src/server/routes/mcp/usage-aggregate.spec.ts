/**
 * 사용 집계 통합 테스트 (#1768, ADR 테스트 3 ~ 7)
 *
 * 실측한 클라이언트 값(2026-11-18, 로컬 탐침)으로 픽스처를 만든다:
 *   Claude Code 2.1.327: 새 방식, 모든 요청 `_meta` 에 clientInfo { name: 'claude-code', version: '2.1.327' }
 *   opencode 1.19.6:    옛 방식, initialize 의 clientInfo { name: 'opencode', version: '1.19.6' }, 세션 헤더 재전송
 *   cursor-agent:        옛 방식, initialize 의 clientInfo { name: 'Cursor', version: '1.0.0' }, 세션 헤더 재전송
 */

import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushUsageAggregator } from '@memento/core';
import { handleSseMessagePost, handleStreamableMcpPost } from './handlers.js';
import { mcpClientSessions } from '../../mcp-client-sessions.js';
import { resetUsageRecordingForTests } from '../../usage-recording.js';
import { cleanupTestDatabase, setupTestDatabase, type TestDatabaseContext } from '../../test/helpers/test-database.js';

interface UsageRow {
  client_name: string;
  client_version: string;
  connection_method: string;
  era: string;
  request_kind: string;
  tool: string;
  outcome: string;
  error_code: number;
  count: number;
}

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
      return res;
    },
    getHeader: (k: string) => headers[k.toLowerCase()],
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
    send(b: unknown) {
      res.body = b;
      return res;
    },
    end() {
      return res;
    },
    type() {
      return res;
    },
    headers,
  };
  return res as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, string> };
}

function fakeReq(init: {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  programmaticAuth?: { keyId: string; scopes: string[]; agentId?: string };
}): Request {
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    body: init.body,
    query: init.query ?? {},
    headers,
    get: (name: string) => headers[name.toLowerCase()],
    programmaticAuth: init.programmaticAuth,
  } as unknown as Request;
}

/** 새 방식 요청은 `MCP-Protocol-Version`, `Mcp-Method`, 그리고 tools/call 이면 `Mcp-Name` 헤더를 함께 보낸다(서버가 검증한다). */
function modernRequest(
  body: { id: number; method: string; params?: Record<string, unknown> },
  extra: { meta?: Record<string, unknown>; programmaticAuth?: { keyId: string; scopes: string[]; agentId?: string } } = {},
): Request {
  const params = { ...(body.params ?? {}), _meta: extra.meta ?? modernMeta };
  const headers: Record<string, string> = { 'mcp-protocol-version': '2026-07-28', 'mcp-method': body.method };
  if (body.method === 'tools/call' && typeof params.name === 'string') headers['mcp-name'] = params.name;
  return fakeReq({ body: { jsonrpc: '2.0', id: body.id, method: body.method, params }, headers, programmaticAuth: extra.programmaticAuth });
}

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'claude-code', version: '2.1.327' },
};

describe('사용 집계: HTTP 진입점 (#1768)', () => {
  let ctx: TestDatabaseContext;

  const flushed = (): UsageRow[] => {
    // 집계기는 Map 에 모으므로 읽기 전에 flush 한다.
    flushUsageAggregator(ctx.db);
    return ctx.db
      .prepare(
        `SELECT client_name, client_version, connection_method, era, request_kind, tool, outcome, error_code, count
         FROM usage_daily_count ORDER BY request_kind, tool, client_name`,
      )
      .all() as UsageRow[];
  };

  beforeEach(async () => {
    resetUsageRecordingForTests();
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestDatabase(ctx);
  });

  it('새 방식: _meta 의 clientInfo 가 이름과 버전, http-streamable, modern 으로 남는다 (테스트 3)', async () => {
    await handleStreamableMcpPost(modernRequest({ id: 1, method: 'tools/list' }), fakeRes(), ctx.db, ctx.services);

    expect(flushed()).toEqual([
      expect.objectContaining({
        client_name: 'claude-code',
        client_version: '2.1.327',
        connection_method: 'http-streamable',
        era: 'modern',
        request_kind: 'tools/list',
        tool: '',
        outcome: 'success',
        error_code: 0,
        count: 1,
      }),
    ]);
  });

  it('새 방식인데 clientInfo 가 없으면 unknown 이고 버전은 비어 있다 (테스트 3)', async () => {
    const { 'io.modelcontextprotocol/clientInfo': _omit, ...withoutInfo } = modernMeta;
    await handleStreamableMcpPost(
      modernRequest({ id: 1, method: 'tools/list' }, { meta: withoutInfo }),
      fakeRes(),
      ctx.db,
      ctx.services,
    );
    expect(flushed()).toEqual([expect.objectContaining({ client_name: 'unknown', client_version: '', era: 'modern' })]);
  });

  it('옛 방식: initialize 의 clientInfo 를 세션으로 기억해 뒤 요청에 붙인다 (opencode, cursor-agent 실측, 테스트 4)', async () => {
    const initRes = fakeRes();
    await handleStreamableMcpPost(
      fakeReq({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Cursor', version: '1.0.0' } },
        },
      }),
      initRes,
      ctx.db,
      ctx.services,
    );
    const sessionId = initRes.headers['mcp-session-id'];
    expect(sessionId).toBeTruthy();

    await handleStreamableMcpPost(
      fakeReq({
        body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        headers: { 'mcp-session-id': sessionId as string, 'mcp-protocol-version': '2025-11-25' },
      }),
      fakeRes(),
      ctx.db,
      ctx.services,
    );

    const rows = flushed();
    expect(rows.map((r) => [r.request_kind, r.client_name, r.client_version, r.era, r.connection_method])).toEqual([
      ['initialize', 'cursor', '1.0.0', 'legacy', 'http-streamable'],
      ['tools/list', 'cursor', '1.0.0', 'legacy', 'http-streamable'],
    ]);
  });

  it('옛 방식: 세션 헤더가 없으면 unknown 이다 (테스트 4)', async () => {
    await handleStreamableMcpPost(
      fakeReq({ body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } }),
      fakeRes(),
      ctx.db,
      ctx.services,
    );
    expect(flushed()).toEqual([expect.objectContaining({ client_name: 'unknown', client_version: '', era: 'legacy' })]);
  });

  it('옛 방식: 목록에 없는 클라이언트는 other 이고 버전은 비어 있다', async () => {
    const initRes = fakeRes();
    await handleStreamableMcpPost(
      fakeReq({
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'brand-new-client', version: '9.9.9' } },
        },
      }),
      initRes,
      ctx.db,
      ctx.services,
    );
    expect(flushed()).toEqual([expect.objectContaining({ client_name: 'other', client_version: '' })]);
  });

  it('SSE: 쿼리 sessionId 로 기억한 클라이언트가 http-sse, legacy 로 남는다 (테스트 5)', async () => {
    const transports = { sse1: { res: fakeRes(), sessionId: 'sse1', keepAliveInterval: setInterval(() => undefined, 1e6) } };
    try {
      await handleSseMessagePost(
        fakeReq({
          body: {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'opencode', version: '1.19.6' } },
          },
          query: { sessionId: 'sse1' },
        }),
        fakeRes(),
        ctx.db,
        ctx.services,
        transports as never,
      );
      await handleSseMessagePost(
        fakeReq({ body: { jsonrpc: '2.0', id: 2, method: 'tools/list' }, query: { sessionId: 'sse1' } }),
        fakeRes(),
        ctx.db,
        ctx.services,
        transports as never,
      );
    } finally {
      clearInterval(transports.sse1.keepAliveInterval);
    }

    expect(flushed().map((r) => [r.request_kind, r.client_name, r.client_version, r.connection_method, r.era])).toEqual([
      ['initialize', 'opencode', '1.19.6', 'http-sse', 'legacy'],
      ['tools/list', 'opencode', '1.19.6', 'http-sse', 'legacy'],
    ]);
  });

  it('도구 호출이 클라이언트 정보와 함께 도구 이름과 결과로 남는다', async () => {
    // type 파라미터가 없어 -32602 로 거부되는 호출이다. 성공/실패 경로를 모두 지나 오류 코드가 남는지 본다.
    await handleStreamableMcpPost(
      modernRequest({ id: 3, method: 'tools/call', params: { name: 'recall', arguments: { query: 'x' } } }),
      fakeRes(),
      ctx.db,
      ctx.services,
    );
    expect(flushed()).toEqual([
      expect.objectContaining({
        client_name: 'claude-code',
        client_version: '2.1.327',
        request_kind: 'tools/call',
        tool: 'recall',
        outcome: 'error',
        error_code: -32602,
      }),
    ]);
  });

  it('executionStarted 전에 던지는 오류(토큰 묶임 위반)도 센다 (테스트 6)', async () => {
    await handleStreamableMcpPost(
      modernRequest(
        { id: 4, method: 'tools/call', params: { name: 'recall', arguments: { query: 'x', type: 'episodic', agent_id: 'someone-else' } } },
        { programmaticAuth: { keyId: 'k1', scopes: ['read'], agentId: 'bound-agent' } },
      ),
      fakeRes(),
      ctx.db,
      ctx.services,
    );
    const call = flushed().find((r) => r.request_kind === 'tools/call');
    expect(call).toMatchObject({ tool: 'recall', outcome: 'error', error_code: -32602, count: 1 });
  });

  it('등록되지 않은 도구는 other, -32601 로 센다', async () => {
    await handleStreamableMcpPost(
      modernRequest({ id: 5, method: 'tools/call', params: { name: 'definitely_not_a_tool', arguments: {} } }),
      fakeRes(),
      ctx.db,
      ctx.services,
    );
    expect(flushed().find((r) => r.request_kind === 'tools/call')).toMatchObject({
      tool: 'other',
      outcome: 'error',
      error_code: -32601,
    });
  });

  it('새어 나가지 않는다: 경로, 토큰, 프로젝트 이름, 세션 ID 를 클라이언트 이름과 도구 이름, 인자에 넣어도 표에 없다 (테스트 1)', async () => {
    const leaks = ['/home/jee1lee/secret-project', 'sk-live-abcdef0123456789', 'my-private-project', 'sess-0123456789-abcdef'];
    const poisonedMeta = {
      ...modernMeta,
      'io.modelcontextprotocol/clientInfo': { name: leaks[0], version: leaks[1] },
    };
    await handleStreamableMcpPost(
      modernRequest(
        { id: 6, method: 'tools/call', params: { name: leaks[2], arguments: { content: leaks[1], project_id: leaks[2], session: leaks[3] } } },
        { meta: poisonedMeta },
      ),
      fakeRes(),
      ctx.db,
      ctx.services,
    );
    const everything = JSON.stringify(flushed());
    for (const leak of leaks) expect(everything).not.toContain(leak);
    expect(everything).toContain('"client_name":"other"');
  });

  it('집계 표가 없어도(쓰기 실패) 요청 처리는 막히지 않는다 (테스트 6, 7)', async () => {
    ctx.db.exec('DROP TABLE usage_daily_count');
    const res = fakeRes();
    await expect(
      handleStreamableMcpPost(modernRequest({ id: 7, method: 'tools/list' }), res, ctx.db, ctx.services),
    ).resolves.toBeUndefined();
    expect(() => flushUsageAggregator(ctx.db)).not.toThrow();
  });

  it('처리가 오류로 끝난 연결 신호는 세지 않는다 (새 방식 요청의 initialize 는 -32601 로 거부된다)', async () => {
    const res = fakeRes();
    await handleStreamableMcpPost(modernRequest({ id: 10, method: 'initialize' }), res, ctx.db, ctx.services);
    expect(JSON.stringify(res.body)).toContain('-32601');
    expect(flushed().filter((r) => r.request_kind === 'initialize')).toHaveLength(0);
  });

  it('호출 하나는 정확히 한 번만 센다 (성공도 실패도 이중 계수가 없다)', async () => {
    await handleStreamableMcpPost(
      modernRequest({ id: 8, method: 'tools/call', params: { name: 'recall', arguments: { query: 'x', type: 'episodic' } } }),
      fakeRes(),
      ctx.db,
      ctx.services,
    );
    await handleStreamableMcpPost(
      modernRequest({ id: 9, method: 'tools/call', params: { name: 'recall', arguments: { query: 'x' } } }),
      fakeRes(),
      ctx.db,
      ctx.services,
    );
    const calls = flushed().filter((r) => r.request_kind === 'tools/call');
    expect(calls.reduce((n, r) => n + r.count, 0)).toBe(2);
  });

  it('SSE 연결이 닫히면 기억소에서 지운다', () => {
    mcpClientSessions.remember('closing', { name: 'opencode', version: '1.19.6' });
    mcpClientSessions.forget('closing');
    expect(mcpClientSessions.recall('closing')).toBeUndefined();
  });
});
