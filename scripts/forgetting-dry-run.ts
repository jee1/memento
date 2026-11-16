import Database from 'better-sqlite3';
import { ForgettingAlgorithm } from '../packages/memento-core/src/domains/forgetting/algorithms/forgetting-algorithm.ts';

const DAY = 86_400_000;
const TTL_SOFT: Record<string, number> = { working: 2, episodic: 30, semantic: 180, procedural: 90 };
const db = new Database(process.argv[2], { readonly: true });
const rows = db.prepare(`
  SELECT id, created_at, last_accessed, last_accessed_at, importance, pinned, type,
         COALESCE(view_count,0) view_count, COALESCE(cite_count,0) cite_count, COALESCE(edit_count,0) edit_count
  FROM memory_item WHERE pinned = 0 AND COALESCE(is_deleted,0) = 0`).all() as any[];

const realNow = Date.now;
function run(label: string, offsetDays: number, access: (r: any) => string | undefined) {
  Date.now = () => realNow() + offsetDays * DAY;
  const RealDate = globalThis.Date;
  const shift = offsetDays * DAY;
  class Shifted extends RealDate {
    constructor(...a: any[]) { if (a.length === 0) super(realNow() + shift); else super(...(a as [any])); }
  }
  (globalThis as any).Date = Shifted;
  const algo = new ForgettingAlgorithm();
  const memories = rows.map(r => ({ ...r, pinned: Boolean(r.pinned), last_accessed: access(r) }));
  const res = algo.analyzeForgetCandidates(memories);
  const byId = new Map(memories.map(m => [m.id, m]));
  const counts: Record<string, number> = {};
  let ttlOnlyWorking = 0;
  for (const r of res) {
    const m = byId.get(r.memory_id)!;
    const age = (realNow() + shift - new RealDate(m.created_at).getTime()) / DAY;
    if (r.should_forget && age >= TTL_SOFT[m.type]) counts[m.type] = (counts[m.type] ?? 0) + 1;
  }
  for (const m of memories) {
    const age = (realNow() + shift - new RealDate(m.created_at).getTime()) / DAY;
    if (m.type === 'working' && age >= TTL_SOFT.working) ttlOnlyWorking++;
  }
  (globalThis as any).Date = RealDate;
  Date.now = realNow;
  console.log(label.padEnd(44), JSON.stringify(counts), 'working_past_ttl:', ttlOnlyWorking);
}

console.log('rows', rows.length);
run('current last_accessed, now', 0, r => r.last_accessed ?? undefined);
for (const d of [30, 60, 90, 180]) run(`frozen last_accessed, +${d}d`, d, r => r.last_accessed ?? undefined);
run('last_accessed_at only, now', 0, r => r.last_accessed_at ?? undefined);
run('no access signal, now', 0, () => undefined);
