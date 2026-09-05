import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createMementoCore, logger, mementoConfig } from '@memento/core';
import { cleanupTestDatabase, setupTestDatabase, type TestDatabaseContext } from './test/helpers/test-database.js';
import { writeServerInfo } from './server-info.js';

vi.mock('@memento/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memento/core')>();
  return { ...actual, createMementoCore: vi.fn(actual.createMementoCore) };
});
vi.mock('./server-info.js', () => ({
  resolveServerInfoConfigDir: () => '/test-config',
  writeServerInfo: vi.fn().mockResolvedValue(undefined),
  deleteServerInfo: vi.fn().mockResolvedValue(undefined),
}));

describe('HTTP sidecar lifecycle', () => {
  let ctx: TestDatabaseContext;
  let http: typeof import('./http-server.js');
  const originalConfig = { ...mementoConfig };

  beforeAll(async () => { ctx = await setupTestDatabase(); });
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(writeServerInfo).mockResolvedValue(undefined);
    Object.assign(mementoConfig, {
      port: 0,
      httpListenHost: '127.0.0.1',
      apiTokens: [{ id: 'test', secret: 'sidecar-test-token', scopes: ['tools:invoke'] }],
    });
    http = await import('./http-server.js');
  });
  afterEach(async () => {
    await http.closeHttpServer();
    Object.assign(mementoConfig, originalConfig);
    vi.restoreAllMocks();
  });
  afterAll(async () => { await cleanupTestDatabase(ctx); });

  it('reuses the core, awaits discovery publication, and leaves process handlers to stdio', async () => {
    const handlerCounts = ['SIGINT', 'SIGTERM', 'uncaughtException'].map((event) => process.listenerCount(event));
    let releaseWrite!: () => void;
    vi.mocked(writeServerInfo).mockImplementationOnce(() => new Promise<void>((resolve) => { releaseWrite = resolve; }));
    let started = false;
    const startup = http.startServer({ database: ctx.db, serverServices: ctx.services }).then((server) => {
      started = true;
      return server;
    });
    await vi.waitFor(() => expect(writeServerInfo).toHaveBeenCalledOnce());
    expect(started).toBe(false);
    releaseWrite();
    const server = await startup;
    const port = (server.address() as AddressInfo).port;
    expect(port).toBeGreaterThan(0);
    expect(writeServerInfo).toHaveBeenCalledWith('/test-config', port);
    expect(createMementoCore).not.toHaveBeenCalled();
    expect(http.__test.getDatabase()).toBe(ctx.db);
    expect(http.__test.getSearchEngine()).toBe(ctx.services.searchEngine);
    expect(['SIGINT', 'SIGTERM', 'uncaughtException'].map((event) => process.listenerCount(event))).toEqual(handlerCounts);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  });

  it('rejects an occupied port without stopping the shared services or database', async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    mementoConfig.port = (occupied.address() as AddressInfo).port;
    const stop = vi.spyOn(ctx.services.batchScheduler!, 'stop');
    const logError = vi.spyOn(logger, 'error');
    try {
      await expect(http.startServer({ database: ctx.db, serverServices: ctx.services })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(ctx.db.open).toBe(true);
      expect(stop).not.toHaveBeenCalled();
      expect(writeServerInfo).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it('removes startup listeners after a synchronous listen failure', async () => {
    const server = http.__test.getServer();
    const originalListening = server.listeners('listening');
    const originalErrors = server.listeners('error');
    vi.spyOn(server, 'listen').mockImplementation(() => { throw new RangeError('invalid port'); });
    await expect(http.startServer({ database: ctx.db, serverServices: ctx.services })).rejects.toThrow('invalid port');
    expect(server.listeners('listening').every((listener) => originalListening.includes(listener))).toBe(true);
    expect(server.listeners('error').every((listener) => originalErrors.includes(listener))).toBe(true);
    expect(ctx.db.open).toBe(true);
  });

  it('keeps serving when publishing server info fails', async () => {
    vi.mocked(writeServerInfo).mockRejectedValueOnce(new Error('read-only config directory'));
    const server = await http.startServer({ database: ctx.db, serverServices: ctx.services });
    expect(server.listening).toBe(true);
    expect(ctx.db.open).toBe(true);
  });

  it('creates its own core and registers cleanup handlers in standalone mode', async () => {
    const lifecycle = await import('./http-server-lifecycle.js');
    const register = vi.spyOn(lifecycle, 'registerCleanupHandlers').mockImplementation(() => {});
    vi.mocked(createMementoCore).mockResolvedValueOnce({ db: ctx.db, services: ctx.services } as Awaited<ReturnType<typeof createMementoCore>>);
    const server = await http.startServer();
    expect(server.listening).toBe(true);
    expect(createMementoCore).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledOnce();
  });

  it('closes active WebSocket and SSE connections while preserving the core', async () => {
    const server = await http.startServer({ database: ctx.db, serverServices: ctx.services });
    const port = (server.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(socket, 'open');
    const socketClosed = once(socket, 'close');
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: { Authorization: 'Bearer sidecar-test-token' },
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    await http.closeHttpServer();
    await socketClosed;
    while (!(await reader.read()).done) { /* drain buffered SSE frames */ }
    expect(server.listening).toBe(false);
    expect(ctx.db.open).toBe(true);
  });
});
