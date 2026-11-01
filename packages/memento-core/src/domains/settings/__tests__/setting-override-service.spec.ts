import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingOverrideMigration } from '../../../infrastructure/database/sqlite/migration/migrations/063-setting-override.js';

const ENV_KEYS = [
  'SEARCH_REJECTION_GATE',
  'SEARCH_REJECTION_GATE_THRESHOLD',
  'SEARCH_REJECTION_GATE_ON_ERROR',
  'CONSOLIDATION_JUDGE',
  'CONSOLIDATION_JUDGE_THRESHOLD',
  'LLM_PROVIDER_RELATION_EXTRACTION',
  'LLM_MODEL_RELATION_EXTRACTION',
  'SUPERSEDE_CANDIDATE_SCAN_ENABLED',
  'SUPERSEDE_APPLY_ENABLED',
  'REFLEXION_OBSERVATION_ONLY',
  'PROCEDURAL_EXTRACTION_STRATEGY',
  'MEMENTO_REMEMBER_DEDUP_MODE',
  'OPENAI_API_KEY',
  'LLM_PROVIDER',
] as const;

const savedEnv = new Map<string, string | undefined>();

async function load() {
  vi.resetModules();
  const [{ mementoConfig }, service, registry] = await Promise.all([
    import('../../../shared/config/index.js'),
    import('../setting-override-service.js'),
    import('../settings-registry.js'),
  ]);
  return { mementoConfig, ...service, ...registry };
}

async function openDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  await new SettingOverrideMigration().up(db);
  return db;
}

const rows = (db: Database.Database) => db.prepare('SELECT * FROM setting_override ORDER BY key').all();
const events = (db: Database.Database) => db.prepare('SELECT * FROM setting_override_event ORDER BY rowid').all();

