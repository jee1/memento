import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { mementoConfig } from '@memento/core';
import { SettingOverrideMigration } from '@memento/core/infrastructure/database/sqlite/migration/migrations/063-setting-override.js';
import { createSessionStore } from '../../auth/session-store.js';
import {
  createSessionAuthMiddleware,
  DASHBOARD_SESSION_COOKIE_NAME,
} from '../../middleware/session-auth.middleware.js';
import { registerAdminSettingsRoutes } from './admin-settings.routes.js';

const SAVED_ENV = ['REFLEXION_OBSERVATION_ONLY', 'SEARCH_REJECTION_GATE'] as const;

describe('admin settings routes (#1582)', () => {
  let db: Database.Database;
  let server: Server;
  let baseUrl: string;
  let sessionId: string;
  const savedEnv = new Map<string, string | undefined>();
  let savedObservationOnly: boolean;
  let savedGate: typeof mementoConfig.searchRejectionGate;
  let savedOpenaiKey: string | undefined;

  beforeEach(async () => {
    for (const key of SAVED_ENV) savedEnv.set(key, process.env[key]);
    delete process.env.REFLEXION_OBSERVATION_ONLY;
    delete process.env.SEARCH_REJECTION_GATE;
    savedObservationOnly = mementoConfig.reflexionObservationOnly;
    savedGate = mementoConfig.searchRejectionGate;
    savedOpenaiKey = mementoConfig.openaiApiKey;
    db = new Database(':memory:');
    await new SettingOverrideMigration().up(db);

    const store = createSessionStore({ idleTtlMs: 60_000, absoluteTtlMs: 60_000 });
    sessionId = store.create().sessionId;
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAdminSettingsRoutes(router, db);
    app.use('/admin', createSessionAuthMiddleware({ store, cookieName: DASHBOARD_SESSION_COOKIE_NAME }), router);
    app.use('/no-session', router);
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const key of SAVED_ENV) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    mementoConfig.reflexionObservationOnly = savedObservationOnly;
    mementoConfig.searchRejectionGate = savedGate;
    mementoConfig.openaiApiKey = savedOpenaiKey;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    db.close();
  });

  const call = (method: string, path: string, body?: unknown, prefix = '/admin') =>
    fetch(`${baseUrl}${prefix}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Connection: 'close',
        Cookie: `${DASHBOARD_SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it('lists settings with their source and read-only entries without secret values', async () => {
    mementoConfig.openaiApiKey = 'sk-route-secret';
    const response = await call('GET', '/settings');
    const text = await response.text();
    const body = JSON.parse(text) as {
      settings: Array<{ key: string; source: string }>;
      read_only: Array<{ key: string; secret: boolean; set: boolean; value: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(body.settings).toHaveLength(12);
    expect(body.read_only).toHaveLength(18);
    expect(body.read_only.find((entry) => entry.key === 'OPENAI_API_KEY')).toEqual({
      key: 'OPENAI_API_KEY',
      secret: true,
      set: true,
      value: null,
    });
    expect(text).not.toContain('sk-route-secret');
  });

  it('stores an override with the session as actor, ignoring a self-reported one', async () => {
    const sessionActor = `session:${createHash('sha256').update(sessionId, 'utf8').digest('hex').slice(0, 16)}`;

    const put = await call('PUT', '/settings/REFLEXION_OBSERVATION_ONLY', {
      value: 'true',
      reason: '관찰만',
      actor: 'spoofed',
    });

    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ key: 'REFLEXION_OBSERVATION_ONLY', value: 'true', source: 'override' });
    expect(mementoConfig.reflexionObservationOnly).toBe(true);
    expect(db.prepare('SELECT actor, reason FROM setting_override_event').all()).toEqual([
      { actor: sessionActor, reason: '관찰만' },
    ]);

    const repeat = await call('PUT', '/settings/REFLEXION_OBSERVATION_ONLY', { value: 'true', reason: '재시도' });
    expect(repeat.status).toBe(200);
    expect(count('setting_override_event')).toBe(1);

    const revert = await call('POST', '/settings/REFLEXION_OBSERVATION_ONLY/revert', { reason: '되돌림' });
    expect(revert.status).toBe(200);
    expect(await revert.json()).toMatchObject({ source: 'default', override: null });
    expect(mementoConfig.reflexionObservationOnly).toBe(false);
    expect(count('setting_override')).toBe(0);
    expect(count('setting_override_event')).toBe(2);
  });

  it('requires a reason for set and revert, treating blank text as missing', async () => {
    for (const reason of [undefined, null, '', '   \n\t']) {
      const put = await call('PUT', '/settings/REFLEXION_OBSERVATION_ONLY', { value: 'true', reason });
      expect([put.status, ((await put.json()) as { code: string }).code], JSON.stringify(reason)).toEqual([
        400,
        'REASON_REQUIRED',
      ]);
    }
    expect(mementoConfig.reflexionObservationOnly).toBe(false);
    expect(count('setting_override')).toBe(0);

    const tooLong = await call('PUT', '/settings/REFLEXION_OBSERVATION_ONLY', { value: 'true', reason: 'x'.repeat(1001) });
    expect([tooLong.status, ((await tooLong.json()) as { code: string }).code]).toEqual([400, 'INVALID_REASON']);

    await call('PUT', '/settings/REFLEXION_OBSERVATION_ONLY', { value: 'true', reason: '  켠다  ' });
    const blankRevert = await call('POST', '/settings/REFLEXION_OBSERVATION_ONLY/revert', { reason: '  ' });
    expect([blankRevert.status, ((await blankRevert.json()) as { code: string }).code]).toEqual([
      400,
      'REASON_REQUIRED',
    ]);
    expect(count('setting_override')).toBe(1);
    expect(mementoConfig.reflexionObservationOnly).toBe(true);
    expect(db.prepare('SELECT reason FROM setting_override_event').all()).toEqual([{ reason: '켠다' }]);
  });

  it('lists events newest first with a key filter and a validated limit', async () => {
    await call('PUT', '/settings/REFLEXION_OBSERVATION_ONLY', { value: 'true', reason: '하나' });
    await call('PUT', '/settings/MEMENTO_REMEMBER_DEDUP_MODE', { value: 'off', reason: '둘' });
    await call('POST', '/settings/REFLEXION_OBSERVATION_ONLY/revert', { reason: '셋' });
    type EventsBody = { events: Array<{ setting_key: string; action: string; reason: string; id: string }> };
    const events = async (query = '') => (await (await call('GET', `/settings/events${query}`)).json()) as EventsBody;

    expect((await events()).events.map((event) => event.reason)).toEqual(['셋', '둘', '하나']);
    expect((await events('?key=REFLEXION_OBSERVATION_ONLY')).events.map((event) => event.action)).toEqual([
      'revert',
      'set',
    ]);
    expect((await events('?limit=1')).events).toHaveLength(1);
    expect((await events()).events[0]).toEqual({
      id: expect.any(String),
      setting_key: 'REFLEXION_OBSERVATION_ONLY',
      action: 'revert',
      previous_value: 'true',
      new_value: null,
      actor: expect.stringMatching(/^session:/),
      reason: '셋',
      created_at: expect.any(String),
    });

    for (const limit of ['0', '201', '-1', '1.5', '1e1', 'abc', '', ' 5', '5abc']) {
      const response = await call('GET', `/settings/events?limit=${encodeURIComponent(limit)}`);
      expect([response.status, ((await response.json()) as { code: string }).code], limit).toEqual([
        400,
        'INVALID_LIMIT',
      ]);
    }
    expect((await call('GET', '/settings/events?limit=200')).status).toBe(200);
    expect((await call('GET', '/settings/events?limit=1&limit=2')).status).toBe(400);

    const unknown = await call('GET', '/settings/events?key=OPENAI_API_KEY');
    expect([unknown.status, ((await unknown.json()) as { code: string }).code]).toEqual([404, 'UNKNOWN_SETTING']);
    expect((await call('GET', '/settings/events?key=a&key=b')).status).toBe(400);
  });

  it('reports last_change and the description in the list', async () => {
    await call('PUT', '/settings/REFLEXION_OBSERVATION_ONLY', { value: 'true', reason: '켠다' });
    const body = (await (await call('GET', '/settings')).json()) as {
      settings: Array<{ key: string; description: string; last_change: { action: string; reason: string } | null }>;
    };
    const byKey = new Map(body.settings.map((setting) => [setting.key, setting]));
    expect(byKey.get('REFLEXION_OBSERVATION_ONLY')?.last_change).toMatchObject({ action: 'set', reason: '켠다' });
    expect(byKey.get('SUPERSEDE_APPLY_ENABLED')?.last_change).toBeNull();
    expect(body.settings.every((setting) => setting.description.length > 0)).toBe(true);
  });

  it('answers 404, 400 and 401 with stable codes and writes nothing', async () => {
    const unknown = await call('PUT', '/settings/NOT_A_SETTING', { value: 'x', reason: '사유' });
    const readOnly = await call('PUT', '/settings/OPENAI_API_KEY', { value: 'x', reason: '사유' });
    expect([unknown.status, readOnly.status]).toEqual([404, 404]);
    expect(await unknown.json()).toMatchObject({ code: 'UNKNOWN_SETTING' });
    expect(await readOnly.json()).toMatchObject({ code: 'UNKNOWN_SETTING' });
    expect(mementoConfig.openaiApiKey).not.toBe('x');

    const invalid = await call('PUT', '/settings/SEARCH_REJECTION_GATE', { value: 'on', reason: '사유' });
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { code: string; error: string };
    expect(invalidBody.code).toBe('INVALID_VALUE');
    expect(invalidBody.error).toContain('off, typesafe, ollama');
    expect((await call('PUT', '/settings/SEARCH_REJECTION_GATE', { reason: '사유' })).status).toBe(400);
    expect((await call('PUT', '/settings/SEARCH_REJECTION_GATE', { value: 'off', reason: 7 })).status).toBe(400);

    const noOverride = await call('POST', '/settings/SEARCH_REJECTION_GATE/revert', { reason: '사유' });
    expect(noOverride.status).toBe(404);
    expect(await noOverride.json()).toMatchObject({ code: 'NO_OVERRIDE' });

    const anonymous = await call('PUT', '/settings/SEARCH_REJECTION_GATE', { value: 'off', reason: '사유' }, '/no-session');
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ code: 'SESSION_REQUIRED' });
    expect((await call('POST', '/settings/SEARCH_REJECTION_GATE/revert', { reason: '사유' }, '/no-session')).status).toBe(401);

    expect(count('setting_override')).toBe(0);
    expect(count('setting_override_event')).toBe(0);
  });
});
