/**
 * GET /admin/memory/search — admin memory search (#1118 Phase 2)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import Database from 'better-sqlite3';
import { createAdminRouter } from '../admin.routes.js';
import type { ServerServices } from '../../bootstrap.js';

async function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
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
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('GET /admin/memory/search', () => {
  let db: Database.Database;
  let search: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new Database(':memory:');
    search = vi.fn();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks();
  });

  function makeServices(): ServerServices {
    return { hybridSearchEngine: { search } } as unknown as ServerServices;
  }

  function mountApp(
    database: Database.Database | null,
    services: ServerServices | null,
  ): express.Express {
    const app = express();
    app.use('/admin', createAdminRouter(database, services));
    return app;
  }

  it('200 mapping: maps search results to admin response shape', async () => {
    search.mockResolvedValue({
      items: [
        {
          id: 'mem_1',
          type: 'semantic',
          content: 'x'.repeat(300),
          created_at: '2026-10-01T00:00:00Z',
          finalScore: 0.81,
          textScore: 0.5,
          vectorScore: 0.9,
        },
      ],
      total_count: 1,
    });
    const app = mountApp(db, makeServices());
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/memory/search?q=hello');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        items: Array<Record<string, unknown>>;
        total_count: number;
        filters_applied: Record<string, unknown>;
      };
      expect(body.items[0]).toEqual({
        id: 'mem_1',
        type: 'semantic',
        content_preview: 'x'.repeat(200),
        similarity: 0.81,
        created_at: '2026-10-01T00:00:00Z',
      });
      expect(Object.keys(body.items[0]).sort()).toEqual(
        ['content_preview', 'created_at', 'id', 'similarity', 'type'].sort(),
      );
      expect(body.total_count).toBe(1);
      expect(body.filters_applied).toEqual({ q: 'hello', limit: 25 });
      expect(search).toHaveBeenCalledOnce();
      expect(search).toHaveBeenCalledWith(db, { query: 'hello', filters: {}, limit: 25 });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('filters: passes type, owner_id, and limit to search', async () => {
    search.mockResolvedValue({ items: [], total_count: 0 });
    const app = mountApp(db, makeServices());
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(
        port,
        '/admin/memory/search?q=hello&type=semantic&owner_id=agent-1&limit=50',
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { filters_applied: Record<string, unknown> };
      expect(search).toHaveBeenCalledWith(db, {
        query: 'hello',
        filters: { type: ['semantic'], owner_id: 'agent-1' },
        limit: 50,
      });
      expect(body.filters_applied).toEqual({
        q: 'hello',
        limit: 50,
        type: 'semantic',
        owner_id: 'agent-1',
      });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('trim: trims whitespace from q before search', async () => {
    search.mockResolvedValue({ items: [], total_count: 0 });
    const app = mountApp(db, makeServices());
    const { server, port } = await listen(app);
    try {
      await getAdmin(port, '/admin/memory/search?q=%20%20hi%20%20');
      expect(search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ query: 'hi' }),
      );
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it.each([
    ['', 'Invalid q query'],
    ['?q=%20%20', 'Invalid q query'],
    [`?q=${'a'.repeat(501)}`, 'Invalid q query'],
    ['?q=a&q=b', 'Invalid q query'],
    ['?q=a&type=core', 'Invalid type query'],
    ['?q=a&type=vault', 'Invalid type query'],
    ['?q=a&type=', 'Invalid type query'],
    ['?q=a&limit=10', 'Invalid limit query'],
    ['?q=a&limit=abc', 'Invalid limit query'],
    ['?q=a&owner_id=', 'Invalid owner_id query'],
    [`?q=a&owner_id=${'o'.repeat(201)}`, 'Invalid owner_id query'],
  ])('400 for invalid query %s', async (query, expectedError) => {
    search.mockResolvedValue({ items: [], total_count: 0 });
    const app = mountApp(db, makeServices());
    const { server, port } = await listen(app);
    try {
      const path = query ? `/admin/memory/search${query}` : '/admin/memory/search';
      const res = await getAdmin(port, path);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe(expectedError);
      expect(search).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('boundary accepted: q at max length returns 200', async () => {
    search.mockResolvedValue({ items: [], total_count: 0 });
    const app = mountApp(db, makeServices());
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, `/admin/memory/search?q=${'a'.repeat(500)}`);
      expect(res.statusCode).toBe(200);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('503 when services is null', async () => {
    const app = mountApp(db, null);
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/memory/search?q=a');
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'Search engine unavailable' });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('503 when db is null', async () => {
    const app = mountApp(null, makeServices());
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/memory/search?q=a');
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'Search engine unavailable' });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('500 when search rejects', async () => {
    search.mockRejectedValue(new Error('engine down'));
    const app = mountApp(db, makeServices());
    const { server, port } = await listen(app);
    try {
      const res = await getAdmin(port, '/admin/memory/search?q=a');
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body) as { error: string; message: string };
      expect(body.error).toBe('Failed to search memories');
      expect(body.message).toBe('engine down');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
