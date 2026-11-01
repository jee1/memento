/**
 * #1583 완료 기준: 설정 화면의 토글이 재기동 없이 같은 프로세스의 라우트 동작을 바꾼다.
 * 설정 라우트와 대체 승인 라우트를 한 앱에 붙이고 SUPERSEDE_APPLY_ENABLED 를 PUT 과 revert 로 오간다.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { mementoConfig } from '@memento/core';
import { SettingOverrideMigration } from '@memento/core/infrastructure/database/sqlite/migration/migrations/063-setting-override.js';
import {
  closeSupersedeTestDb,
  createSupersedeTestDb,
  insertSeedMemory,
  isoDaysAgo,
} from '@memento/core/domains/memory/supersede/__tests__/supersede-test-support.js';
import { createSessionStore } from '../../auth/session-store.js';
import {
  createSessionAuthMiddleware,
  DASHBOARD_SESSION_COOKIE_NAME,
} from '../../middleware/session-auth.middleware.js';
import { registerAdminMemorySupersedeRoutes } from './admin-memory-supersede.routes.js';
import { registerAdminSettingsRoutes } from './admin-settings.routes.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const KEY = 'SUPERSEDE_APPLY_ENABLED';

describe('settings toggle reaches the supersede approval route without a restart (#1583)', () => {
  let db: Database.Database;
  let server: Server;
  let baseUrl: string;
  let candidateId: string;
  let sessionId: string;
  let savedEnv: string | undefined;
  let savedFlag: boolean;

  beforeEach(async () => {
    savedEnv = process.env[KEY];
    savedFlag = mementoConfig.supersedeApplyEnabled;
    delete process.env[KEY];
    mementoConfig.supersedeApplyEnabled = false;

    db = await createSupersedeTestDb();
    await new SettingOverrideMigration().up(db);
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

    const store = createSessionStore({ idleTtlMs: 60_000, absoluteTtlMs: 60_000 });
    sessionId = store.create().sessionId;
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAdminSettingsRoutes(router, db);
    registerAdminMemorySupersedeRoutes(router, db);
    app.use('/admin', createSessionAuthMiddleware({ store, cookieName: DASHBOARD_SESSION_COOKIE_NAME }), router);
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin`;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env[KEY];
    else process.env[KEY] = savedEnv;
    mementoConfig.supersedeApplyEnabled = savedFlag;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    closeSupersedeTestDb(db);
  });

  const call = (method: string, path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Connection: 'close',
        Cookie: `${DASHBOARD_SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: JSON.stringify(body),
    });

  const apply = async (id = candidateId) => {
    const response = await call('POST', `/memory/supersede-candidates/${id}/apply`, { reason: '확인' });
    return { status: response.status, body: (await response.json()) as { code?: string } };
  };

  it('is refused, then allowed, then refused again as the setting is overridden and reverted', async () => {
    expect(await apply()).toEqual({ status: 403, body: expect.objectContaining({ code: 'SUPERSEDE_APPLY_DISABLED' }) });

    const on = await call('PUT', `/settings/${KEY}`, { value: 'true', reason: '승인 시작' });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ value: 'true', source: 'override', pending_restart: false });
    expect((await apply(randomUUID())).status).toBe(404);
    expect((await apply()).status).toBe(200);

    const off = await call('POST', `/settings/${KEY}/revert`, { reason: '승인 중단' });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ value: 'false', source: 'default', override: null });
    expect(await apply(randomUUID())).toEqual({
      status: 403,
      body: expect.objectContaining({ code: 'SUPERSEDE_APPLY_DISABLED' }),
    });

    const history = (await (await fetch(`${baseUrl}/settings/events?key=${KEY}`, {
      headers: { Cookie: `${DASHBOARD_SESSION_COOKIE_NAME}=${sessionId}`, Connection: 'close' },
    })).json()) as { events: Array<{ action: string; reason: string }> };
    expect(history.events.map((event) => [event.action, event.reason])).toEqual([
      ['revert', '승인 중단'],
      ['set', '승인 시작'],
    ]);
  });
});
