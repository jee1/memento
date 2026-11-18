/**
 * Migration: 069 — usage_daily_count (#1768)
 * Version: 69.0
 *
 * 접속 클라이언트와 도구 호출 결과를 로컬에만 일별로 센다. 바깥으로 보내는 코드는 없다.
 * 칸마다 DB 제약을 달았지만 막는 힘이 다르다. tool 칸은 모양만 막고(등록된 이름인지는 앱 정규화가 본다),
 * client_version 은 major.minor.patch 모양(숫자 세 조각)이거나 빈 문자열이면 받는다. 칸별 한계는 docs/adr/2026-11-18-issue-1768-local-usage-aggregate.md 에 있다.
 * client_name 은 CHECK IN 이다. 클라이언트를 목록에 더하는 변경은 이 표를 다시 만드는 마이그레이션을 함께 낸다.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';
import {
  CLIENT_NAMES,
  CONNECTION_METHODS,
  ERROR_CODES,
  OUTCOMES,
  PROTOCOL_ERAS,
  REQUEST_KINDS,
} from '../../../../../domains/telemetry/usage/usage-vocabulary.js';

const sqlList = (values: readonly (string | number)[]) =>
  values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(', ');

export function usageDailyCountDdl(): string {
  const clientNames = [...CLIENT_NAMES, 'other', 'unknown'];
  return `
    CREATE TABLE IF NOT EXISTS usage_daily_count (
      day               TEXT    NOT NULL CHECK (length(day) = 10),
      client_name       TEXT    NOT NULL CHECK (client_name IN (${sqlList(clientNames)})),
      client_version    TEXT    NOT NULL CHECK (client_version = ''
                                           OR (length(client_version) <= 24
                                               AND client_version NOT GLOB '*[^0-9.]*'
                                               AND client_version NOT GLOB '*..*'
                                               AND client_version NOT GLOB '.*'
                                               AND client_version NOT GLOB '*.'
                                               AND length(client_version) - length(replace(client_version, '.', '')) = 2)),
      connection_method TEXT    NOT NULL CHECK (connection_method IN (${sqlList(CONNECTION_METHODS)})),
      era               TEXT    NOT NULL CHECK (era IN (${sqlList(PROTOCOL_ERAS)})),
      request_kind      TEXT    NOT NULL CHECK (request_kind IN (${sqlList(REQUEST_KINDS)})),
      tool              TEXT    NOT NULL CHECK (length(tool) <= 64 AND tool NOT GLOB '*[^a-z0-9_]*'),
      outcome           TEXT    NOT NULL CHECK (outcome IN (${sqlList(OUTCOMES)})),
      error_code        INTEGER NOT NULL CHECK (error_code IN (${sqlList(ERROR_CODES)})),
      count             INTEGER NOT NULL CHECK (count >= 1),
      PRIMARY KEY (day, client_name, client_version, connection_method, era, request_kind, tool, outcome, error_code),
      CHECK ((outcome = 'success') = (error_code = 0))
    ) WITHOUT ROWID;
  `;
}

export class UsageDailyCountMigration implements Migration {
  version = '69.0';
  name = 'usage-daily-count';
  description = 'Create usage_daily_count: local-only daily counts by client, connection method, era, tool and outcome (#1768)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec(usageDailyCountDdl());
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS usage_daily_count;');
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='usage_daily_count'`).get();
    if (!t) throw new Error('usage_daily_count 표가 만들어지지 않았다');
  }
}

export default UsageDailyCountMigration;
