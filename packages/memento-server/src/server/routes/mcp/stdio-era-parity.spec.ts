/**
 * issue 1110 completion criterion 2: stdio and HTTP must return the same tools/list
 * regardless of protocol era.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemoryTransport,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type ListToolsResult,
} from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createMementoMcpServer } from '../../mcp-server-factory.js';
import { processMcpMessage } from './message-processor.js';
import {
  cleanupTestDatabase,
  setupTestDatabase,
  type TestDatabaseContext,
} from '../../test/helpers/test-database.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';

function modernMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'parity', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
    ...overrides,
  };
}

function isJsonRpcResponse(message: JSONRPCMessage): message is JSONRPCResponse {
  return 'id' in message && ('result' in message || 'error' in message);
}

function isJsonRpcRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return (
    'method' in message
    && 'id' in message
    && message.id !== undefined
    && !('result' in message)
    && !('error' in message)
  );
}

function legacyOpeningSequence(toolsListId = 3): JSONRPCMessage[] {
  return [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'parity', version: '1' },
      },
    },
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    },
    {
      jsonrpc: '2.0',
      id: toolsListId,
      method: 'tools/list',
    },
  ];
}

function modernOpeningSequence(toolsListId = 1): JSONRPCMessage[] {
  return [
    {
      jsonrpc: '2.0',
      id: toolsListId,
      method: 'tools/list',
      params: { _meta: modernMeta() },
    },
  ];
}

async function exchangeStdio(
  ctx: TestDatabaseContext,
  eraOption: { legacy?: 'serve' | 'reject' },
  messages: JSONRPCMessage[],
): Promise<JSONRPCResponse[]> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  const pending = new Map<string, (response: JSONRPCResponse) => void>();
  const responses: JSONRPCResponse[] = [];

  clientTransport.onmessage = (message) => {
    if (!isJsonRpcResponse(message)) {
      return;
    }
    responses.push(message);
    const resolver = pending.get(String(message.id));
    if (resolver) {
      pending.delete(String(message.id));
      resolver(message);
    }
  };

  await clientTransport.start();

  const handle: StdioServerHandle = serveStdio(
    () => createMementoMcpServer({
      readyPromise: Promise.resolve(),
      getDb: () => ctx.db,
      getServices: () => ctx.services,
    }),
    {
      legacy: eraOption.legacy ?? 'serve',
      transport: serverTransport,
    },
  );

  try {
    for (const message of messages) {
      if (isJsonRpcRequest(message)) {
        const responsePromise = new Promise<JSONRPCResponse>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(String(message.id));
            reject(new Error(`timeout waiting for response id=${String(message.id)}`));
          }, 5000);
          pending.set(String(message.id), (response) => {
            clearTimeout(timer);
            resolve(response);
          });
        });
        await clientTransport.send(message);
        await responsePromise;
      } else {
        await clientTransport.send(message);
      }
    }
    return responses;
  } finally {
    await handle.close();
  }
}

async function stdioToolsList(
  ctx: TestDatabaseContext,
  eraOption: { legacy?: 'serve' | 'reject' },
  openingSequence: JSONRPCMessage[],
): Promise<ListToolsResult> {
  const responses = await exchangeStdio(ctx, eraOption, openingSequence);
  const toolsListRequest = openingSequence.filter(isJsonRpcRequest).find((message) => message.method === 'tools/list');
  if (!toolsListRequest) {
    throw new Error('openingSequence must include a tools/list request with an id');
  }

  const response = responses.find((entry) => entry.id === toolsListRequest.id);
  if (!response) {
    throw new Error(`no response for tools/list id=${String(toolsListRequest.id)}`);
  }
  if (response.error) {
    throw new Error(`tools/list failed: ${response.error.code} ${response.error.message}`);
  }

  const raw = response.result;
  if (!raw || typeof raw !== 'object' || !('tools' in raw) || !Array.isArray(raw.tools)) {
    throw new Error('tools/list result missing tools array');
  }
  return { tools: raw.tools as ListToolsResult['tools'] };
}

async function httpToolsList(ctx: TestDatabaseContext): Promise<ListToolsResult> {
  const response = await processMcpMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    ctx.db,
    ctx.services,
  );
  return response.result as ListToolsResult;
}

function sortedToolNames(result: ListToolsResult): string[] {
  return result.tools.map((tool) => tool.name).sort();
}

describe('stdio era parity (issue 1110)', () => {
  let ctx: TestDatabaseContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(ctx);
  });

  it('legacy opening on a dual-era stdio server returns the same tool names as HTTP', async () => {
    const stdioResult = await stdioToolsList(ctx, { legacy: 'serve' }, legacyOpeningSequence());
    const httpResult = await httpToolsList(ctx);
    expect(sortedToolNames(stdioResult)).toEqual(sortedToolNames(httpResult));
  }, 10_000);

  it('modern opening on a dual-era stdio server returns the same tool names as HTTP', async () => {
    const stdioResult = await stdioToolsList(ctx, { legacy: 'serve' }, modernOpeningSequence());
    const httpResult = await httpToolsList(ctx);
    expect(sortedToolNames(stdioResult)).toEqual(sortedToolNames(httpResult));
  }, 10_000);

  it('both eras return byte-identical tools/list results', async () => {
    const legacyResult = await stdioToolsList(ctx, { legacy: 'serve' }, legacyOpeningSequence(10));
    const modernResult = await stdioToolsList(ctx, { legacy: 'serve' }, modernOpeningSequence(11));
    expect(JSON.stringify(legacyResult)).toBe(JSON.stringify(modernResult));
  }, 10_000);

  it('a modern opening missing clientInfo is rejected with -32602', async () => {
    const responses = await exchangeStdio(ctx, { legacy: 'serve' }, [
      {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
          },
        },
      },
    ]);
    expect(responses[0]?.error?.code).toBe(-32602);
  }, 10_000);

  it("legacy: 'reject' answers a legacy opening with -32022", async () => {
    const responses = await exchangeStdio(ctx, { legacy: 'reject' }, [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'parity', version: '1' },
        },
      },
    ]);
    expect(responses[0]?.error?.code).toBe(-32022);
  }, 10_000);
});
