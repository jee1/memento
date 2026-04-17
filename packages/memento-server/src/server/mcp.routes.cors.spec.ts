/**
 * MCP 라우터 수동 CORS 헤더 및 OPTIONS 프리플라이트
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

type MockResponse = Pick<Response, 'status' | 'end' | 'setHeader'> & {
  headers: Record<string, string>;
  statusCode?: number;
  ended?: boolean;
};

function createMockResponse(): MockResponse {
  const response: MockResponse = {
    headers: {},
    statusCode: 200,
    ended: false,
    setHeader(name: string, value: string) {
      response.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      response.statusCode = code;
      return response as Response;
    },
    end() {
      response.ended = true;
      return response as Response;
    }
  };

  return response;
}

async function sendOptions(pathname: '/mcp' | '/messages', origin?: string) {
  const { createMcpRouter } = await import('./routes/mcp.routes.js');
  const router = createMcpRouter(null, null, {});
  const request = {
    method: 'OPTIONS',
    url: pathname,
    path: pathname,
    originalUrl: pathname,
    get(headerName: string) {
      if (headerName.toLowerCase() === 'origin') {
        return origin;
      }

      return undefined;
    }
  } as Request;
  const response = createMockResponse();
  const layer = (router as any).stack.find((candidate: any) => {
    const routePath = candidate.route?.path;
    const methods = candidate.route?.methods ?? {};
    return routePath === pathname && methods.options;
  });

  if (!layer?.route?.stack?.[0]?.handle) {
    throw new Error(`OPTIONS handler not found for ${pathname}`);
  }

  layer.route.stack[0].handle(request, response);

  return response;
}

describe('mcp.routes CORS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('OPTIONS /mcp returns 204 without Access-Control-Allow-Origin when allowlist empty', async () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
    vi.resetModules();

    const response = await sendOptions('/mcp', 'https://any.example');

    expect(response.statusCode).toBe(204);
    expect(response.ended).toBe(true);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers.vary).toBeUndefined();
  });

  it('OPTIONS /messages reflects Origin when listed in CORS_ALLOWED_ORIGINS', async () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://trusted.app,http://localhost:3000');
    vi.resetModules();

    const response = await sendOptions('/messages', 'https://trusted.app');

    expect(response.statusCode).toBe(204);
    expect(response.ended).toBe(true);
    expect(response.headers['access-control-allow-origin']).toBe('https://trusted.app');
    expect(response.headers.vary).toBe('Origin');
  });
});
