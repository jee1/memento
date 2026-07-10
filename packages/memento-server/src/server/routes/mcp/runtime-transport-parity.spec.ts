/**
 * Docker(TRANSPORT_TYPE=sse), npm run dev:http, stdio MCP가 동일한 도구 결과를 반환하는지 검증.
 * transport 차이는 인증·agentId 주입 등 셸 계층에만 있어야 하며, executeTool 결과 형식은 동일해야 한다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getToolRegistry } from '@memento/core';
import * as core from '@memento/core';
import { processMcpMessage } from './message-processor.js';
import {
  cleanupTestDatabase,
  setupTestDatabase,
  type TestDatabaseContext,
} from '../../test/helpers/test-database.js';

describe('runtime transport parity (stdio vs HTTP MCP)', () => {
  let ctx: TestDatabaseContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestDatabase(ctx);
  });

  it('tools/list exposes the same registry as getToolRegistry()', async () => {
    const direct = getToolRegistry().getAll().map((t) => t.name).sort();
    const response = await processMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      ctx.db,
      ctx.services,
    );
    const viaHttp = (response.result as { tools: { name: string }[] }).tools
      .map((t) => t.name)
      .sort();
    expect(viaHttp).toEqual(direct);
  });

  it('tools/call passes executeTool ToolResult through unchanged (stdio parity)', async () => {
    const params = {
      content: 'transport parity probe',
      type: 'semantic',
      tags: ['parity'],
      importance: 0.5,
    };
    const spy = vi.spyOn(core, 'executeTool');

    const httpResponse = await processMcpMessage(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'remember', arguments: params },
      },
      ctx.db,
      ctx.services,
    );

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toBe('remember');
    expect(spy.mock.calls[0]?.[1]).toEqual(params);
    const stdioResult = await spy.mock.results[0]?.value;
    expect(httpResponse.result).toEqual(stdioResult);

    const payload = JSON.parse(
      (stdioResult.content[0] as { text: string }).text,
    ) as { memory_id?: string; type?: string };
    expect(typeof payload.memory_id).toBe('string');
    expect(payload.type).toBe('semantic');
  });

  it('tools/call recall uses the same executeTool path as stdio', async () => {
    await core.executeTool(
      'remember',
      { content: 'parity recall seed memory', type: 'episodic' },
      core.createToolContext(ctx.db, ctx.services),
    );

    const recallParams = { query: 'parity recall seed', limit: 5, type: 'episodic' };
    const spy = vi.spyOn(core, 'executeTool');

    const httpResponse = await processMcpMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'recall', arguments: recallParams },
      },
      ctx.db,
      ctx.services,
    );

    expect(spy).toHaveBeenCalledWith('recall', recallParams, expect.any(Object));
    const stdioResult = await spy.mock.results[0]?.value;
    expect(httpResponse.result).toEqual(stdioResult);
  });
});
