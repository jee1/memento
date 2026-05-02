import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HttpTransport } from '../../src/transport/http-transport.js';
import { startTestHttpServer, type TestServer } from '../helpers/start-http-server.js';

describe('http integration', { timeout: 60_000 }, () => {
  let server: TestServer;
  let t: HttpTransport;

  beforeAll(async () => {
    server = await startTestHttpServer();
    t = new HttpTransport({ baseUrl: server.url, token: server.apiKey });
  });

  afterAll(async () => {
    await t.close();
    await server.stop();
  });

  it('roundtrip: remember → recall', async () => {
    await t.remember({ content: 'http integration fact', type: 'episodic' });
    const r = await t.recall('http integration fact', undefined, 5);
    expect(r.items.some(i => i.content.includes('http integration'))).toBe(true);
  });

  it('returns degraded when wrong API key (401)', async () => {
    const badT = new HttpTransport({ baseUrl: server.url, token: 'wrong-key' });
    await expect(badT.recall('test', undefined, 1)).rejects.toThrow();
    await badT.close();
  });
});
