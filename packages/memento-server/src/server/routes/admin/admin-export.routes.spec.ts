import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { registerAdminExportRoutes } from './admin-export.routes.js';
import type { ServerServices } from '../../bootstrap.js';

describe('GET /admin/export', () => {
  let db: Database.Database;
  let server: Server;
  let url: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY, type TEXT, content TEXT, importance REAL,
        privacy_scope TEXT, created_at TEXT, tags TEXT, source TEXT,
        task_goal TEXT, steps TEXT, workflow_name TEXT, skill_name TEXT,
        owner_id TEXT, project_id TEXT, is_deleted INTEGER DEFAULT 0
      );
      INSERT INTO memory_item (id, type, content, owner_id, created_at) VALUES
        ('episode', 'episodic', 'episode', 'agent-1', '2026-10-01'),
        ('fact', 'semantic', 'fact', 'agent-1', '2026-10-02'),
        ('other', 'semantic', 'other', 'agent-2', '2026-10-03');
    `);
    const app = express();
    app.set('query parser', 'extended');
    const router = express.Router();
    registerAdminExportRoutes(router, db, {} as ServerServices);
    app.use('/admin', router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/export?format=jsonl`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
  });

  it.each([
    'type=episodci', 'type=semantic,episodci', 'type=', 'type=semantic,',
    'type=semantic&type=invalid', 'type[value]=semantic', 'types=invalid',
    'limit=1e3', 'limit=2abc', 'limit=1.5', 'limit=', 'limit=0',
    'limit=10001', 'limit=1&limit=2', 'limit[value]=1',
  ])('rejects malformed filters: %s', async (query) => {
    const response = await fetch(`${url}&${query}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
  });

  it.each([
    ['', ['episode', 'fact', 'other']],
    ['type=episodic', ['episode']],
    ['types=episodic,semantic&owner_id=agent-1', ['episode', 'fact']],
    ['type=episodic&type=semantic&limit=2', ['episode', 'fact']],
    ['type=%20semantic%20&owner_id=agent-2&limit=1', ['other']],
    ['limit=10000', ['episode', 'fact', 'other']],
  ])('preserves valid filters: %s', async (query, ids) => {
    const response = await fetch(`${url}&${query}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const rows = (await response.text()).split('\n').map((line) => JSON.parse(line));
    expect(rows.map((row) => row.id)).toEqual(ids);
  });
});
