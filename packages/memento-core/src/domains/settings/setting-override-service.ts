/**
 * #1582: 설정 override 저장소와 실효값 해석.
 *
 * 실효값은 override > 기동 때 env(빈 문자열은 미설정) > 코드 기본값 순이다.
 * 기동 때 env 는 process.env 와 함께 프로세스 전역이라 키마다 한 번만 기억하고, 모듈 전역에 둔다.
 * set 과 revert 는 override 행과 감사 event 를 한 트랜잭션에 쓰고, 커밋 뒤에 process.env 와 mementoConfig 를 바꾼다.
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { mementoConfig } from '../../shared/config/index.js';
import {
  normalizeSettingValue,
  READ_ONLY_SETTINGS,
  SETTING_REGISTRY,
  type RuntimeSettingDefinition,
} from './settings-registry.js';

interface OverrideRow {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string;
}

export interface RuntimeSettingView {
  key: string;
  kind: RuntimeSettingDefinition['kind'];
  allowed?: readonly string[];
  range?: RuntimeSettingDefinition['range'];
  apply: RuntimeSettingDefinition['apply'];
  risk: RuntimeSettingDefinition['risk'];
  value: string | null;
  source: 'override' | 'env' | 'default';
  default_value: string | null;
  default_source: string;
  env_value: string | null;
  override: { value: string; updated_at: string; updated_by: string } | null;
  pending_restart: boolean;
}

export interface ReadOnlySettingView {
  key: string;
  secret: boolean;
  set: boolean;
  value: string | null;
}

export type SettingChangeResult =
  | { ok: true; setting: RuntimeSettingView }
  | { ok: false; code: 'UNKNOWN_SETTING' | 'INVALID_VALUE' | 'NO_OVERRIDE'; message: string };

interface Baseline {
  /** 첫 적용 전 process.env 값. revert 가 되돌아갈 곳이다. undefined 면 키를 지운다. */
  env: string | undefined;
  /** 부팅 직후 실효값. 이 값과 지금 값이 다르면 재시작이 필요하다. */
  boot: string | null;
}

const baselines = new Map<string, Baseline>();

const nonBlank = (raw: string | undefined): string | null => raw?.trim() || null;

function baselineFor(definition: RuntimeSettingDefinition): Baseline {
  let baseline = baselines.get(definition.key);
  if (!baseline) {
    const env = process.env[definition.key];
    baseline = { env, boot: nonBlank(env) ?? definition.defaultValue };
    baselines.set(definition.key, baseline);
  }
  return baseline;
}

function applyOverride(definition: RuntimeSettingDefinition, value: string, atBoot = false): void {
  const baseline = baselineFor(definition);
  process.env[definition.key] = value;
  definition.refresh();
  if (atBoot) {
    baseline.boot = value;
  }
}

function clearOverride(definition: RuntimeSettingDefinition): void {
  const { env } = baselineFor(definition);
  if (env === undefined) {
    delete process.env[definition.key];
  } else {
    process.env[definition.key] = env;
  }
  definition.refresh();
}

function toView(definition: RuntimeSettingDefinition, override: OverrideRow | undefined): RuntimeSettingView {
  const baseline = baselines.get(definition.key);
  const env = nonBlank(baseline ? baseline.env : process.env[definition.key]);
  const value = override?.value ?? env ?? definition.defaultValue;
  return {
    key: definition.key,
    kind: definition.kind,
    ...(definition.allowed && { allowed: definition.allowed }),
    ...(definition.range && { range: definition.range }),
    apply: definition.apply,
    risk: definition.risk,
    value,
    source: override ? 'override' : env !== null ? 'env' : 'default',
    default_value: definition.defaultValue,
    default_source: definition.defaultSource,
    env_value: env,
    override: override
      ? { value: override.value, updated_at: override.updated_at, updated_by: override.updated_by }
      : null,
    pending_restart: definition.apply === 'restart' && baseline !== undefined && value !== baseline.boot,
  };
}

function readOnlyView(definition: (typeof READ_ONLY_SETTINGS)[number]): ReadOnlySettingView {
  const raw = definition.config ? mementoConfig[definition.config] : process.env[definition.key];
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  return {
    key: definition.key,
    secret: definition.secret,
    set: text !== '',
    value: definition.secret || text === '' ? null : text,
  };
}

