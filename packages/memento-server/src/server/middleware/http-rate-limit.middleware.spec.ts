import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAdminRateLimitMiddleware,
  createToolsRateLimitMiddleware,
  isHttpRateLimitDisabled,
} from './http-rate-limit.middleware.js';

function getRequest(
  port: number,
  path: string,
  method = 'GET',
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { Connection: 'close' },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('http-rate-limit.middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled in test NODE_ENV by default', () => {
    expect(isHttpRateLimitDisabled()).toBe(true);
  });

  it('returns 429 with Retry-After when the tools bucket is exceeded', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_DISABLED', '');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_TOOLS', '2');

    const app = express();
    app.use('/tools', createToolsRateLimitMiddleware(), (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      expect((await getRequest(port, '/tools/ping')).statusCode).toBe(200);
      expect((await getRequest(port, '/tools/ping')).statusCode).toBe(200);
      const limited = await getRequest(port, '/tools/ping');
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBeTruthy();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('keeps admin reads and writes in separate buckets (#1158)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_DISABLED', '');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_ADMIN_READ', '2');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_ADMIN', '2');

    const app = express();
    app.use('/admin', createAdminRateLimitMiddleware(), (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      expect((await getRequest(port, '/admin/batch/stats')).statusCode).toBe(200);
      expect((await getRequest(port, '/admin/batch/runs')).statusCode).toBe(200);
      const limitedRead = await getRequest(port, '/admin/batch/runs');
      expect(limitedRead.statusCode).toBe(429);
      expect(limitedRead.headers['retry-after']).toBeTruthy();

      // Reads exhausting their budget must not block the operator's write.
      expect((await getRequest(port, '/admin/batch/run', 'POST')).statusCode).toBe(200);
      expect((await getRequest(port, '/admin/batch/run', 'POST')).statusCode).toBe(200);
      expect((await getRequest(port, '/admin/batch/run', 'POST')).statusCode).toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
