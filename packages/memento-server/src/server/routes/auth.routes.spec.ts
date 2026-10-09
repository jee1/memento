import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createSessionStore } from '../auth/session-store.js';
import { createAuthRouter } from './auth.routes.js';

async function sessionCookie(secureCookie: boolean, proto?: string): Promise<string> {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(
    '/auth',
    createAuthRouter({
      expectedKey: 'k',
      store: createSessionStore({ idleTtlMs: 60_000, absoluteTtlMs: 60_000 }),
      cookieName: 'sid',
      secureCookie,
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/auth/session`, {
      method: 'POST',
      headers: { 'X-API-Key': 'k', ...(proto ? { 'X-Forwarded-Proto': proto } : {}) },
    });
    expect(res.status).toBe(204);
    return res.headers.get('set-cookie') ?? '';
  } finally {
    server.close();
  }
}

describe('auth.routes session cookie Secure flag', () => {
  it('marks the cookie Secure on an HTTPS request even outside production', async () => {
    expect(await sessionCookie(false, 'https')).toMatch(/;\s*Secure/i);
  });

  it('leaves plain-HTTP dev requests without Secure so localhost login keeps working', async () => {
    expect(await sessionCookie(false)).not.toMatch(/;\s*Secure/i);
  });

  it('always marks Secure when configured', async () => {
    expect(await sessionCookie(true)).toMatch(/;\s*Secure/i);
  });
});
