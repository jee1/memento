import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolveSchemaPath } from '../../../../infrastructure/database/sqlite/apply-schema.js';
import { RejectionGateBaselineMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/066-rejection-gate-baseline.js';
import { TelemetryEventsMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/027-telemetry-events.js';
import { TelemetryDailyMetricsMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/028-telemetry-daily-metrics.js';

/** 기본은 마이그레이션 066 을 돌려 기존 DB 처럼 시드 두 행을 둔다. `freshInstall` 은 schema.sql 의 빈 테이블만 둔다. */
export async function createGateDriftDb(options: { freshInstall?: boolean } = {}): Promise<Database.Database> {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY, is_deleted INTEGER DEFAULT 0)');
  await new TelemetryEventsMigration().up(db);
  await new TelemetryDailyMetricsMigration().up(db);
  if (options.freshInstall) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- resolveSchemaPath 는 고정 경로(schema.sql)만 돌려준다.
    const statements = readFileSync(resolveSchemaPath(), 'utf8').match(
      /CREATE TABLE IF NOT EXISTS rejection_gate_baseline\b[\s\S]*?\n\);|CREATE TRIGGER IF NOT EXISTS rejection_gate_baseline_\w+[\s\S]*?END;/g,
    );
    db.exec(statements!.join('\n'));
  } else {
    await new RejectionGateBaselineMigration().up(db);
  }
  return db;
}

export function seedActiveMemoryItems(db: Database.Database, count: number): void {
  const insert = db.prepare('INSERT INTO memory_item (id) VALUES (?)');
  db.transaction(() => {
    for (let i = 0; i < count; i += 1) insert.run(`m${i}`);
  })();
}

let eventSeq = 0;

/** 질의 해시 없이 판정과 top_score 만 싣는 합성 reranked 이벤트 */
export function insertRerankedEvents(
  db: Database.Database,
  createdAt: string,
  verdict: 'rejected' | 'passed' | 'fail_open' | 'off',
  count: number,
  topScore: number | null = verdict === 'rejected' ? 0.1 : 0.9,
): void {
  const insert = db.prepare(
    `INSERT INTO telemetry_events (id, event_type, request_id, owner_id, outcome, extra_data, created_at)
     VALUES (?, 'memory.search.reranked', ?, 'o1', 'success', ?, ?)`,
  );
  const extra = JSON.stringify({ rejection_gate_verdict: verdict, rejection_gate_top_score: topScore });
  db.transaction(() => {
    for (let i = 0; i < count; i += 1) {
      eventSeq += 1;
      insert.run(`ev${eventSeq}`, `req${eventSeq}`, extra, createdAt);
    }
  })();
}
