import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startServer as startHttpServer } from './http-server.js';
import { resolveServerStart, startServer as startStdioServer } from './index.js';

describe('server entrypoint transport selection', () => {
  it.each(['index.ts', 'http-server.ts'])('starts %s through an npm bin symlink', (entry) => {
    const binDir = mkdtempSync(resolve('.issue-1513-bin-'));
    try {
      const linkPath = resolve(binDir, 'memento-bin.ts');
      symlinkSync(resolve('packages/memento-server/src/server', entry), linkPath);
      const result = spawnSync(process.execPath, ['--import', 'tsx', linkPath], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          TRANSPORT_TYPE: 'websocket',
          MEMENTO_HTTP_BIND_HOST: '0.0.0.0',
          ADMIN_API_KEY: '',
          MEMENTO_API_TOKENS: '',
          MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: 'false',
        },
        encoding: 'utf8',
        timeout: 10_000,
      });

      // Invalid startup settings prove the entrypoint ran without opening a DB or listener.
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('[FATAL ERROR] Unhandled start failure:');
      expect(result.stderr).toContain(entry === 'index.ts' ? 'websocket' : 'MEMENTO_HTTP_BIND_HOST');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

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
