/**
 * 망각 정리를 DB 사본에서 미리 돌려 유형별 소프트 삭제 수를 센다 (#1743, #1749).
 * 접근 없이 N 일이 흐른 상태(created_at, last_accessed, deleted_at 을 N 일 당김)를 만든 뒤 실제 ForgettingPolicyService 를 돌린다.
 *
 * usage: npx tsx scripts/forgetting-dry-run.ts <db 사본> [일수,...] [--step=<일>]
 * 기본은 일수마다 새 사본에 정리를 한 번 돌린다.
 * --step 을 주면 사본 하나에서 step 일씩 당기며 매번 정리하고, 지정한 일수 시점의 누적 삭제 수를 낸다.
 * 정리를 한 번만 돌리면 한 유형이 지워져 다른 유형 점수가 바뀌는 효과를 못 본다.
 * 원본은 읽기 전용으로 열어 SQLite backup 으로 임시 사본을 만든다(WAL 내용 포함).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ForgettingPolicyService } from '../packages/memento-core/src/domains/forgetting/services/forgetting-policy-service.ts';
import { configureSqliteSession } from '../packages/memento-core/src/infrastructure/database/sqlite/init-sqlite-session.ts';

const args = process.argv.slice(2);
const stepArg = args.find((a) => a.startsWith('--step='));
const [source, daysArg = '0,30,60,90'] = args.filter((a) => !a.startsWith('--'));
if (!source) {
  console.error('usage: npx tsx scripts/forgetting-dry-run.ts <db 사본> [일수,...] [--step=<일>]');
  process.exit(64);
}
const days = daysArg.split(',').map(Number);
const step = stepArg ? Number(stepArg.slice('--step='.length)) : undefined;
if (days.some((d) => !Number.isInteger(d) || d < 0)) throw new Error(`일수는 0 이상 정수: ${daysArg}`);
if (step !== undefined && (!Number.isInteger(step) || step <= 0)) throw new Error(`step 은 1 이상 정수: ${stepArg}`);

const shift = (column: string, n: number) =>
  `${column} = CASE WHEN ${column} IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, '-${n} days') END`;
const passDays = (db: Database.Database, n: number) =>
  db.exec(`UPDATE memory_item SET ${shift('created_at', n)}, ${shift('last_accessed', n)}, ${shift('deleted_at', n)}`);
const CATEGORY = `CASE WHEN type = 'semantic' AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(tags) THEN tags ELSE '[]' END) WHERE value = 'user-directive')
  THEN 'semantic:user-directive' ELSE type END`;
const aliveByCategory = (db: Database.Database) =>
  new Map(
    (db.prepare(`SELECT ${CATEGORY} k, count(*) n FROM memory_item WHERE COALESCE(is_deleted, 0) = 0 GROUP BY k`).all() as { k: string; n: number }[])
      .map((r) => [r.k, r.n]),
  );
const deletedSince = (start: Map<string, number>, db: Database.Database) => {
  const alive = aliveByCategory(db);
  return Object.fromEntries([...start].map(([k, v]) => [k, v - (alive.get(k) ?? 0)]));
};
const readAccess = (db: Database.Database) =>
  new Map(
    (db.prepare('SELECT id, last_accessed FROM memory_item').all() as { id: string; last_accessed: string | null }[])
      .map((r) => [r.id, r.last_accessed]),
  );

const dir = mkdtempSync(join(tmpdir(), 'forgetting-dry-run-'));
async function openCopy(name: string): Promise<Database.Database> {
  const copy = join(dir, `${name}.db`);
  const src = new Database(source, { readonly: true });
  await src.backup(copy);
  src.close();
  const db = new Database(copy);
  await configureSqliteSession(db);
  return db;
}

try {
  const service = new ForgettingPolicyService();
  if (step === undefined) {
    for (const n of days) {
      const db = await openCopy(`run-${n}`);
      passDays(db, n);
      const start = aliveByCategory(db);
      const before = readAccess(db);
      const result = await service.executeMemoryCleanup(db);
      const deletedIds = new Set(result.softDeleted);
      let lastAccessedTouched = 0;
      for (const [id, value] of readAccess(db)) {
        if (!deletedIds.has(id) && before.get(id) !== value) lastAccessedTouched++;
      }
      console.log(JSON.stringify({ days: n, processed: result.totalProcessed, softDeleted: deletedSince(start, db), hardDeleted: result.hardDeleted.length, lastAccessedTouched }));
      db.close();
    }
  } else {
    const db = await openCopy('cumulative');
    const start = aliveByCategory(db);
    const report = new Set(days);
    for (let n = 0; n <= Math.max(...days); n += step) {
      if (n > 0) passDays(db, step);
      await service.executeMemoryCleanup(db);
      if (report.has(n)) console.log(JSON.stringify({ days: n, deleted: deletedSince(start, db) }));
    }
    db.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
