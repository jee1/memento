import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sqlite3 from 'sqlite3';
import { AddressInfo } from 'net';
import type { Server } from 'http';
import { WebSocket } from 'ws';
import { DatabaseUtils } from '../utils/database.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import type { MemoryEmbeddingService } from '../services/memory-embedding-service.js';

type HttpServerModule = typeof import('./http-server.js');

let httpModule: HttpServerModule;
let db: sqlite3.Database;
let server: Server | null = null;
let baseUrl: string;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const daysAgo = (days: number): string => {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString();
};

const startTestServer = async (module: HttpServerModule) => {
  const httpServer = module.__test.getServer();
  await new Promise<void>((resolve) => {
    server = httpServer.listen(0, () => {
      const address = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
};

const stopTestServer = async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = null;
};

const postJson = async (path: string, body: unknown) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, json: await response.json() };
};

beforeAll(async () => {
  process.env.DB_PATH = ':memory:';

  httpModule = await import('./http-server.js');

  db = new sqlite3.Database(':memory:');

  const schemaPath = join(__dirname, '../database/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  await DatabaseUtils.exec(db, schema);

  const embeddingStub: Pick<MemoryEmbeddingService, 'isAvailable' | 'createAndStoreEmbedding' | 'deleteEmbedding'> = {
    isAvailable: () => false,
    createAndStoreEmbedding: vi.fn(),
    deleteEmbedding: vi.fn()
  } as any;

  httpModule.__test.setTestDependencies({
    database: db,
    searchEngine: new SearchEngine(),
    hybridSearchEngine: new HybridSearchEngine(),
    embeddingService: embeddingStub as MemoryEmbeddingService
  });

  await startTestServer(httpModule);
});

afterAll(async () => {
  await stopTestServer();
  await new Promise<void>((resolve, reject) => db.close(err => err ? reject(err) : resolve()));
});

beforeEach(async () => {
  await DatabaseUtils.exec(db, 'DELETE FROM memory_item;');
  await DatabaseUtils.exec(db, 'DELETE FROM memory_item_fts;');
});

// eslint-disable-next-line max-lines-per-function
describe('HTTP MCP 서버', () => {
  it('remember → recall → forget 흐름을 처리한다', async () => {
    const remember = await postJson('/tools/remember', {
      content: '검색 가능한 테스트 기억',
      type: 'semantic',
      importance: 0.8
    });

    expect(remember.status).toBe(200);
    const memoryId: string = remember.json.result.memory_id;
    expect(memoryId).toMatch(/^mem_/);

    const recall = await postJson('/tools/recall', { query: '테스트 기억' });
    expect(recall.status).toBe(200);
    expect(recall.json.result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: memoryId })
      ])
    );

    const forget = await postJson('/tools/forget', { id: memoryId, hard: true });
    expect(forget.status).toBe(200);
    expect(forget.json.result.message).toContain('완전히 삭제');

    const recallAfter = await postJson('/tools/recall', { query: '테스트 기억' });
    const items: Array<{ id: string }> = recallAfter.json.result.items;
    expect(items.find(item => item.id === memoryId)).toBeUndefined();
  });

  it('알 수 없는 툴을 요청하면 404를 반환한다', async () => {
    const response = await postJson('/tools/unknown', {});
    expect(response.status).toBe(404);
    expect(response.json.error).toBe('Unknown tool: unknown');
  });
});

describe('WebSocket MCP 프로토콜', () => {
  const sendJsonRpc = (socket: WebSocket, payload: unknown) => {
    socket.send(JSON.stringify(payload));
  };

  const waitForMessage = (socket: WebSocket) => {
    return new Promise<any>((resolve, reject) => {
      const onMessage = (data: WebSocket.RawData) => {
        socket.off('error', onError);
        resolve(JSON.parse(data.toString()));
      };
      const onError = (err: Error) => {
        socket.off('message', onMessage);
        reject(err);
      };
      socket.once('message', onMessage);
      socket.once('error', onError);
    });
  };

  it('tools/list와 tools/call 시나리오를 처리한다', async () => {
    const url = baseUrl.replace('http', 'ws');
    const socket = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    sendJsonRpc(socket, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    });

    const listResponse = await waitForMessage(socket);
    expect(listResponse.id).toBe(1);
    expect(listResponse.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'remember' }),
        expect.objectContaining({ name: 'recall' })
      ])
    );

    const rememberPayload = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'remember',
        arguments: {
          content: '웹소켓 테스트 기억',
          type: 'semantic',
          importance: 0.7
        }
      }
    };

    sendJsonRpc(socket, rememberPayload);
    const rememberResponse = await waitForMessage(socket);
    expect(rememberResponse.id).toBe(2);
    const rememberData = JSON.parse(rememberResponse.result.content[0].text);
    const memoryId: string = rememberData.memory_id;
    expect(memoryId).toMatch(/^mem_/);

    const recallPayload = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'recall',
        arguments: {
          query: '웹소켓 테스트',
          limit: 5
        }
      }
    };

    sendJsonRpc(socket, recallPayload);
    const recallResponse = await waitForMessage(socket);
    expect(recallResponse.id).toBe(3);
    const recallData = JSON.parse(recallResponse.result.content[0].text);
    expect(Array.isArray(recallData.items)).toBe(true);
    expect(recallData.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: memoryId })
      ])
    );

    const forgetPayload = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'forget',
        arguments: {
          id: memoryId,
          hard: true
        }
      }
    };

    sendJsonRpc(socket, forgetPayload);
    const forgetResponse = await waitForMessage(socket);
    expect(forgetResponse.id).toBe(4);
    const forgetData = JSON.parse(forgetResponse.result.content[0].text);
    expect(forgetData.message).toContain('완전히 삭제');

    sendJsonRpc(socket, recallPayload);
    const recallAfterForget = await waitForMessage(socket);
    const recallAfterData = JSON.parse(recallAfterForget.result.content[0].text);
    expect(recallAfterData.items.find((item: { id: string }) => item.id === memoryId)).toBeUndefined();

    socket.close();
  });
});
