import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startServer as startHttpServer } from './http-server.js';
import { resolveServerStart, startServer as startStdioServer } from './index.js';

describe('server entrypoint transport selection', () => {
  it.each([undefined, '', 'stdio', 'STDIO'])(
    'selects the stdio server for %s',
    (transportType) => {
      expect(resolveServerStart(transportType)).toBe(startStdioServer);
    },
  );

  it.each(['sse', 'SSE'])(
    'selects the HTTP/SSE server for %s',
    (transportType) => {
      expect(resolveServerStart(transportType)).toBe(startHttpServer);
    },
  );

  it('rejects unsupported transport values', () => {
    expect(() => resolveServerStart('websocket')).toThrow(
      "지원되지 않는 TRANSPORT_TYPE: websocket. 'stdio' 또는 'sse'를 사용하세요.",
    );
  });

  it('reports invalid entrypoint configuration as a fatal start failure', () => {
    const entrypoint = resolve('packages/memento-server/src/server/index.ts');
    const result = spawnSync(process.execPath, ['--import', 'tsx', entrypoint], {
      cwd: resolve('.'),
      env: { ...process.env, TRANSPORT_TYPE: 'websocket' },
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "[FATAL ERROR] Unhandled start failure: 지원되지 않는 TRANSPORT_TYPE: websocket. 'stdio' 또는 'sse'를 사용하세요.",
    );
  });
});
