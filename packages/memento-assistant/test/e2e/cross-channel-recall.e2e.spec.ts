import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MementoAssistant } from '../../src/assistant.js';
import { startTestHttpServer, type TestServer } from '../helpers/start-http-server.js';
import { HttpTransport } from '../../src/transport/http-transport.js';

describe('E2E: cross-channel recall', { timeout: 60_000 }, () => {
  let server: TestServer;

  beforeAll(async () => { server = await startTestHttpServer(); });
  afterAll(async () => { await server.stop(); });

  it('fact stored on telegram is recalled on discord (crossChannelRecall on)', async () => {
    const tgTransport = new HttpTransport({ baseUrl: server.url, token: server.apiKey });
    const tg = MementoAssistant.fromEnv(
      { transport: tgTransport, ownerId: 'u1', channel: 'telegram', policy: { autoRemember: 'off' } },
      {},
    );
    await tg.remember({ content: 'e2e cross-channel fact', type: 'episodic', tags: [] });

    const dcTransport = new HttpTransport({ baseUrl: server.url, token: server.apiKey });
    const dc = MementoAssistant.fromEnv(
      { transport: dcTransport, ownerId: 'u1', channel: 'discord' },
      {},
    );
    const ctx = await dc.beforeUserTurn({ userMessage: 'e2e cross-channel?', conversationId: 'c1' });
    expect(ctx.systemContext).toContain('cross-channel');
    await tgTransport.close();
    await dcTransport.close();
  });
});
