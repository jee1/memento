import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { ServerServices } from '@memento/core';

const mocks = vi.hoisted(() => ({
  createCore: vi.fn(), closeDatabase: vi.fn(), startHttp: vi.fn(), closeHttp: vi.fn(),
  readInfo: vi.fn(), isAlive: vi.fn(), deleteInfo: vi.fn(), acquire: vi.fn(), release: vi.fn(),
  log: vi.fn(),
}));
vi.mock('@memento/core', () => ({
  createMementoCore: mocks.createCore, closeDatabase: mocks.closeDatabase,
  mementoConfig: { dbPath: '/tmp/sidecar-test.db' }, validateConfig: vi.fn(), getExposedTools: vi.fn(),
}));
vi.mock('./http-server.js', () => ({ startServer: mocks.startHttp, closeHttpServer: mocks.closeHttp }));
vi.mock('./server-info.js', () => ({
  readServerInfo: mocks.readInfo, isServerAlive: mocks.isAlive, deleteServerInfo: mocks.deleteInfo,
  resolveServerInfoConfigDir: () => '/tmp/sidecar-config',
}));
vi.mock('./utils/instance-lock.js', () => ({ tryAcquireLock: mocks.acquire, releaseLock: mocks.release }));
vi.mock('./mcp-logger.js', () => ({ mcpLogger: { logServer: mocks.log } }));
vi.mock('./audit-tool-dispatch.js', () => ({ dispatchTool: vi.fn() }));

import { __test, cleanup } from './index.js';

describe('stdio HTTP sidecar', () => {
  const database = {} as Database.Database;
  const services = {
    batchScheduler: { stop: vi.fn() }, walCheckpointScheduler: { stop: vi.fn() },
    databaseLockMonitor: { stop: vi.fn() },
  } as unknown as ServerServices;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DB_PATH', undefined);
    vi.stubEnv('MEMENTO_HTTP_SIDECAR', '1');
    mocks.createCore.mockResolvedValue({ db: database, services });
    mocks.readInfo.mockResolvedValue(null);
    mocks.isAlive.mockResolvedValue(false);
    mocks.acquire.mockReturnValue({ acquired: true });
    mocks.startHttp.mockResolvedValue({ address: () => ({ port: 43210 }) });
    __test.setTestDependencies({ database: null, serverServices: null });
  });
  afterEach(async () => { await cleanup(); vi.unstubAllEnvs(); });

  it.each(['', '0', 'true'])('keeps sidecar off unless explicitly 1 (%s)', async (value) => {
    vi.stubEnv('MEMENTO_HTTP_SIDECAR', value);
    await __test.runHeavyInit();
    expect(mocks.createCore).toHaveBeenCalledOnce();
    expect(mocks.readInfo).not.toHaveBeenCalled();
    expect(mocks.startHttp).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, '/tmp/sidecar-test.db'],
    ['/tmp/sidecar-override.db', '/tmp/sidecar-override.db'],
  ])('shares the single initialized core with HTTP (DB_PATH=%s)', async (dbPath, expectedPath) => {
    vi.stubEnv('DB_PATH', dbPath);
    await __test.runHeavyInit();
    expect(mocks.createCore).toHaveBeenCalledOnce();
    expect(mocks.createCore).toHaveBeenCalledWith({ dbPath: expectedPath });
    expect(mocks.startHttp).toHaveBeenCalledWith({ database, serverServices: services });
    expect(mocks.acquire).toHaveBeenCalledWith(expectedPath);
  });

  it('leaves an existing live server and its discovery file alone', async () => {
    mocks.readInfo.mockResolvedValue({ pid: 1234, port: 9001 });
    mocks.isAlive.mockResolvedValue(true);
    await __test.runHeavyInit();
    await cleanup();
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.startHttp).not.toHaveBeenCalled();
    expect(mocks.deleteInfo).not.toHaveBeenCalled();
  });

  it('continues stdio when another instance holds the lock', async () => {
    mocks.acquire.mockReturnValue({ acquired: false, existingPid: 1234 });
    await __test.runHeavyInit();
    expect(mocks.startHttp).not.toHaveBeenCalled();
    expect(mocks.closeDatabase).not.toHaveBeenCalled();
  });

  it.each(['EADDRINUSE', 'EACCES'])('keeps the core alive after HTTP %s', async (code) => {
    mocks.startHttp.mockRejectedValueOnce(Object.assign(new Error('listen failed'), { code }));
    await __test.runHeavyInit();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.closeDatabase).not.toHaveBeenCalled();
    expect(mocks.deleteInfo).not.toHaveBeenCalled();
    if (code === 'EADDRINUSE') expect(mocks.log).not.toHaveBeenCalledWith('warn', expect.anything());
  });

  it('closes owned HTTP before the core and removes only owned discovery info, once', async () => {
    await __test.runHeavyInit();
    mocks.readInfo.mockResolvedValue({ pid: process.pid, port: 43210 });
    await Promise.all([cleanup(), cleanup()]);
    expect(mocks.closeHttp).toHaveBeenCalledOnce();
    expect(mocks.deleteInfo).toHaveBeenCalledWith('/tmp/sidecar-config');
    expect(mocks.closeDatabase).toHaveBeenCalledOnce();
    expect(mocks.closeHttp.mock.invocationCallOrder[0]).toBeLessThan(mocks.closeDatabase.mock.invocationCallOrder[0]!);
  });

  it('does not delete discovery info replaced by another server', async () => {
    await __test.runHeavyInit();
    mocks.readInfo.mockResolvedValue({ pid: 1234, port: 54321 });
    await cleanup();
    expect(mocks.deleteInfo).not.toHaveBeenCalled();
  });

  it('waits for an in-flight HTTP start before releasing the shared core', async () => {
    let finishStart!: (server: unknown) => void;
    mocks.startHttp.mockImplementationOnce(() => new Promise((resolve) => { finishStart = resolve; }));
    const init = __test.runHeavyInit();
    await vi.waitFor(() => expect(mocks.startHttp).toHaveBeenCalledOnce());
    const stopped = cleanup();
    expect(mocks.closeDatabase).not.toHaveBeenCalled();
    finishStart({ address: () => ({ port: 43210 }) });
    await Promise.all([init, stopped]);
    expect(mocks.closeHttp).toHaveBeenCalledOnce();
    expect(mocks.closeDatabase).toHaveBeenCalledOnce();
  });
});
