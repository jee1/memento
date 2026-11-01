import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMementoCore,
  getBatchScheduler,
  mementoConfig,
  shutdownServices,
  closeDatabase,
  type MementoCoreInstance,
} from '@memento/core';
import { isClusterJudgeEnabled } from '@memento/core/shared/config/cluster-judge-config.js';
import { SettingOverrideMigration } from '@memento/core/infrastructure/database/sqlite/migration/migrations/063-setting-override.js';
import { createSessionStore } from '../../auth/session-store.js';
import {
  createSessionAuthMiddleware,
  DASHBOARD_SESSION_COOKIE_NAME,
} from '../../middleware/session-auth.middleware.js';
import { registerAdminSettingsRoutes } from './admin-settings.routes.js';

describe('immediate runtime settings without process restart (#1599)', () => {
  let dir: string;
  let core: MementoCoreInstance;
  let server: Server;
  let baseUrl: string;
  let sessionId: string;
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'memento-settings-1599-'));
    for (const key of ['SEARCH_REJECTION_GATE', 'CONSOLIDATION_JUDGE', 'SUPERSEDE_CANDIDATE_SCAN_ENABLED']) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    vi.stubEnv('BATCH_SCHEDULER_ENABLED', 'false');

    core = await createMementoCore({ dbPath: join(dir, 'memento.db') });
    await new SettingOverrideMigration().up(core.db);

    const store = createSessionStore({ idleTtlMs: 60_000, absoluteTtlMs: 60_000 });
    sessionId = store.create().sessionId;
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAdminSettingsRoutes(router, core.db);
    app.use('/admin', createSessionAuthMiddleware({ store, cookieName: DASHBOARD_SESSION_COOKIE_NAME }), router);
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await shutdownServices(core.services);
    closeDatabase(core.db);
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
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

  it('reapplies search rejection gate, consolidation judge, and supersede scan schedule on set and revert', async () => {
    const setSpy = vi.spyOn(core.services.hybridSearchEngine, 'setRejectionGate');
    const scheduler = getBatchScheduler();
    const updateSpy = vi.spyOn(scheduler, 'updateConfig');

    const gateOn = await call('PUT', '/settings/SEARCH_REJECTION_GATE', { value: 'ollama', reason: '켠다' });
    expect(gateOn.status).toBe(200);
    expect(await gateOn.json()).toMatchObject({ pending_restart: false, value: 'ollama' });
    expect(mementoConfig.searchRejectionGate).toBe('ollama');
    expect(setSpy).toHaveBeenCalled();

    const judgeOn = await call('PUT', '/settings/CONSOLIDATION_JUDGE', { value: 'typesafe', reason: '판정' });
    expect(judgeOn.status).toBe(200);
    expect(await judgeOn.json()).toMatchObject({ pending_restart: false, value: 'typesafe' });
    expect(isClusterJudgeEnabled()).toBe(true);

    const scanOn = await call('PUT', '/settings/SUPERSEDE_CANDIDATE_SCAN_ENABLED', { value: 'true', reason: '스캔' });
    expect(scanOn.status).toBe(200);
    expect(await scanOn.json()).toMatchObject({ pending_restart: false, value: 'true' });
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ supersedeCandidateScanEnabled: true }));

    const gateOff = await call('POST', '/settings/SEARCH_REJECTION_GATE/revert', { reason: '끈다' });
    expect(gateOff.status).toBe(200);
    expect(await gateOff.json()).toMatchObject({ value: 'off', pending_restart: false });
    expect(mementoConfig.searchRejectionGate).toBe('off');

    const judgeOff = await call('POST', '/settings/CONSOLIDATION_JUDGE/revert', { reason: '끈다' });
    expect(judgeOff.status).toBe(200);
    expect(isClusterJudgeEnabled()).toBe(false);

    const scanOff = await call('POST', '/settings/SUPERSEDE_CANDIDATE_SCAN_ENABLED/revert', { reason: '끈다' });
    expect(scanOff.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ supersedeCandidateScanEnabled: false }));
  });
});
