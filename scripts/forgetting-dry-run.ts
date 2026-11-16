/**
 * 망각 정리를 DB 사본에서 미리 돌려 유형별 소프트 삭제 수를 센다 (#1743).
 * 접근 없이 N 일이 흐른 상태(created_at, last_accessed 를 N 일 당김)를 만든 뒤 실제 ForgettingPolicyService 를 돌린다.
 *
 * usage: npx tsx scripts/forgetting-dry-run.ts <db 사본> [일수,...]
 * 원본은 읽기 전용으로 열어 SQLite backup 으로 임시 사본을 만든다(WAL 내용 포함).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ForgettingPolicyService } from '../packages/memento-core/src/domains/forgetting/services/forgetting-policy-service.ts';
import { configureSqliteSession } from '../packages/memento-core/src/infrastructure/database/sqlite/init-sqlite-session.ts';

const [source, daysArg = '0,30,60,90'] = process.argv.slice(2);
if (!source) {
  console.error('usage: npx tsx scripts/forgetting-dry-run.ts <db 사본> [일수,...]');
  process.exit(64);
}

const shift = (column: string, days: number) =>
  `${column} = CASE WHEN ${column} IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, '-${days} days') END`;

const dir = mkdtempSync(join(tmpdir(), 'forgetting-dry-run-'));
try {
  for (const days of daysArg.split(',').map(Number)) {
    if (!Number.isInteger(days) || days < 0) throw new Error(`일수는 0 이상 정수: ${daysArg}`);
    const copy = join(dir, `run-${days}.db`);
    const src = new Database(source, { readonly: true });
    await src.backup(copy);
    src.close();
    const db = new Database(copy);
    await configureSqliteSession(db);
    db.exec(`UPDATE memory_item SET ${shift('created_at', days)}, ${shift('last_accessed', days)}`);
    const readAccess = () =>
      new Map(
        (db.prepare('SELECT id, last_accessed FROM memory_item').all() as { id: string; last_accessed: string | null }[])
          .map((r) => [r.id, r.last_accessed]),
      );
    const before = readAccess();

    const result = await new ForgettingPolicyService().executeMemoryCleanup(db);

    const typeOf = db.prepare('SELECT type FROM memory_item WHERE id = ?');
    const softDeleted: Record<string, number> = {};
    for (const id of result.softDeleted) {
      const { type } = typeOf.get(id) as { type: string };
      softDeleted[type] = (softDeleted[type] ?? 0) + 1;
    }
    const deletedIds = new Set(result.softDeleted);
    let lastAccessedTouched = 0;
    for (const [id, value] of readAccess()) {
      if (!deletedIds.has(id) && before.get(id) !== value) lastAccessedTouched++;
    }
    console.log(JSON.stringify({ days, processed: result.totalProcessed, softDeleted, hardDeleted: result.hardDeleted.length, lastAccessedTouched }));
    db.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
