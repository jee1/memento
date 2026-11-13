/**
 * GET /admin/embedding-health 라우터
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createAdminRouter } from '../admin.routes.js';


function getAdminHandler(router: ReturnType<typeof createAdminRouter>, path: string): (req: any, res: any, next: (error?: unknown) => void) => unknown {
  const layer = (router as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.get
  );
  if (!layer?.route?.stack?.[0]?.handle) {
    throw new Error(`GET ${path} handler not found`);
  }
  return layer.route.stack[0].handle;
}

async function getAdmin(
  router: ReturnType<typeof createAdminRouter>,
  path: string
): Promise<{ statusCode: number; body: string }> {
  const url = new URL(path, 'http://localhost');
  const query = Object.fromEntries(url.searchParams.entries());
  const handler = getAdminHandler(router, url.pathname.replace('/admin', ''));

  let statusCode = 200;
  let body = '';
  const req = {
    method: 'GET',
    query,
    path: url.pathname,
    originalUrl: path,
    url: path,
  };
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = JSON.stringify(payload);
      return this;
    },
  };

  await Promise.resolve(
    handler(req, res, (error?: unknown) => {
      if (error) {
        throw error;
      }
    })
  );

  return { statusCode, body };
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
      is_deleted INTEGER NOT NULL DEFAULT 0,
      project_id TEXT,
      owner_id TEXT,
      deleted_at TEXT
    );
    CREATE TABLE memory_embedding (
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL,
      projection_type TEXT NOT NULL DEFAULT 'native',
      embedding BLOB NOT NULL,
      dim INTEGER NOT NULL,
      dimensions INTEGER,
      model TEXT,
      UNIQUE(memory_id, embedding_provider, projection_type),
      FOREIGN KEY (memory_id) REFERENCES memory_item(id)
    );
  `);
}

describe('GET /admin/embedding-health (라우터)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createMinimalSchema(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  it('#896: 임베딩이 없어도 health 가 응답한다', async () => {
    db.prepare(
      `INSERT INTO memory_item (id, type, content, importance, is_deleted) VALUES ('mem_missing', 'semantic', 'missing', 0.5, 0)`,
    ).run();
    const router = createAdminRouter(db, null);
    const res = await getAdmin(router, '/admin/embedding-health?provider=minilm');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      diagnostics: {
        memoryCount: 1,
        validEmbeddingCount: 0,
        coverage: 0,
        missingEmbeddingCount: 1,
      },
    });
  });

  it('#896: health problem drilldown returns affected memory metadata', async () => {
    db.prepare(
      `INSERT INTO memory_item (id, type, content, importance, owner_id, project_id, is_deleted)
       VALUES ('mem_missing', 'semantic', 'missing', 0.5, 'agent-a', 'project-a', 0)`,
    ).run();
    const router = createAdminRouter(db, null);
    const res = await getAdmin(router, '/admin/embedding-health?provider=minilm&problem=missing_embedding');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      problem: 'missing_embedding',
      total: 1,
      memories: [{ id: 'mem_missing', type: 'semantic', ownerId: 'agent-a', projectId: 'project-a' }],
    });
  });
});
