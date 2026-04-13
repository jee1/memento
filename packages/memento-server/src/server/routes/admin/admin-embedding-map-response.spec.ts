/**
 * 임베딩 맵 응답 /admin/embedding-map (014-embedding-map-dashboard)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { umapFitAsyncMock, umapFitMock } = vi.hoisted(() => {
  const project = (X: number[][]) =>
    X.map((row: number[]) => [row[0] ?? 0, (row[1] ?? 0) + 0.01]);
  return {
    umapFitAsyncMock: vi.fn((X: number[][]) => Promise.resolve(project(X))),
    umapFitMock: vi.fn((X: number[][]) => project(X)),
  };
});

vi.mock('umap-js', () => ({
  UMAP: class {
    fitAsync = umapFitAsyncMock;
    fit = umapFitMock;
  },
}));

import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { createAdminRouter } from '../admin.routes.js';
import {
  buildEmbeddingMapResponse,
  clearEmbeddingMapCacheForTests,
  EmbeddingMapBuildError,
  kMeans,
} from './admin-embedding-map-response.js';

function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error('no port'));
      }
    });
  });
}

function getAdmin(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Connection: 'close' },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function createMinimalSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL,
      created_at TEXT,
      tags TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE memory_embedding (
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL,
      projection_type TEXT NOT NULL DEFAULT 'native',
      embedding TEXT NOT NULL,
      dim INTEGER NOT NULL,
      UNIQUE(memory_id, embedding_provider, projection_type),
      FOREIGN KEY (memory_id) REFERENCES memory_item(id)
    );
  `);
}

function vecJson(seed: number, dim = 8): string {
  const a: number[] = [];
  for (let i = 0; i < dim; i++) {
    a.push(Math.sin(seed * 0.1 + i * 0.7));
  }
  return JSON.stringify(a);
}

function seedEmbeddings(
  db: Database.Database,
  count: number,
  provider = 'minilm',
  isDeleted = false
): void {
  const insMi = db.prepare(
    `INSERT INTO memory_item (id, type, content, importance, created_at, tags, is_deleted)
     VALUES (?, 'semantic', ?, 0.5, datetime('now'), '[]', ?)`
  );
  const insMe = db.prepare(
    `INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim)
     VALUES (?, ?, 'native', ?, 8)`
  );
  const delFlag = isDeleted ? 1 : 0;
  for (let i = 0; i < count; i++) {
    const id = `mem_test_${i}`;
    insMi.run(id, `content ${i}`, delFlag);
    insMe.run(id, provider, vecJson(i));
  }
}

describe('kMeans', () => {
  it('k=3, 9개 포인트: 길이 9, 클러스터 0~(k-1) 범위', () => {
    const pts = Array.from({ length: 9 }, (_, i) => [i * 0.1, i % 3]);
    const labels = kMeans(pts, 3, 100);
    expect(labels).toHaveLength(9);
    for (const c of labels) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(3);
    }
  });

  it('k > n 이면 effectiveK===n (반환 라벨은 0~(n-1))', () => {
    const n = 5;
    const pts = Array.from({ length: n }, (_, i) => [i, 0]);
    const labels = kMeans(pts, 10, 100);
    expect(labels).toHaveLength(n);
    const maxC = Math.max(...labels);
    expect(maxC).toBeLessThan(n);
  });
});

describe('buildEmbeddingMapResponse', () => {
  let db: Database.Database;

  beforeEach(() => {
    clearEmbeddingMapCacheForTests();
    umapFitAsyncMock.mockClear();
    umapFitMock.mockClear();
    db = new Database(':memory:');
    createMinimalSchema(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    clearEmbeddingMapCacheForTests();
    vi.useRealTimers();
  });

  it('NO_EMBEDDINGS: 해당 provider 임베딩 0건', async () => {
    try {
      await buildEmbeddingMapResponse(db, { provider: 'minilm', limit: 300, k: 6 });
      expect.fail('expected EmbeddingMapBuildError');
    } catch (e) {
      expect(e).toBeInstanceOf(EmbeddingMapBuildError);
      const err = e as EmbeddingMapBuildError;
      expect(err.code).toBe('NO_EMBEDDINGS');
      expect(err.payload.provider).toBe('minilm');
    }
  });

  it('NO_EMBEDDINGS: 활성 기억 없음(소프트 삭제만 있음)', async () => {
    seedEmbeddings(db, 12, 'minilm', true);
    try {
      await buildEmbeddingMapResponse(db, { provider: 'minilm', limit: 300, k: 6 });
      expect.fail('expected EmbeddingMapBuildError');
    } catch (e) {
      expect(e).toBeInstanceOf(EmbeddingMapBuildError);
      expect((e as EmbeddingMapBuildError).code).toBe('NO_EMBEDDINGS');
    }
  });

  it('INSUFFICIENT_DATA: 0 < count < 10', async () => {
    seedEmbeddings(db, 7, 'minilm');
    try {
      await buildEmbeddingMapResponse(db, { provider: 'minilm', limit: 300, k: 6 });
      expect.fail('expected EmbeddingMapBuildError');
    } catch (e) {
      expect(e).toBeInstanceOf(EmbeddingMapBuildError);
      const err = e as EmbeddingMapBuildError;
      expect(err.code).toBe('INSUFFICIENT_DATA');
      expect(err.payload.count).toBe(7);
    }
  });

  it('CORRUPTED_EMBEDDINGS: 행은 있으나 JSON 파싱 후 유효 벡터 0개', async () => {
    seedEmbeddings(db, 12, 'minilm');
    db.exec(`UPDATE memory_embedding SET embedding = '[]'`);
    try {
      await buildEmbeddingMapResponse(db, { provider: 'minilm', limit: 300, k: 6 });
      expect.fail('expected EmbeddingMapBuildError');
    } catch (e) {
      expect(e).toBeInstanceOf(EmbeddingMapBuildError);
      const err = e as EmbeddingMapBuildError;
      expect(err.code).toBe('CORRUPTED_EMBEDDINGS');
      expect(err.payload.count).toBe(12);
    }
  });

  it('성공 시 points/meta, k 자동 조정(requested_k 보존)', async () => {
    seedEmbeddings(db, 12, 'minilm');
    const res = await buildEmbeddingMapResponse(db, {
      provider: 'minilm',
      limit: 300,
      k: 20,
    });
    expect(res.points).toHaveLength(12);
    expect(res.meta.k).toBe(12);
    expect(res.meta.requested_k).toBe(20);
    expect(res.meta.cached).toBe(false);
    expect(res.meta.waited_for_in_flight).toBe(false);
    for (const p of res.points) {
      expect(p.cluster).toBeGreaterThanOrEqual(0);
      expect(p.cluster).toBeLessThan(12);
    }
  });

  it('캐시 히트: 동일 파라미터 재요청 시 cached true, computed_at 동일', async () => {
    seedEmbeddings(db, 11, 'minilm');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T10:00:00.000Z'));
    const a = await buildEmbeddingMapResponse(db, {
      provider: 'minilm',
      limit: 50,
      k: 4,
    });
    const t0 = a.meta.computed_at;
    const b = await buildEmbeddingMapResponse(db, {
      provider: 'minilm',
      limit: 50,
      k: 4,
    });
    expect(b.meta.cached).toBe(true);
    expect(b.meta.waited_for_in_flight).toBe(false);
    expect(b.meta.computed_at).toBe(t0);
  });

  it('동시 캐시 미스: in-flight 공유로 UMAP fitAsync 1회, 대기 측 waited_for_in_flight', async () => {
    seedEmbeddings(db, 12, 'minilm');
    umapFitAsyncMock.mockClear();
    const params = { provider: 'minilm' as const, limit: 300, k: 6 };
    const [a, b] = await Promise.all([
      buildEmbeddingMapResponse(db, params),
      buildEmbeddingMapResponse(db, params),
    ]);
    expect(umapFitAsyncMock).toHaveBeenCalledTimes(1);
    expect([a, b].filter(r => r.meta.waited_for_in_flight).length).toBe(1);
  });

  it('캐시 만료 후 재계산: cached false, 새 computed_at', async () => {
    seedEmbeddings(db, 11, 'minilm');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T10:00:00.000Z'));
    const a = await buildEmbeddingMapResponse(db, {
      provider: 'minilm',
      limit: 50,
      k: 4,
    });
    const t0 = a.meta.computed_at;
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const b = await buildEmbeddingMapResponse(db, {
      provider: 'minilm',
      limit: 50,
      k: 4,
    });
    expect(b.meta.cached).toBe(false);
    expect(b.meta.computed_at).not.toBe(t0);
  });
});

describe('GET /admin/embedding-map (라우터)', () => {
  let db: Database.Database;

  beforeEach(() => {
    clearEmbeddingMapCacheForTests();
    db = new Database(':memory:');
    createMinimalSchema(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    clearEmbeddingMapCacheForTests();
  });

  it('잘못된 provider → 400', async () => {
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/embedding-map?provider=bad');
      expect(res.statusCode).toBe(400);
      const j = JSON.parse(res.body) as { message?: string };
      expect(j.message).toMatch(/provider/);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('limit=0 → 400', async () => {
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/embedding-map?limit=0');
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('k=1 → 400', async () => {
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/embedding-map?k=1');
      expect(res.statusCode).toBe(400);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('NO_EMBEDDINGS 응답에 provider 포함 (count===0일 때 INSUFFICIENT_DATA 아님)', async () => {
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/embedding-map?provider=minilm');
      expect(res.statusCode).toBe(400);
      const j = JSON.parse(res.body) as { error?: string; provider?: string; count?: number };
      expect(j.error).toBe('임베딩 없음');
      expect(j.provider).toBe('minilm');
      expect(j.count).toBeUndefined();
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('CORRUPTED_EMBEDDINGS → 500 및 code 필드', async () => {
    seedEmbeddings(db, 12, 'minilm');
    db.exec(`UPDATE memory_embedding SET embedding = '[]'`);
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/embedding-map?provider=minilm');
      expect(res.statusCode).toBe(500);
      const j = JSON.parse(res.body) as { code?: string; rowCount?: number; provider?: string };
      expect(j.code).toBe('CORRUPTED_EMBEDDINGS');
      expect(j.rowCount).toBe(12);
      expect(j.provider).toBe('minilm');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('INSUFFICIENT_DATA 응답에 count 포함', async () => {
    seedEmbeddings(db, 5, 'minilm');
    const app = express();
    app.use('/admin', createAdminRouter(db, null));
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/embedding-map?provider=minilm');
      expect(res.statusCode).toBe(400);
      const j = JSON.parse(res.body) as { error?: string; count?: number };
      expect(j.error).toBe('기억 부족');
      expect(j.count).toBe(5);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
