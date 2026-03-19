/**
 * MCP 라우터 수동 CORS 헤더 및 OPTIONS 프리플라이트
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

describe('mcp.routes CORS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function listenWithMcpRouter(): Promise<{ port: number; close: () => Promise<void> }> {
    const { createMcpRouter } = await import('./routes/mcp.routes.js');
    const app = express();
    const transports: Record<string, unknown> = {};
    app.use(createMcpRouter(null, null, transports as any));
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

  it('OPTIONS /mcp returns 204 without Access-Control-Allow-Origin when allowlist empty', async () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
    vi.resetModules();
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://any.example' }
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('vary')).toBeNull();
    } finally {
      await close();
    }
  });

  it('OPTIONS /messages reflects Origin when listed in CORS_ALLOWED_ORIGINS', async () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://trusted.app,http://localhost:3000');
    vi.resetModules();
    const { port, close } = await listenWithMcpRouter();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/messages`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://trusted.app' }
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://trusted.app');
      expect(res.headers.get('vary')).toBe('Origin');
    } finally {
      await close();
    }
  });
});
