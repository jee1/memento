import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { callToolViaHttp, readServerInfo } from './server-info.js';

describe('stdio HTTP sidecar subprocess integration', () => {
  let configDir: string;
  const clients: Client[] = [];
  const listeners: Server[] = [];
  const apiKey = 'sidecar-integration-key';

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'memento-stdio-sidecar-'));
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map(client => client.close()));
    await Promise.all(listeners.splice(0).map(server => new Promise<void>((resolveClose, reject) => {
      server.close(error => error ? reject(error) : resolveClose());
    })));
    vi.unstubAllEnvs();
    await rm(configDir, { recursive: true, force: true });
  });

  async function startStdio(sidecar?: string, port = 0) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', resolve('packages/memento-server/src/server/index.ts')],
      cwd: resolve('.'),
      stderr: 'pipe',
      env: {
        HOME: configDir,
        NODE_ENV: 'test',
        DB_PATH: join(configDir, 'memory.db'),
        MEMENTO_CONFIG_DIR: configDir,
        TRANSPORT_TYPE: 'stdio',
        ...(sidecar === undefined ? {} : { MEMENTO_HTTP_SIDECAR: sidecar }),
        MCP_SERVER_PORT: String(port),
        MEMENTO_HTTP_BIND_HOST: '127.0.0.1',
        ADMIN_API_KEY: apiKey,
        EMBEDDING_PROVIDER: 'tfidf',
        BATCH_SCHEDULER_ENABLED: 'false',
        WAL_CHECKPOINT_ENABLED: 'false',
        DB_LOCK_MONITOR_ENABLED: 'false',
        OLLAMA_BASE_URL: 'http://127.0.0.1:1',
      },
    });
    let stderr = '';
    transport.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8000); });
    const client = new Client({ name: 'sidecar-integration', version: '1.0.0' });
    const protocolErrors: Error[] = [];
    client.onerror = error => { protocolErrors.push(error); };
    clients.push(client);
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name)).toContain('remember');
      const result = await client.callTool({
        name: 'remember',
        arguments: { content: 'stdio sidecar integration memory', type: 'working' },
      });
      expect(result.isError, stderr).not.toBe(true);
    } catch (error) {
      throw new Error(`stdio startup/tool call failed: ${String(error)}\n${stderr}`);
    }
    return { client, transport, protocolErrors, stderr: () => stderr };
  }

  async function listen(port = 0) {
    const server = createServer((_req, res) => { res.end('occupied'); });
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolveListen);
    });
    listeners.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    return address.port;
  }

  it('serves MCP and authenticated HTTP, preserves the owner, and cleans up on stdin close', async () => {
    const owner = await startStdio('1');
    await vi.waitFor(async () => {
      expect(await readServerInfo(configDir), owner.stderr()).not.toBeNull();
    }, { timeout: 15000, interval: 50 });
    const info = (await readServerInfo(configDir))!;
    expect(info.pid).toBe(owner.transport.pid);
    const baseUrl = `http://127.0.0.1:${info.port}`;
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    const dashboard = await fetch(`${baseUrl}/dashboard`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get('content-type')).toContain('text/html');
    expect((await dashboard.text()).toLowerCase()).toContain('<!doctype html>');
    expect((await fetch(`${baseUrl}/tools/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'integration', type: 'working' }),
    })).status).toBe(401);
    vi.stubEnv('ADMIN_API_KEY', apiKey);
    expect(await callToolViaHttp(info.port, 'recall', {
      query: 'integration', type: 'working', owner_id: 'sidecar-integration', auto_set_anchor: false,
    })).toBeDefined();

    const second = await startStdio('1');
    expect(await readServerInfo(configDir)).toEqual(info);
    await second.client.close();
    expect(await readServerInfo(configDir)).toEqual(info);
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect(second.protocolErrors).toEqual([]);
    await owner.client.close();
    expect(owner.stderr()).toContain('stdio close');
    expect(owner.stderr()).not.toContain('received SIGTERM');
    await vi.waitFor(async () => {
      expect(await readServerInfo(configDir)).toBeNull();
    }, { timeout: 5000, interval: 50 });
    expect(owner.protocolErrors).toEqual([]);
    expect(await listen(info.port)).toBe(info.port);
  }, 60000);

  it('keeps stdio usable when the sidecar port is occupied', async () => {
    const port = await listen();
    const stdio = await startStdio('1', port);
    await vi.waitFor(() => {
      expect(stdio.stderr()).toContain('HTTP/WebSocket MCP 서버 v2 시작 중');
    }, { timeout: 15000, interval: 50 });
    expect(await readServerInfo(configDir)).toBeNull();
    expect((await stdio.client.callTool({
      name: 'recall', arguments: { query: 'integration', type: 'working', auto_set_anchor: false },
    })).isError).not.toBe(true);
    await stdio.client.close();
    expect(await readServerInfo(configDir)).toBeNull();
    expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('occupied');
    expect(stdio.protocolErrors).toEqual([]);
  }, 60000);

  it('does not publish HTTP discovery when the sidecar is off by default', async () => {
    const stdio = await startStdio();
    await stdio.client.close();
    expect(await readServerInfo(configDir)).toBeNull();
    expect(stdio.protocolErrors).toEqual([]);
  }, 60000);
});
