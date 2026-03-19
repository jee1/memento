/**
 * ADMIN_API_KEY 설정 시 관리 라우트 미들웨어 동작 검증.
 * mementoConfig는 모듈 로드 시점에 고정되므로 env 설정 후 resetModules + 동적 import 사용.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

async function createAdminProbeServer(): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  const express = (await import('express')).default;
  const { createAdminAuthMiddleware } = await import('./middleware/admin-auth.middleware.js');
  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminAuthMiddleware(), (_req, res) => {
    res.json({ ok: true });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}

describe('admin auth security (integration)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns 401 when ADMIN_API_KEY is set and request has no credentials', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'integration-test-admin-key');
    vi.resetModules();
    const { port, close } = await createAdminProbeServer();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/admin/probe`);
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('returns 200 when Authorization Bearer matches ADMIN_API_KEY', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'valid-bearer-key-abc');
    vi.resetModules();
    const { port, close } = await createAdminProbeServer();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/admin/probe`, {
        headers: { Authorization: 'Bearer valid-bearer-key-abc' }
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await close();
    }
  });

  it('returns 200 when X-API-Key matches ADMIN_API_KEY', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'x-api-key-value');
    vi.resetModules();
    const { port, close } = await createAdminProbeServer();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/admin/probe`, {
        headers: { 'X-API-Key': 'x-api-key-value' }
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});