export function listRuntimeSettings(db: Database.Database): {
  settings: RuntimeSettingView[];
  read_only: ReadOnlySettingView[];
} {
  const overrides = new Map(
    (db.prepare('SELECT key, value, updated_at, updated_by FROM setting_override').all() as OverrideRow[]).map(
      (row) => [row.key, row],
    ),
  );
  return {
    settings: [...SETTING_REGISTRY.values()].map((definition) => toView(definition, overrides.get(definition.key))),
    read_only: READ_ONLY_SETTINGS.map(readOnlyView),
  };
}

interface ChangeInput {
  key: string;
  actor: string;
  reason: string | null;
}

const selectOverride = (db: Database.Database, key: string) =>
  db.prepare('SELECT key, value, updated_at, updated_by FROM setting_override WHERE key = ?').get(key) as
    | OverrideRow
    | undefined;

function insertEvent(
  db: Database.Database,
  event: ChangeInput & { action: 'set' | 'revert'; previous: string | null; next: string | null; at: string },
): void {
  db.prepare(
    `INSERT INTO setting_override_event
       (id, setting_key, action, previous_value, new_value, actor, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), event.key, event.action, event.previous, event.next, event.actor, event.reason, event.at);
}

const unknownSetting = (key: string): SettingChangeResult => ({
  ok: false,
  code: 'UNKNOWN_SETTING',
  message: `${key} is not an adjustable setting`,
});

export function setRuntimeSettingOverride(
  db: Database.Database,
  input: ChangeInput & { value: unknown },
): SettingChangeResult {
  const definition = SETTING_REGISTRY.get(input.key);
  if (!definition) {
    return unknownSetting(input.key);
  }
  const normalized = normalizeSettingValue(definition, input.value);
  if ('message' in normalized) {
    return { ok: false, code: 'INVALID_VALUE', message: normalized.message };
  }
  const { value } = normalized;
  const now = new Date().toISOString();

  const change = db.transaction((): OverrideRow => {
    const existing = selectOverride(db, input.key);
    if (existing?.value === value) {
      return existing;
    }
    db.prepare(
      `INSERT INTO setting_override (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(input.key, value, now, input.actor);
    insertEvent(db, { ...input, action: 'set', previous: existing?.value ?? null, next: value, at: now });
    return { key: input.key, value, updated_at: now, updated_by: input.actor };
  });
  const row = change();
  applyOverride(definition, row.value);
  return { ok: true, setting: toView(definition, row) };
}

export function revertRuntimeSettingOverride(db: Database.Database, input: ChangeInput): SettingChangeResult {
  const definition = SETTING_REGISTRY.get(input.key);
  if (!definition) {
    return unknownSetting(input.key);
  }
  const now = new Date().toISOString();
  const removed = db.transaction((): boolean => {
    const existing = selectOverride(db, input.key);
    if (!existing) {
      return false;
    }
    db.prepare('DELETE FROM setting_override WHERE key = ?').run(input.key);
    insertEvent(db, { ...input, action: 'revert', previous: existing.value, next: null, at: now });
    return true;
  })();
  if (!removed) {
    return { ok: false, code: 'NO_OVERRIDE', message: `${input.key} has no override to revert` };
  }
  clearOverride(definition);
  return { ok: true, setting: toView(definition, undefined) };
}

/**
 * 기동 때 저장된 override 를 process.env 와 mementoConfig 에 반영한다. 서비스를 만들기 전에 불러야 restart 키도 반영된다.
 * 레지스트리가 받지 않는 값(키가 사라졌거나 형식이 바뀐 행)은 적용하지 않고 한 줄만 남긴다.
 */
export function applyStoredSettingOverrides(db: Database.Database): void {
  const rows = db.prepare('SELECT key, value, updated_at, updated_by FROM setting_override').all() as OverrideRow[];
  for (const row of rows) {
    const definition = SETTING_REGISTRY.get(row.key);
    const normalized = definition ? normalizeSettingValue(definition, row.value) : null;
    if (!definition || !normalized || 'message' in normalized || normalized.value !== row.value) {
      process.stderr.write(`[CONFIG WARN] setting_override ${row.key}="${row.value}" is not valid; ignoring it.\n`);
      continue;
    }
    applyOverride(definition, row.value, true);
  }
}
