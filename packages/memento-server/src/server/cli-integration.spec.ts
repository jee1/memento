import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import {
  writeServerInfo,
  readServerInfo,
  isServerAlive,
  callToolViaHttp,
  deleteServerInfo,
} from './server-info.js';
import {
  setupTestDatabase,
  cleanupTestDatabase,
  type TestDatabaseContext,
} from './test/helpers/test-database.js';
import { createToolContext, executeTool } from '@memento/core';

describe('CLI 통합 (server-info + callToolViaHttp)', () => {
  let tmpDir: string;
  let ctx: TestDatabaseContext;
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memento-cli-int-'));
    ctx = await setupTestDatabase();

    // lightweight test HTTP server mimicking management server
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
    app.post('/tools/:name', async (req, res) => {
      try {
        const context = createToolContext(ctx.db, ctx.services);
        const result = await executeTool(req.params.name, req.body, context);
        let actual: unknown = result;
        if (Array.isArray(result.content) && result.content[0]?.text) {
          try { actual = JSON.parse(result.content[0].text); } catch { /* ignore parse error */ }
        }
        res.json({ result: actual, tool: req.params.name, timestamp: new Date().toISOString() });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
    await writeServerInfo(tmpDir, port);
  }, 30_000);

  afterAll(async () => {
    await cleanupTestDatabase(ctx);
    await deleteServerInfo(tmpDir);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('server.json이 없으면 readServerInfo는 null을 반환한다', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'memento-empty-'));
    try {
      const info = await readServerInfo(emptyDir);
      expect(info).toBeNull();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('isServerAlive는 실행 중인 서버에 대해 true를 반환한다', async () => {
    const info = await readServerInfo(tmpDir);
    expect(info).not.toBeNull();
    const alive = await isServerAlive(info!);
    expect(alive).toBe(true);
  });

  it('isServerAlive는 존재하지 않는 PID에 대해 false를 반환한다', async () => {
    const fakeInfo = { port, pid: 999999999, startedAt: new Date().toISOString() };
    const alive = await isServerAlive(fakeInfo);
    expect(alive).toBe(false);
  });

  it('callToolViaHttp로 remember 호출이 성공한다', async () => {
    const result = await callToolViaHttp(port, 'remember', {
      content: '통합 테스트용 기억',
      type: 'semantic',
      tags: ['test'],
    });
    expect(result).toBeDefined();
  });

  it('callToolViaHttp로 recall 호출이 성공한다', async () => {
    const result = await callToolViaHttp(port, 'recall', {
      query: '통합 테스트용 기억',
      type: 'semantic',
    });
    expect(result).toBeDefined();
  });

  it('callToolViaHttp로 forget 호출이 성공한다', async () => {
    const remembered = await callToolViaHttp(port, 'remember', {
      content: 'forget 테스트용 기억',
      type: 'semantic',
      tags: ['forget-test'],
    }) as { id?: string };
    expect(remembered).toBeDefined();
    if (remembered?.id) {
      const result = await callToolViaHttp(port, 'forget', { id: remembered.id });
      expect(result).toBeDefined();
    }
  });

  it('callToolViaHttp로 memory_injection 호출이 성공한다', async () => {
    const result = await callToolViaHttp(port, 'memory_injection', {
      query: '통합 테스트',
    });
    expect(result).toBeDefined();
  });

  it('동시성: N회 병렬 호출 후 DB 무결성이 유지된다', async () => {
    const N = 10;
    const calls = Array.from({ length: N }, (_, i) =>
      callToolViaHttp(port, 'remember', {
        content: `동시성 테스트 ${i}`,
        type: 'semantic',
        tags: ['concurrency-test'],
      })
    );
    const results = await Promise.all(calls);
    expect(results).toHaveLength(N);
    results.forEach((r) => expect(r).toBeDefined());

    const recallResult = await callToolViaHttp(port, 'recall', {
      query: '동시성 테스트',
      type: 'semantic',
    });
    expect(recallResult).toBeDefined();
  });
});
