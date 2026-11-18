import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageDailyCountMigration, usageDailyCountDdl } from './069-usage-daily-count.js';

const base = {
  day: '2026-11-18',
  client_name: 'claude-code',
  client_version: '2.1.327',
  connection_method: 'http-streamable',
  era: 'modern',
  request_kind: 'tools/call',
  tool: 'recall',
  outcome: 'success',
  error_code: 0,
  count: 1,
};

function insert(db: Database.Database, over: Partial<typeof base> = {}) {
  const row = { ...base, ...over };
  db.prepare(
    `INSERT INTO usage_daily_count
     (day, client_name, client_version, connection_method, era, request_kind, tool, outcome, error_code, count)
     VALUES (@day, @client_name, @client_version, @connection_method, @era, @request_kind, @tool, @outcome, @error_code, @count)`,
  ).run(row);
}

describe('069 usage_daily_count (#1768)', () => {
  let db: Database.Database;
  const migration = new UsageDailyCountMigration();

  beforeEach(async () => {
    db = new Database(':memory:');
    await migration.up(db);
  });

  afterEach(() => db.close());

  it('올바른 행을 받는다', () => {
    insert(db);
    insert(db, { client_name: 'other', client_version: '', tool: 'other', outcome: 'error', error_code: -32602 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM usage_daily_count').get()).toEqual({ n: 2 });
  });

  describe('DB 제약 (설계 테스트 2)', () => {
    it.each([
      ['목록 밖 접속 방식', { connection_method: 'carrier-pigeon' }],
      ['목록 밖 시대', { era: 'future' }],
      ['목록 밖 요청 종류', { request_kind: 'prompts/get' }],
      ['목록 밖 오류 코드', { outcome: 'error', error_code: -32022 }],
      ['모양은 맞지만 목록 밖인 클라이언트 이름', { client_name: 'zzz' }],
      ['경로 모양 클라이언트 이름', { client_name: '/home/jee1lee/secret' }],
      ['경로 모양 버전', { client_version: '/home/jee1lee/secret' }],
      ['접미사가 붙은 버전', { client_version: '1.2.3-beta' }],
      ['두 조각 버전', { client_version: '1.2' }],
      ['네 조각 버전', { client_version: '1.2.3.4' }],
      ['점이 이어진 버전', { client_version: '1..2' }],
      ['경로 모양 도구 이름', { tool: '/home/jee1lee/x' }],
      ['대문자 도구 이름', { tool: 'Recall' }],
      ['공백 든 도구 이름', { tool: 're call' }],
      ['성공인데 오류 코드가 있는 행', { outcome: 'success', error_code: -32602 }],
      ['오류인데 오류 코드가 0 인 행', { outcome: 'error', error_code: 0 }],
      ['횟수 0', { count: 0 }],
    ])('%s 는 거부한다', (_label, over) => {
      expect(() => insert(db, over as Partial<typeof base>)).toThrow(/CHECK constraint failed/);
    });

    it('도구 칸은 모양만 막는다: 모양이 맞는 임의 소문자 단어는 DB 가 받는다 (마지막 방어선은 앱 정규화)', () => {
      expect(() => insert(db, { tool: 'memento' })).not.toThrow();
      expect(() => insert(db, { tool: 'a3f9c2e17b4d8a60' })).not.toThrow();
    });

    it('버전 칸은 숫자 세 조각 모양이면 어떤 값이든 받는다', () => {
      expect(() => insert(db, { client_version: '12.34.56' })).not.toThrow();
    });
  });

  it('같은 열쇠의 행은 하나로 합쳐 더한다 (ON CONFLICT)', () => {
    const upsert = db.prepare(
      `INSERT INTO usage_daily_count
       (day, client_name, client_version, connection_method, era, request_kind, tool, outcome, error_code, count)
       VALUES (@day, @client_name, @client_version, @connection_method, @era, @request_kind, @tool, @outcome, @error_code, @count)
       ON CONFLICT DO UPDATE SET count = count + excluded.count`,
    );
    upsert.run({ ...base, count: 3 });
    upsert.run({ ...base, count: 4 });
    expect(db.prepare('SELECT count FROM usage_daily_count').all()).toEqual([{ count: 7 }]);
  });

  it('WITHOUT ROWID 표다 (열쇠를 rowid 와 이중으로 저장하지 않는다)', () => {
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'usage_daily_count'").get() as { sql: string }).sql;
    expect(sql).toMatch(/WITHOUT ROWID/i);
  });

  it('두 번 올려도 안전하고 내리면 표가 사라진다', async () => {
    await migration.up(db);
    await migration.validateAfter(db);
    await migration.down(db);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'usage_daily_count'").get()).toBeUndefined();
    await migration.down(db);
  });

  it('down 은 버전 행도 지운다', async () => {
    db.exec('CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO memento_schema_version VALUES (?)').run('69.0');
    await migration.down(db);
    expect(db.prepare("SELECT version FROM memento_schema_version WHERE version = '69.0'").get()).toBeUndefined();
  });

  it('schema.sql 의 정의가 마이그레이션 DDL 과 같다', () => {
    const schema = readFileSync(join(import.meta.dirname, '..', '..', 'schema.sql'), 'utf8');
    const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
    const start = schema.indexOf('CREATE TABLE IF NOT EXISTS usage_daily_count');
    const end = schema.indexOf('WITHOUT ROWID;', start) + 'WITHOUT ROWID;'.length;
    expect(start).toBeGreaterThan(-1);
    expect(squash(schema.slice(start, end))).toBe(squash(usageDailyCountDdl()));
  });
});
