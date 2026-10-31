import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { mementoConfig } from '@memento/core';
import {
  closeSupersedeTestDb,
  createSupersedeTestDb,
  insertSeedMemory,
  isoDaysAgo,
} from '@memento/core/domains/memory/supersede/__tests__/supersede-test-support.js';
import { registerAdminMemorySupersedeRoutes } from './admin-memory-supersede.routes.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('admin supersede approval routes (#1551)', () => {
  let db: Database.Database;
  let server: Server;
  let baseUrl: string;
  let candidateId: string;
  let previousFlag: boolean;

  beforeEach(async () => {
    previousFlag = mementoConfig.supersedeApplyEnabled;
    db = await createSupersedeTestDb();
    insertSeedMemory(db, { id: 'mem_A', content: 'A 본문', createdAt: isoDaysAgo(20) });
    insertSeedMemory(db, { id: 'mem_B', content: 'B 본문', createdAt: isoDaysAgo(10) });
    candidateId = randomUUID();
    db.prepare(
      `INSERT INTO memory_supersede_candidate (
         id, old_memory_id, new_memory_id, owner_id, project_id, privacy_scope, memory_type, verdict,
         rationale, evidence_quote, old_content_sha256, new_content_sha256, provider, model,
         prompt_version, input_hash, llm_logical_request_id, created_at
       ) VALUES (?, 'mem_A', 'mem_B', NULL, NULL, 'private', 'semantic', 'confirmed', '근거', NULL, ?, ?,
                 'gemini', 'm', 'v', ?, NULL, '2026-11-01T00:00:00.000Z')`,
    ).run(candidateId, sha256('A 본문'), sha256('B 본문'), candidateId);

    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAdminMemorySupersedeRoutes(router, db);
    app.use('/admin', router);
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin`;
  });

  afterEach(async () => {
    mementoConfig.supersedeApplyEnabled = previousFlag;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    closeSupersedeTestDb(db);
  });

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify(body),
    });

  const pointer = () =>
    (db.prepare("SELECT superseded_by FROM memory_item WHERE id = 'mem_A'").get() as { superseded_by: string | null })
      .superseded_by;

  it('refuses both routes and writes nothing while SUPERSEDE_APPLY_ENABLED is off', async () => {
    mementoConfig.supersedeApplyEnabled = false;

    const apply = await post(`/memory/supersede-candidates/${candidateId}/apply`, { actor: 'operator' });
    const restore = await post('/memory/items/mem_A/supersede/restore', { actor: 'operator', expected_new_memory_id: 'mem_B' });

    expect([apply.status, restore.status]).toEqual([403, 403]);
    expect(await apply.json()).toMatchObject({ code: 'SUPERSEDE_APPLY_DISABLED' });
    expect(pointer()).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_supersede_event').get()).toEqual({ n: 0 });
  });

  it('applies an approved candidate, maps a stale restore to 409 and restores explicitly', async () => {
    mementoConfig.supersedeApplyEnabled = true;

    const applied = await post(`/memory/supersede-candidates/${candidateId}/apply`, { actor: 'operator', reason: '확인' });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ ok: true, outcome: { kind: 'applied' } });
    expect(pointer()).toBe('mem_B');

    const stale = await post('/memory/items/mem_A/supersede/restore', { actor: 'operator', expected_new_memory_id: 'mem_C' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'pointer_changed' });

    const restored = await post('/memory/items/mem_A/supersede/restore', { actor: 'operator', expected_new_memory_id: 'mem_B' });
    expect(restored.status).toBe(200);
    expect(pointer()).toBeNull();
  });

  it('validates input before touching the database', async () => {
    mementoConfig.supersedeApplyEnabled = true;

    expect((await post('/memory/supersede-candidates/not-a-uuid/apply', { actor: 'operator' })).status).toBe(400);
    expect((await post(`/memory/supersede-candidates/${candidateId}/apply`, {})).status).toBe(400);
    expect((await post('/memory/items/mem_A/supersede/restore', { actor: 'operator' })).status).toBe(400);
    expect((await post('/memory/items/A/supersede/restore', { actor: 'operator', expected_new_memory_id: 'mem_B' })).status).toBe(400);
    expect((await post(`/memory/supersede-candidates/${randomUUID()}/apply`, { actor: 'operator' })).status).toBe(404);
    expect(pointer()).toBeNull();
  });
});
