/**
 * #1582: 설정 override 저장소와 실효값 해석.
 *
 * 실효값은 override > 기동 때 env(빈 문자열은 미설정) > 코드 기본값 순이고, 화면에는 코드가 실제로 해석한 값을 보인다.
 * 기동 때 env 와 기동 직후 실효값은 process.env 와 함께 프로세스 전역이라 키마다 한 번만 기억하고, 모듈 전역에 둔다.
 * override 는 적용한 설정이 새 검증 오류(offline strict 등)를 만들면 받지 않는다. 기동 검증(validateConfig)이
 * override 적용보다 먼저 돌기 때문이다.
 * set 과 revert 는 override 행과 감사 event 를 한 트랜잭션에 쓴다.
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { mementoConfig } from '../../shared/config/index.js';
import { validateConfiguration } from '../../shared/utils/configuration-validator.js';
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

export interface SettingLastChange {
  action: 'set' | 'revert';
  actor: string;
  reason: string | null;
  created_at: string;
}

export interface SettingEvent extends SettingLastChange {
  id: string;
  setting_key: string;
  previous_value: string | null;
  new_value: string | null;
}

export interface RuntimeSettingView {
  key: string;
  description: string;
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
  /** 저장된 override 를 기동 때 적용하지 않은 이유. null 이면 적용됐거나 override 가 없다. */
  override_ignored_reason: string | null;
  /** 이 키의 최신 감사 event. 한 번도 바꾼 적이 없으면 null. */
  last_change: SettingLastChange | null;
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
  /** 부팅 직후 코드가 해석한 실효값(current()). 이 값과 지금 값이 다르면 재시작이 필요하다. */
  boot: string | null;
}

const baselines = new Map<string, Baseline>();
/** 기동 때 적용하지 않은 저장 행. 화면이 조용히 env/기본값을 override 로 보이지 않게 이유를 남긴다. */
const ignoredOverrides = new Map<string, string>();

const nonBlank = (raw: string | undefined): string | null => raw?.trim() || null;

function baselineFor(definition: RuntimeSettingDefinition): Baseline {
  let baseline = baselines.get(definition.key);
  if (!baseline) {
    baseline = { env: process.env[definition.key], boot: definition.current() };
    baselines.set(definition.key, baseline);
  }
  return baseline;
}

function writeEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

const SILENT = { warn: () => {}, error: () => {} };

/** 같은 code 라도 대상(provider, 키)이 다르면 다른 위반이다. 그래서 code 와 메시지를 함께 키로 쓴다. */
function validationErrors(): Set<string> {
  const { errors } = validateConfiguration(mementoConfig, { throwOnError: false, logger: SILENT });
  return new Set(errors.map((issue) => `[${issue.code}] ${issue.message}`));
}

/**
 * env 를 바꾸고 mementoConfig 를 다시 계산한다. 바꾼 설정이 전에 없던 검증 오류를 만들면 되돌리고 그 메시지를 돌려준다.
 * 이미 있던 오류는 이번 변경 탓이 아니므로 막지 않는다.
 */
function applyEnvChecked(definition: RuntimeSettingDefinition, value: string | undefined): string | null {
  baselineFor(definition);
  const before = validationErrors();
  const previous = process.env[definition.key];
  writeEnv(definition.key, value);
  definition.refresh();
  const introduced = [...validationErrors()].filter((issue) => !before.has(issue));
  if (introduced.length === 0) {
    return null;
  }
  writeEnv(definition.key, previous);
  definition.refresh();
  return introduced.join('; ');
}