describe('runtime setting override (#1582)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    db = await openDb();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    db.close();
    vi.restoreAllMocks();
  });

  it('rejects keys outside the registry, including read-only and inherited object keys', async () => {
    const { setRuntimeSettingOverride } = await load();
    for (const key of ['NOT_A_SETTING', 'OPENAI_API_KEY', 'LLM_PROVIDER', 'constructor', '__proto__']) {
      expect(
        setRuntimeSettingOverride(db, { key, value: 'x', actor: 'session:a', reason: null }),
        key,
      ).toMatchObject({ ok: false, code: 'UNKNOWN_SETTING' });
    }
    expect(rows(db)).toEqual([]);
    expect(events(db)).toEqual([]);
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it.each([
    ['SEARCH_REJECTION_GATE', 'on'],
    ['SEARCH_REJECTION_GATE', 'OFF'],
    ['SEARCH_REJECTION_GATE_THRESHOLD', '1.5'],
    ['SEARCH_REJECTION_GATE_THRESHOLD', '-0.1'],
    ['SEARCH_REJECTION_GATE_THRESHOLD', '0x1'],
    ['SEARCH_REJECTION_GATE_THRESHOLD', ''],
    ['CONSOLIDATION_JUDGE_THRESHOLD', '0'],
    ['CONSOLIDATION_JUDGE_THRESHOLD', '1.01'],
    ['LLM_PROVIDER_RELATION_EXTRACTION', 'claude'],
    ['LLM_MODEL_RELATION_EXTRACTION', 'bad model!'],
    ['SUPERSEDE_APPLY_ENABLED', 'yes'],
    ['REFLEXION_OBSERVATION_ONLY', '1'],
    ['PROCEDURAL_EXTRACTION_STRATEGY', 'llm'],
    ['MEMENTO_REMEMBER_DEDUP_MODE', 5],
  ])('rejects %s = %j before touching the database or the process', async (key, value) => {
    const { setRuntimeSettingOverride, mementoConfig } = await load();
    const before = structuredClone(mementoConfig);

    const result = setRuntimeSettingOverride(db, { key, value, actor: 'session:a', reason: null });

    expect(result).toMatchObject({ ok: false, code: 'INVALID_VALUE' });
    expect(rows(db)).toEqual([]);
    expect(events(db)).toEqual([]);
    expect(process.env[key]).toBeUndefined();
    expect(mementoConfig).toEqual(before);
  });

  it('accepts the inclusive and exclusive range edges', async () => {
    const { setRuntimeSettingOverride } = await load();
    const set = (key: string, value: string) =>
      setRuntimeSettingOverride(db, { key, value, actor: 'session:a', reason: null });
    expect(set('SEARCH_REJECTION_GATE_THRESHOLD', '0')).toMatchObject({ ok: true });
    expect(set('SEARCH_REJECTION_GATE_THRESHOLD', '1')).toMatchObject({ ok: true });
    expect(set('CONSOLIDATION_JUDGE_THRESHOLD', '1')).toMatchObject({ ok: true });
    expect(set('CONSOLIDATION_JUDGE_THRESHOLD', '0.01')).toMatchObject({ ok: true });
  });

  it('offers every LLM_PROVIDER_RELATION_EXTRACTION value the config parser accepts', async () => {
    const { SETTING_REGISTRY } = await load();
    const { parseRelationExtractionOverride } = await import('../../../shared/config/relation-extraction-seat.js');
    for (const value of SETTING_REGISTRY.get('LLM_PROVIDER_RELATION_EXTRACTION')!.allowed!) {
      expect(parseRelationExtractionOverride(value).kind, value).not.toBe('invalid');
    }
  });

  it('stores the override with its audit event and changes mementoConfig at once', async () => {
    const { setRuntimeSettingOverride, mementoConfig } = await load();
    const set = (key: string, value: string, reason: string | null = null) =>
      setRuntimeSettingOverride(db, { key, value, actor: 'session:abc', reason });

    const first = set('REFLEXION_OBSERVATION_ONLY', 'true', '관찰만 하기로 함');
    expect(first).toMatchObject({
      ok: true,
      setting: { key: 'REFLEXION_OBSERVATION_ONLY', value: 'true', source: 'override', pending_restart: false },
    });
    expect(mementoConfig.reflexionObservationOnly).toBe(true);
    expect(rows(db)).toEqual([
      { key: 'REFLEXION_OBSERVATION_ONLY', value: 'true', updated_at: expect.any(String), updated_by: 'session:abc' },
    ]);
    expect(events(db)).toEqual([
      expect.objectContaining({
        setting_key: 'REFLEXION_OBSERVATION_ONLY',
        action: 'set',
        previous_value: null,
        new_value: 'true',
        actor: 'session:abc',
        reason: '관찰만 하기로 함',
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    ]);

    set('REFLEXION_OBSERVATION_ONLY', 'false');
    expect(mementoConfig.reflexionObservationOnly).toBe(false);
    expect(events(db).at(-1)).toMatchObject({ previous_value: 'true', new_value: 'false', reason: null });

    set('SEARCH_REJECTION_GATE_THRESHOLD', '0.7');
    set('SEARCH_REJECTION_GATE_ON_ERROR', 'closed');
    set('PROCEDURAL_EXTRACTION_STRATEGY', 'llm_first');
    set('MEMENTO_REMEMBER_DEDUP_MODE', 'strict');
    set('SUPERSEDE_APPLY_ENABLED', 'true');
    set('LLM_MODEL_RELATION_EXTRACTION', 'gpt-5.1-mini');
    expect(mementoConfig).toMatchObject({
      searchRejectionGateThreshold: 0.7,
      searchRejectionGateOnError: 'closed',
      proceduralExtractionStrategy: 'llm_first',
      rememberDedupMode: 'strict',
      supersedeApplyEnabled: true,
      llmModelOverrides: { relation_extraction: 'gpt-5.1-mini' },
    });
  });

  it('moves both relation extraction fields together', async () => {
    const { setRuntimeSettingOverride, revertRuntimeSettingOverride, mementoConfig } = await load();
    const set = (value: string) =>
      setRuntimeSettingOverride(db, { key: 'LLM_PROVIDER_RELATION_EXTRACTION', value, actor: 'session:a', reason: null });

    set('ollama');
    expect(mementoConfig.relationExtractionOverride).toEqual({ kind: 'chat', provider: 'ollama' });
    expect(mementoConfig.llmProviderOverrides.relation_extraction).toBe('ollama');

    set('jev');
    expect(mementoConfig.relationExtractionOverride).toEqual({ kind: 'jev' });
    expect(mementoConfig.llmProviderOverrides.relation_extraction).toBeUndefined();

    revertRuntimeSettingOverride(db, { key: 'LLM_PROVIDER_RELATION_EXTRACTION', actor: 'session:a', reason: null });
    expect(mementoConfig.relationExtractionOverride).toEqual({ kind: 'unset' });
    expect(mementoConfig.llmProviderOverrides.relation_extraction).toBeUndefined();
  });

  it('leaves no event when the same value is set again', async () => {
    const { setRuntimeSettingOverride } = await load();
    const set = () =>
      setRuntimeSettingOverride(db, { key: 'MEMENTO_REMEMBER_DEDUP_MODE', value: 'off', actor: 'session:a', reason: null });
    set();
    const again = set();
    expect(again).toMatchObject({ ok: true, setting: { value: 'off', source: 'override' } });
    expect(events(db)).toHaveLength(1);
  });

  it('revert deletes the row, leaves an event and restores the startup value', async () => {
    process.env.MEMENTO_REMEMBER_DEDUP_MODE = 'strict';
    const { setRuntimeSettingOverride, revertRuntimeSettingOverride, mementoConfig } = await load();
    expect(mementoConfig.rememberDedupMode).toBe('strict');

    setRuntimeSettingOverride(db, { key: 'MEMENTO_REMEMBER_DEDUP_MODE', value: 'off', actor: 'session:a', reason: null });
    setRuntimeSettingOverride(db, { key: 'REFLEXION_OBSERVATION_ONLY', value: 'true', actor: 'session:a', reason: null });
    expect(mementoConfig.rememberDedupMode).toBe('off');

    const reverted = revertRuntimeSettingOverride(db, {
      key: 'MEMENTO_REMEMBER_DEDUP_MODE',
      actor: 'session:b',
      reason: '되돌림',
    });
    expect(reverted).toMatchObject({ ok: true, setting: { value: 'strict', source: 'env', override: null } });
    expect(mementoConfig.rememberDedupMode).toBe('strict');
    expect(process.env.MEMENTO_REMEMBER_DEDUP_MODE).toBe('strict');
    expect(rows(db)).toEqual([expect.objectContaining({ key: 'REFLEXION_OBSERVATION_ONLY' })]);
    expect(events(db).at(-1)).toMatchObject({
      setting_key: 'MEMENTO_REMEMBER_DEDUP_MODE',
      action: 'revert',
      previous_value: 'off',
      new_value: null,
      actor: 'session:b',
      reason: '되돌림',
    });

    revertRuntimeSettingOverride(db, { key: 'REFLEXION_OBSERVATION_ONLY', actor: 'session:b', reason: null });
    expect('REFLEXION_OBSERVATION_ONLY' in process.env).toBe(false);
    expect(mementoConfig.reflexionObservationOnly).toBe(false);
  });

  it('reports NO_OVERRIDE without writing an event', async () => {
    const { revertRuntimeSettingOverride } = await load();
    expect(
      revertRuntimeSettingOverride(db, { key: 'REFLEXION_OBSERVATION_ONLY', actor: 'session:a', reason: null }),
    ).toMatchObject({ ok: false, code: 'NO_OVERRIDE' });
    expect(
      revertRuntimeSettingOverride(db, { key: 'NOT_A_SETTING', actor: 'session:a', reason: null }),
    ).toMatchObject({ ok: false, code: 'UNKNOWN_SETTING' });
    expect(events(db)).toEqual([]);
  });

  it('flags a restart-only key as pending until it is reverted', async () => {
    const { setRuntimeSettingOverride, revertRuntimeSettingOverride, listRuntimeSettings } = await load();
    const pending = () =>
      Object.fromEntries(listRuntimeSettings(db).settings.map((s) => [s.key, s.pending_restart]));

    expect(Object.values(pending()).some(Boolean)).toBe(false);

    setRuntimeSettingOverride(db, { key: 'SEARCH_REJECTION_GATE', value: 'typesafe', actor: 'session:a', reason: null });
    setRuntimeSettingOverride(db, { key: 'MEMENTO_REMEMBER_DEDUP_MODE', value: 'off', actor: 'session:a', reason: null });
    expect(pending()).toMatchObject({ SEARCH_REJECTION_GATE: true, MEMENTO_REMEMBER_DEDUP_MODE: false });

    revertRuntimeSettingOverride(db, { key: 'SEARCH_REJECTION_GATE', actor: 'session:a', reason: null });
    expect(pending().SEARCH_REJECTION_GATE).toBe(false);
  });

  it('resolves override > env > default and says which one won', async () => {
    process.env.SEARCH_REJECTION_GATE_ON_ERROR = 'closed';
    process.env.REFLEXION_OBSERVATION_ONLY = '   ';
    const { setRuntimeSettingOverride, listRuntimeSettings, SETTING_REGISTRY } = await load();
    const byKey = () => new Map(listRuntimeSettings(db).settings.map((s) => [s.key, s]));

    expect(byKey().get('SEARCH_REJECTION_GATE_ON_ERROR')).toMatchObject({
      value: 'closed',
      source: 'env',
      env_value: 'closed',
      default_value: 'open',
      override: null,
    });
    expect(byKey().get('REFLEXION_OBSERVATION_ONLY')).toMatchObject({
      value: 'false',
      source: 'default',
      env_value: null,
    });
    expect(byKey().get('LLM_PROVIDER_RELATION_EXTRACTION')).toMatchObject({ value: null, source: 'default' });

    setRuntimeSettingOverride(db, {
      key: 'SEARCH_REJECTION_GATE_ON_ERROR',
      value: 'open',
      actor: 'session:a',
      reason: null,
    });
    expect(byKey().get('SEARCH_REJECTION_GATE_ON_ERROR')).toMatchObject({
      value: 'open',
      source: 'override',
      env_value: 'closed',
      override: { value: 'open', updated_by: 'session:a', updated_at: expect.any(String) },
    });

    const gate = byKey().get('SEARCH_REJECTION_GATE_THRESHOLD')!;
    expect(gate).toMatchObject({ kind: 'number', range: { min: 0, max: 1 }, apply: 'immediate', risk: 'medium' });
    expect(gate.default_value).toBe(String(SETTING_REGISTRY.get('SEARCH_REJECTION_GATE_THRESHOLD')!.defaultValue));
    expect(byKey().get('SEARCH_REJECTION_GATE')).toMatchObject({ allowed: ['off', 'typesafe', 'ollama'], apply: 'restart' });
  });

  it('keeps mementoConfig identical when the override table is empty', async () => {
    process.env.SEARCH_REJECTION_GATE_THRESHOLD = '0.55';
    const { applyStoredSettingOverrides, mementoConfig } = await load();
    const before = structuredClone(mementoConfig);

    applyStoredSettingOverrides(db);

    expect(mementoConfig).toEqual(before);
  });

  it('applies stored rows at startup and skips rows the registry would refuse', async () => {
    const { applyStoredSettingOverrides, listRuntimeSettings, mementoConfig } = await load();
    const insert = db.prepare(
      "INSERT INTO setting_override (key, value, updated_at, updated_by) VALUES (?, ?, '2026-11-01T00:00:00.000Z', 'session:a')",
    );
    insert.run('SEARCH_REJECTION_GATE', 'ollama');
    insert.run('REFLEXION_OBSERVATION_ONLY', 'true');
    insert.run('MEMENTO_REMEMBER_DEDUP_MODE', 'bogus');
    insert.run('REMOVED_SETTING', 'x');
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    applyStoredSettingOverrides(db);

    expect(mementoConfig.searchRejectionGate).toBe('ollama');
    expect(mementoConfig.reflexionObservationOnly).toBe(true);
    expect(mementoConfig.rememberDedupMode).toBe('warn');
    expect(process.env.MEMENTO_REMEMBER_DEDUP_MODE).toBeUndefined();
    const messages = warn.mock.calls.map(([chunk]) => String(chunk)).filter((line) => line.includes('[CONFIG WARN]'));
    expect(messages).toHaveLength(2);
    const settings = new Map(listRuntimeSettings(db).settings.map((s) => [s.key, s]));
    expect(settings.get('SEARCH_REJECTION_GATE')).toMatchObject({ source: 'override', pending_restart: false });
  });

  it('lists read-only settings and never returns a secret value', async () => {
    process.env.OPENAI_API_KEY = 'sk-super-secret';
    process.env.LLM_PROVIDER = 'gemini';
    const { listRuntimeSettings } = await load();
    const { read_only: readOnly } = listRuntimeSettings(db);

    expect(readOnly).toHaveLength(18);
    expect(readOnly.find((r) => r.key === 'OPENAI_API_KEY')).toEqual({
      key: 'OPENAI_API_KEY',
      secret: true,
      set: true,
      value: null,
    });
    expect(readOnly.find((r) => r.key === 'LLM_PROVIDER')).toEqual({
      key: 'LLM_PROVIDER',
      secret: false,
      set: true,
      value: 'gemini',
    });
    expect(JSON.stringify(listRuntimeSettings(db))).not.toContain('sk-super-secret');
    for (const entry of readOnly.filter((r) => r.secret)) {
      expect(entry.value).toBeNull();
    }
  });
});
