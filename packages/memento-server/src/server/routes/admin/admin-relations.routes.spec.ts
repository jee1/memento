import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { RelationEngineSchemaMigration } from '@memento/core/infrastructure/database/sqlite/migration/migrations/005-relation-engine-schema.js';
import { registerAdminRelationRoutes } from './admin-relations.routes.js';

describe('POST /admin/relations confidence', () => {
  let db: Database.Database;
  let server: Server;
  let url: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY, type TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0, superseded_by TEXT);
      CREATE TABLE memento_schema_version (version INTEGER PRIMARY KEY, applied_at TEXT);
      INSERT INTO memory_item (id, type) VALUES ('mem1', 'episodic'), ('mem2', 'episodic');
    `);
    new RelationEngineSchemaMigration().up(db);

    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAdminRelationRoutes(router, db);
    app.use('/admin', router);
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/relations`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
  });

  it.each([
    [0, 0],
    [0.8, 0.8],
    [undefined, 0.7]
  ])('confidence %s를 저장하고 응답한다', async (confidence, expectedConfidence) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify({ source_id: 'mem1', target_id: 'mem2', relation_type: 'CAUSES', confidence })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ confidence: expectedConfidence });
    expect(db.prepare('SELECT confidence FROM memory_relation').get()).toEqual({
      confidence: expectedConfidence
    });
  });

  it.each([-0.1, 1.5])('범위 밖 confidence %s를 저장하지 않는다', async (confidence) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify({ source_id: 'mem1', target_id: 'mem2', relation_type: 'CAUSES', confidence })
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: '관계 추가 실패' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_relation').get()).toEqual({ count: 0 });
  });
});
