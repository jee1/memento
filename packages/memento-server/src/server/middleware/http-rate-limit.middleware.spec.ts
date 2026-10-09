import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAdminRateLimitMiddleware,
  createAgentRateLimitMiddleware,
  createMcpRateLimitMiddleware,
  createToolsRateLimitMiddleware,
  isHttpRateLimitDisabled,
} from './http-rate-limit.middleware.js';
import { resolveTrustProxySetting } from './trust-proxy.js';

function getRequest(
  port: number,
  path: string,
  method = 'GET',
  extraHeaders: Record<string, string> = {},
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { Connection: 'close', ...extraHeaders },
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

  it('limits /mcp and /api/v1/agent in their own buckets', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_DISABLED', '');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_MCP', '1');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_AGENT', '1');

    const app = express();
    app.use(['/mcp', '/messages'], createMcpRateLimitMiddleware());
    app.use('/api/v1/agent', createAgentRateLimitMiddleware());
    app.use((_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const key = { 'X-API-Key': 'token-a' };

    try {
      expect((await getRequest(port, '/mcp', 'POST', key)).statusCode).toBe(200);
      // /messages shares the MCP budget.
      expect((await getRequest(port, '/messages', 'POST', key)).statusCode).toBe(429);
      // An exhausted MCP budget does not block agent hooks, and vice versa.
      expect((await getRequest(port, '/api/v1/agent/sessions', 'POST', key)).statusCode).toBe(200);
      expect((await getRequest(port, '/api/v1/agent/sessions', 'POST', key)).statusCode).toBe(429);
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
  /**
   * #1161: 키가 `req.ip` 하나였을 때는 브라우저·탭·기기·스크립트가 한 카운터를 공유했다.
   * Docker 포트 퍼블리싱·리버스 프록시 뒤에서 출발지가 하나로 보이기 때문이다.
   */
  it('gives each browser session its own budget and shares it across tabs (#1161)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_DISABLED', '');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_ADMIN_READ', '2');

    const app = express();
    app.use('/admin', createAdminRateLimitMiddleware(), (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const sessionA = { Cookie: 'memento_admin_session=session-a' };
    const sessionB = { Cookie: 'memento_admin_session=session-b' };

    try {
      // 같은 세션의 두 탭은 한 예산을 공유한다.
      expect((await getRequest(port, '/admin/status', 'GET', sessionA)).statusCode).toBe(200);
      expect((await getRequest(port, '/admin/batch/stats', 'GET', sessionA)).statusCode).toBe(200);
      expect((await getRequest(port, '/admin/status', 'GET', sessionA)).statusCode).toBe(429);

      // 다른 세션은 그 소진에 영향을 받지 않는다.
      expect((await getRequest(port, '/admin/status', 'GET', sessionB)).statusCode).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('keys programmatic clients by their API key, not the shared source IP (#1161)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_DISABLED', '');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_TOOLS', '1');

    const app = express();
    app.use('/tools', createToolsRateLimitMiddleware(), (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const keyA = { 'X-API-Key': 'token-a' };
      expect((await getRequest(port, '/tools/recall', 'GET', keyA)).statusCode).toBe(200);
      expect((await getRequest(port, '/tools/recall', 'GET', keyA)).statusCode).toBe(429);
      expect(
        (await getRequest(port, '/tools/recall', 'GET', { Authorization: 'Bearer token-b' }))
          .statusCode,
      ).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('ignores X-Forwarded-For unless trust proxy is configured (#1161)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_DISABLED', '');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_TOOLS', '1');

    const app = express();
    app.use('/tools', createToolsRateLimitMiddleware(), (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      expect(
        (await getRequest(port, '/tools/recall', 'GET', { 'X-Forwarded-For': '203.0.113.1' }))
          .statusCode,
      ).toBe(200);
      // 헤더를 바꿔도 키가 바뀌지 않아 한도가 초기화되지 않는다.
      expect(
        (await getRequest(port, '/tools/recall', 'GET', { 'X-Forwarded-For': '203.0.113.2' }))
          .statusCode,
      ).toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('keys unauthenticated clients by the proxied IP when trust proxy is set (#1161)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_DISABLED', '');
    vi.stubEnv('MEMENTO_HTTP_RATE_LIMIT_TOOLS', '1');

    const app = express();
    app.set('trust proxy', resolveTrustProxySetting('1').setting ?? false);
    app.use('/tools', createToolsRateLimitMiddleware(), (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      expect(
        (await getRequest(port, '/tools/recall', 'GET', { 'X-Forwarded-For': '203.0.113.1' }))
          .statusCode,
      ).toBe(200);
      expect(
        (await getRequest(port, '/tools/recall', 'GET', { 'X-Forwarded-For': '203.0.113.1' }))
          .statusCode,
      ).toBe(429);
      // 프록시 뒤 다른 클라이언트는 자기 예산을 갖는다.
      expect(
        (await getRequest(port, '/tools/recall', 'GET', { 'X-Forwarded-For': '203.0.113.9' }))
          .statusCode,
      ).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
