import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDirectiveRecallPort } from './directive-recall.js';

const REQUEST = { query: 'flaky tests', tags: ['case'], limit: 15 } as const;

let server: Server;
let received: { headers: IncomingMessage['headers']; url?: string; body: unknown } | undefined;
let reply: (res: import('node:http').ServerResponse) => void;

beforeEach(async () => {
  received = undefined;
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += String(chunk); });
    req.on('end', () => {
      received = { headers: req.headers, url: req.url, body: JSON.parse(raw) };
      reply(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const portOf = (): number => (server.address() as AddressInfo).port;
const json = (res: import('node:http').ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('createDirectiveRecallPort', () => {
  it('posts one tools/call to /mcp with the key and returns the parsed recall payload', async () => {
    const payload = { items: [{ memory_id: 'c1', content: 'run tests alone' }] };
    reply = (res) => json(res, 200, {
      jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    });
    const port = createDirectiveRecallPort({ port: portOf(), apiKey: 'k-secret' });

    await expect(port(REQUEST, AbortSignal.timeout(2000))).resolves.toEqual(payload);

    expect(received?.url).toBe('/mcp');
    expect(received?.headers.authorization).toBe('Bearer k-secret');
    expect(received?.headers.accept).toBe('application/json, text/event-stream');
    expect(received?.body).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'recall', arguments: REQUEST },
    });
  });

  it('sends no Authorization header without a key', async () => {
    reply = (res) => json(res, 200, { result: { content: [{ text: '{"items":[]}' }] } });
    await createDirectiveRecallPort({ port: portOf() })(REQUEST, AbortSignal.timeout(2000));
    expect(received?.headers.authorization).toBeUndefined();
  });

  it('rejects on a JSON-RPC error', async () => {
    reply = (res) => json(res, 200, { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad params' } });
    await expect(createDirectiveRecallPort({ port: portOf() })(REQUEST, AbortSignal.timeout(2000)))
      .rejects.toThrow('bad params');
  });

  it('rejects on a non-2xx response', async () => {
    reply = (res) => json(res, 401, { error: 'unauthorized' });
    await expect(createDirectiveRecallPort({ port: portOf() })(REQUEST, AbortSignal.timeout(2000)))
      .rejects.toThrow('401');
  });

  it.each([
    ['empty content', { result: { content: [] } }],
    ['tool error flag', { result: { isError: true, content: [{ text: 'boom' }] } }],
    ['non-JSON text', { result: { content: [{ text: 'not json' }] } }],
  ])('rejects malformed result (%s)', async (_name, body) => {
    reply = (res) => json(res, 200, body);
    await expect(createDirectiveRecallPort({ port: portOf() })(REQUEST, AbortSignal.timeout(2000)))
      .rejects.toThrow();
  });

  it('aborts a hung request when the caller signal fires', async () => {
    reply = () => undefined;
    const started = Date.now();

    await expect(createDirectiveRecallPort({ port: portOf() })(REQUEST, AbortSignal.timeout(100)))
      .rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
