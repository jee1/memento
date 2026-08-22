import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import http from 'http';
import { AuditHashChainMigration, AuditHashChainService } from '@memento/core';
import { createAuditRouter } from './audit.routes.js';

async function request(port: number, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, headers: { Connection: 'close' } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('audit.routes', () => {
  let db: Database.Database;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
    await new AuditHashChainMigration().up(db);
    const audit = new AuditHashChainService(db);
    audit.append({ actorId: 'key-1', transport: 'mcp_http', toolOrEndpoint: 'recall', action: 'read', resultStatus: 'success' });
    audit.append({ actorId: 'key-1', transport: 'http_admin', toolOrEndpoint: '/maintenance/reindex', action: 'admin', resultStatus: 'success' });

    const app = express();
    app.use(createAuditRouter(db));
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server port');
    port = address.port;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  });

  it('filters entries and exports a verified chain', async () => {
    const filtered = await request(port, '/entries?action=read&actorId=key-1');
    expect(filtered.status).toBe(200);
    expect(filtered.body).toMatchObject({ count: 1, entries: [{ action: 'read', transport: 'mcp_http' }] });

    const exported = await request(port, '/export?transport=http_admin');
    expect(exported.status).toBe(200);
    expect(exported.body).toMatchObject({ count: 1, verification: { valid: true, checked: 2 } });
  });

  it('rejects invalid filters', async () => {
    const response = await request(port, '/entries?action=other');
    expect(response).toMatchObject({ status: 400, body: { error: 'action is invalid' } });
  });

  it.each(['mcp_ws', 'rest'])('accepts the %s transport filter', async (transport) => {
    const response = await request(port, `/entries?transport=${transport}`);
    expect(response).toMatchObject({ status: 200, body: { count: 0, entries: [] } });
  });
});
