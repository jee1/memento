import type { IncomingMessage } from 'http';
import { describe, expect, it } from 'vitest';

import { scopeArgsToBoundAgent } from './audit-tool-dispatch.js';
import { createApiTokenRegistry } from './auth/api-token-registry.js';
import { createSessionStore } from './auth/session-store.js';
import { createWebSocketVerifyClient } from './http-server-websocket.js';
import { DASHBOARD_SESSION_COOKIE_NAME } from './middleware/session-auth.middleware.js';

const registry = createApiTokenRegistry([
  { id: 'tools', secret: 'tools-secret', scopes: ['tools:invoke'] },
  { id: 'admin-only', secret: 'admin-only-secret', scopes: ['admin:destructive'] },
]);
const store = createSessionStore({ idleTtlMs: 60_000, absoluteTtlMs: 60_000 });

function verify(headers: Record<string, string>, origin?: string): Promise<{ ok: boolean; code?: number }> {
  const verifyClient = createWebSocketVerifyClient({
    getSessionStore: () => store,
    getTokenRegistry: () => registry,
    allowedOrigins: ['https://allowed.example'],
  });
  const req = { headers: { host: '127.0.0.1:9001', ...headers } } as unknown as IncomingMessage;
  return new Promise((resolve) => {
    verifyClient({ origin: origin ?? '', secure: false, req }, (ok, code) => resolve({ ok, code }));
  });
}

describe('WebSocket upgrade auth', () => {
  it('rejects a connection without credentials, whatever the origin', async () => {
    expect(await verify({}, 'https://evil.example')).toEqual({ ok: false, code: 401 });
    expect(await verify({})).toEqual({ ok: false, code: 401 });
  });

  it('accepts an API token with tools:invoke and refuses one without it', async () => {
    expect((await verify({ authorization: 'Bearer tools-secret' })).ok).toBe(true);
    expect((await verify({ 'x-api-key': 'tools-secret' })).ok).toBe(true);
    expect(await verify({ authorization: 'Bearer admin-only-secret' })).toEqual({ ok: false, code: 403 });
    expect(await verify({ authorization: 'Bearer wrong' })).toEqual({ ok: false, code: 401 });
  });

  it('accepts a dashboard session only from this server or an allowed origin', async () => {
    const cookie = `${DASHBOARD_SESSION_COOKIE_NAME}=${store.create().sessionId}`;
    expect((await verify({ cookie }, 'http://127.0.0.1:9001')).ok).toBe(true);
    expect((await verify({ cookie }, 'https://allowed.example')).ok).toBe(true);
    expect(await verify({ cookie }, 'https://evil.example')).toEqual({ ok: false, code: 403 });
    expect(await verify({ cookie })).toEqual({ ok: false, code: 403 });
    expect(await verify({ cookie: `${DASHBOARD_SESSION_COOKIE_NAME}=forged` }, 'http://127.0.0.1:9001'))
      .toEqual({ ok: false, code: 401 });
  });
});

describe('scopeArgsToBoundAgent', () => {
  it('leaves args alone without a bound agent', () => {
    const args = { owner_id: 'b' };
    expect(scopeArgsToBoundAgent('recall', args, undefined)).toBe(args);
  });

  it('refuses owner_id or agent_id naming another agent', () => {
    expect(() => scopeArgsToBoundAgent('recall', { owner_id: 'b' }, 'a')).toThrow(/owner_id must match/);
    expect(() => scopeArgsToBoundAgent('recall', { owner_id: ['a', 'b'] }, 'a')).toThrow(/owner_id must match/);
    expect(() => scopeArgsToBoundAgent('recall', { type: 'core', agent_id: 'b' }, 'a')).toThrow(/agent_id must match/);
  });

  it('fills owner_id for read tools and keeps a matching one', () => {
    expect(scopeArgsToBoundAgent('recall', { query: 'q' }, 'a')).toEqual({ query: 'q', owner_id: 'a' });
    expect(scopeArgsToBoundAgent('memory_injection', undefined, 'a')).toEqual({ owner_id: 'a' });
    expect(scopeArgsToBoundAgent('recall', { owner_id: ['a'] }, 'a')).toEqual({ owner_id: ['a'] });
    expect(scopeArgsToBoundAgent('remember', { content: 'c' }, 'a')).toEqual({ content: 'c' });
  });
});
