import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEYS = ['REFLEXION_OBSERVATION_ONLY', 'SEARCH_REJECTION_GATE'] as const;

describe('setting override across a process restart (#1582)', () => {
  let dir: string;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memento-settings-'));
    for (const key of KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  async function boot(dbPath: string) {
    vi.resetModules();
    for (const key of KEYS) delete process.env[key];
    vi.stubEnv('BATCH_SCHEDULER_ENABLED', 'false');
    const core = await import('../../../index.js');
    const instance = await core.createMementoCore({ dbPath });
    return {
      core,
      instance,
      async stop() {
        await (instance.services.batchScheduler as { stop(): Promise<void> } | undefined)?.stop();
        core.closeDatabase(instance.db);
      },
    };
  }

  it('applies a stored override on the next start, with its source and restart status', async () => {
    const dbPath = join(dir, 'memento.db');

    const first = await boot(dbPath);
    expect(first.core.mementoConfig.reflexionObservationOnly).toBe(false);
    first.core.setRuntimeSettingOverride(first.instance.db, {
      key: 'REFLEXION_OBSERVATION_ONLY',
      value: 'true',
      actor: 'session:a',
      reason: null,
    });
    first.core.setRuntimeSettingOverride(first.instance.db, {
      key: 'SEARCH_REJECTION_GATE',
      value: 'ollama',
      actor: 'session:a',
      reason: null,
    });
    const beforeRestart = first.core.listRuntimeSettings(first.instance.db).settings;
    expect(beforeRestart.find((s) => s.key === 'SEARCH_REJECTION_GATE')?.pending_restart).toBe(true);
    await first.stop();

    const second = await boot(dbPath);
    expect(second.core.mementoConfig.reflexionObservationOnly).toBe(true);
    expect(second.core.mementoConfig.searchRejectionGate).toBe('ollama');
    const settings = new Map(second.core.listRuntimeSettings(second.instance.db).settings.map((s) => [s.key, s]));
    expect(settings.get('REFLEXION_OBSERVATION_ONLY')).toMatchObject({ value: 'true', source: 'override' });
    expect(settings.get('SEARCH_REJECTION_GATE')).toMatchObject({
      value: 'ollama',
      source: 'override',
      env_value: null,
      pending_restart: false,
    });

    second.core.revertRuntimeSettingOverride(second.instance.db, {
      key: 'SEARCH_REJECTION_GATE',
      actor: 'session:a',
      reason: null,
    });
    expect(second.core.mementoConfig.searchRejectionGate).toBe('off');
    expect(
      second.core.listRuntimeSettings(second.instance.db).settings.find((s) => s.key === 'SEARCH_REJECTION_GATE'),
    ).toMatchObject({ source: 'default', pending_restart: true });
    await second.stop();

    const third = await boot(dbPath);
    expect(third.core.mementoConfig.searchRejectionGate).toBe('off');
    expect(third.core.mementoConfig.reflexionObservationOnly).toBe(true);
    await third.stop();
  });
});
