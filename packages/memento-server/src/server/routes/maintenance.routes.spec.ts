import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import http from 'http';
import { createMaintenanceRouter, resetMaintenanceJobsForTests } from './maintenance.routes.js';
import type { ServerServices } from '../bootstrap.js';

async function request(port: number, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers: {
      Connection: 'close', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('maintenance.routes', () => {
  let db: Database.Database;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'semantic', owner_id TEXT, is_deleted INTEGER DEFAULT 0);
      CREATE TABLE memory_embedding (
        memory_id TEXT, embedding_provider TEXT, projection_type TEXT, embedding TEXT, dim INTEGER,
        dimensions INTEGER, model TEXT, created_by TEXT, created_at TEXT,
        UNIQUE(memory_id, embedding_provider, projection_type)
      );
      CREATE TABLE memory_relation (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, target_id TEXT NOT NULL, relation_type TEXT NOT NULL
      );
      INSERT INTO memory_item (id, content, owner_id) VALUES ('memory-1', 'reindex me', 'owner-1');
      INSERT INTO memory_item (id, content, type, owner_id) VALUES ('endpoint-1', 'relation endpoint', 'semantic', 'owner-2');
      INSERT INTO memory_item (id, content, type, owner_id) VALUES ('endpoint-2', 'relation endpoint 2', 'semantic', 'owner-2');
      INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES ('endpoint-1', 'endpoint-2', 'extracted_from');
    `);
    const app = express();
    app.use(express.json());
    app.use(createMaintenanceRouter(db, {
      embeddingService: {
        isAvailable: () => true,
        createAndStoreEmbedding: async (_db, memoryId) => {
          db.prepare("INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions) VALUES (?, 'minilm', 'native', '[]', 384, 384)").run(memoryId);
          return { embedding: Array.from({ length: 384 }, () => 0.1), provider: 'minilm' };
        },
      },
    } as unknown as ServerServices));
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server port');
    port = address.port;
  });

  afterEach(async () => {
    resetMaintenanceJobsForTests();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  });

  it('queues reindex work and exposes its completed diagnostics', async () => {
    const accepted = await request(port, 'POST', '/reindex', { provider: 'minilm', ownerId: 'owner-1', batchSize: 10 });
    expect(accepted.status).toBe(202);
    expect(accepted.body.status).toBe('queued');
    const jobId = accepted.body.jobId as string;

    let status = await request(port, 'GET', `/reindex/${jobId}`);
    for (let attempt = 0; attempt < 20 && status.body.status !== 'completed'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      status = await request(port, 'GET', `/reindex/${jobId}`);
    }
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('completed');
    expect(status.body.result).toMatchObject({ storedCount: 1, missingEmbeddingCount: 0 });
  });

  it('#722: lightweight provider는 tfidf로 정규화되어 결과에 반영되어야 함', async () => {
    const accepted = await request(port, 'POST', '/reindex', { provider: 'lightweight', ownerId: 'owner-1', batchSize: 10 });
    expect(accepted.status).toBe(202);
    const jobId = accepted.body.jobId as string;

    let status = await request(port, 'GET', `/reindex/${jobId}`);
    for (let attempt = 0; attempt < 20 && status.body.status !== 'completed'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      status = await request(port, 'GET', `/reindex/${jobId}`);
    }
    expect(status.body.status).toBe('completed');
    expect(status.body.result).toMatchObject({ provider: 'tfidf' });
  });

  it('rejects an unknown provider before queuing a job', async () => {
    const response = await request(port, 'POST', '/reindex', { provider: 'other' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('provider must be one of');
  });

  it('#710: queues relation-endpoint backfill work and exposes its completed result', async () => {
    const accepted = await request(port, 'POST', '/backfill-relation-endpoints', { provider: 'minilm', limit: 10 });
    expect(accepted.status).toBe(202);
    expect(accepted.body.status).toBe('queued');
    const jobId = accepted.body.jobId as string;

    let status = await request(port, 'GET', `/backfill-relation-endpoints/${jobId}`);
    for (let attempt = 0; attempt < 20 && status.body.status !== 'completed'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      status = await request(port, 'GET', `/backfill-relation-endpoints/${jobId}`);
    }
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('completed');
    expect(status.body.result).toMatchObject({ candidateCount: 2, storedCount: 2, failedCount: 0 });
  });

  it('rejects an unknown provider before queuing a backfill job', async () => {
    const response = await request(port, 'POST', '/backfill-relation-endpoints', { provider: 'other' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('provider must be one of');
  });

  it('returns 404 for an unknown backfill job id', async () => {
    const response = await request(port, 'GET', '/backfill-relation-endpoints/unknown-job');
    expect(response.status).toBe(404);
  });
});