function toView(
  definition: RuntimeSettingDefinition,
  override: OverrideRow | undefined,
  lastChange: SettingLastChange | null,
): RuntimeSettingView {
  const baseline = baselines.get(definition.key);
  const env = nonBlank(baseline ? baseline.env : process.env[definition.key]);
  const value = definition.current();
  const ignoredReason = override ? (ignoredOverrides.get(definition.key) ?? null) : null;
  return {
    key: definition.key,
    description: definition.description,
    kind: definition.kind,
    ...(definition.allowed && { allowed: definition.allowed }),
    ...(definition.range && { range: definition.range }),
    apply: definition.apply,
    risk: definition.risk,
    value,
    source: override && ignoredReason === null ? 'override' : env !== null ? 'env' : 'default',
    default_value: definition.defaultValue,
    default_source: definition.defaultSource,
    env_value: env,
    override: override
      ? { value: override.value, updated_at: override.updated_at, updated_by: override.updated_by }
      : null,
    pending_restart: definition.apply === 'restart' && baseline !== undefined && value !== baseline.boot,
    override_ignored_reason: ignoredReason,
    last_change: lastChange,
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
  const lastChanges = new Map(
    (
      db
        .prepare(
          `SELECT setting_key, action, actor, reason, created_at FROM setting_override_event
           WHERE rowid IN (SELECT MAX(rowid) FROM setting_override_event GROUP BY setting_key)`,
        )
        .all() as Array<SettingLastChange & { setting_key: string }>
    ).map(({ setting_key: key, ...change }) => [key, change]),
  );
  return {
    settings: [...SETTING_REGISTRY.values()].map((definition) =>
      toView(definition, overrides.get(definition.key), lastChanges.get(definition.key) ?? null),
    ),
    read_only: READ_ONLY_SETTINGS.map(readOnlyView),
  };
}

interface ChangeInput {
  key: string;
  actor: string;
  reason: string;
}

const selectOverride = (db: Database.Database, key: string) =>
  db.prepare('SELECT key, value, updated_at, updated_by FROM setting_override WHERE key = ?').get(key) as
    | OverrideRow
    | undefined;

const selectLastChange = (db: Database.Database, key: string): SettingLastChange | null =>
  (db
    .prepare(
      'SELECT action, actor, reason, created_at FROM setting_override_event WHERE setting_key = ? ORDER BY rowid DESC LIMIT 1',
    )
    .get(key) as SettingLastChange | undefined) ?? null;

export type SettingEventsResult =
  | { ok: true; events: SettingEvent[] }
  | { ok: false; code: 'UNKNOWN_SETTING'; message: string };

/** 최신순 감사 event. key 를 주면 그 키만, 레지스트리 밖 키는 UNKNOWN_SETTING 이다. */
export function listSettingEvents(
  db: Database.Database,
  input: { key?: string; limit: number },
): SettingEventsResult {
  if (input.key !== undefined && !SETTING_REGISTRY.has(input.key)) {
    return unknownSetting(input.key);
  }
  const events = db
    .prepare(
      `SELECT id, setting_key, action, previous_value, new_value, actor, reason, created_at
       FROM setting_override_event WHERE (? IS NULL OR setting_key = ?) ORDER BY rowid DESC LIMIT ?`,
    )
    .all(input.key ?? null, input.key ?? null, input.limit) as SettingEvent[];
  return { ok: true, events };
}

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

const unknownSetting = (key: string) => ({
  ok: false as const,
  code: 'UNKNOWN_SETTING' as const,
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

  const previousEnv = process.env[definition.key];
  const rejected = applyEnvChecked(definition, value);
  if (rejected) {
    return { ok: false, code: 'INVALID_VALUE', message: `${input.key}=${value} is not allowed: ${rejected}` };
  }

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
  let row: OverrideRow;
  try {
    row = change();
  } catch (error) {
    writeEnv(definition.key, previousEnv);
    definition.refresh();
    throw error;
  }
  ignoredOverrides.delete(input.key);
  return { ok: true, setting: toView(definition, row, selectLastChange(db, input.key)) };
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
  const { env } = baselineFor(definition);
  writeEnv(definition.key, env);
  definition.refresh();
  ignoredOverrides.delete(input.key);
  return { ok: true, setting: toView(definition, undefined, selectLastChange(db, input.key)) };
}

/**
 * 기동 때 저장된 override 를 process.env 와 mementoConfig 에 반영한다. 서비스를 만들기 전에 불러야 restart 키도 반영된다.
 * 레지스트리가 받지 않는 값(키가 사라졌거나 형식이 바뀐 행)은 적용하지 않고 한 줄만 남긴다.
 */
export function applyStoredSettingOverrides(db: Database.Database): void {
  for (const definition of SETTING_REGISTRY.values()) {
    baselineFor(definition);
  }
  const rows = db.prepare('SELECT key, value, updated_at, updated_by FROM setting_override').all() as OverrideRow[];
  for (const row of rows) {
    const definition = SETTING_REGISTRY.get(row.key);
    const normalized = definition ? normalizeSettingValue(definition, row.value) : null;
    if (!definition || !normalized || 'message' in normalized || normalized.value !== row.value) {
      process.stderr.write(`[CONFIG WARN] setting_override ${row.key}="${row.value}" is not valid; ignoring it.\n`);
      ignoredOverrides.set(row.key, normalized && 'message' in normalized ? normalized.message : 'not a canonical value');
      continue;
    }
    const rejected = applyEnvChecked(definition, row.value);
    if (rejected) {
      process.stderr.write(`[CONFIG WARN] setting_override ${row.key}="${row.value}" is not allowed (${rejected}); ignoring it.\n`);
      ignoredOverrides.set(row.key, rejected);
    } else {
      ignoredOverrides.delete(row.key);
    }
  }
  for (const definition of SETTING_REGISTRY.values()) {
    baselineFor(definition).boot = definition.current();
  }
}
