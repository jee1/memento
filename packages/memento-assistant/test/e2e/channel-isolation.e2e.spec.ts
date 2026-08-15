import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MementoAssistant } from '../../src/assistant.js';
import { startTestHttpServer, type TestServer } from '../helpers/start-http-server.js';
import { HttpTransport } from '../../src/transport/http-transport.js';

describe('E2E: channel isolation', { timeout: 60_000 }, () => {
  let server: TestServer;

  beforeAll(async () => { server = await startTestHttpServer(); });
  afterAll(async () => { await server.stop(); });

  it('fact stored on telegram NOT recalled on discord when crossChannelRecall=off', async () => {
    const tgTransport = new HttpTransport({ baseUrl: server.url, token: server.apiKey });
    const tg = MementoAssistant.fromEnv(
      { transport: tgTransport, ownerId: 'u2', channel: 'telegram', policy: { autoRemember: 'off' } },
      {},
    );
    await tg.remember({ content: 'isolation-only-telegram fact', type: 'episodic', tags: ['channel:telegram'] });

    const dcTransport = new HttpTransport({ baseUrl: server.url, token: server.apiKey });
    const dc = MementoAssistant.fromEnv(
      { transport: dcTransport, ownerId: 'u2', channel: 'discord', policy: { crossChannelRecall: 'off' } },
      {},
    );
    const ctx = await dc.beforeUserTurn({ userMessage: 'isolation-only-telegram?', conversationId: 'c2' });
    // channel:discord filter → no match for channel:telegram item
    expect(ctx.degraded).toBe(false);
    expect(ctx.systemContext).not.toContain('isolation-only-telegram');
    await tgTransport.close();
    await dcTransport.close();
  });
});
