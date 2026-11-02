import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

// Run with: NODE_ENV=test npx tsx scripts/bench-supersede-off.ts
process.env.NODE_ENV = 'test';
process.env.SUPERSEDE_APPLY_ENABLED = 'false';
const { initializeDatabase } = await import('../packages/memento-core/src/infrastructure/database/sqlite/init.js');
const { encodeFloat32Embedding } = await import('../packages/memento-core/src/shared/utils/embedding-serialization.js');
const { hasActiveSupersedePointers } = await import('../packages/memento-core/src/shared/utils/memory-filter-sql.js');
const { executeKnnQuery } = await import('../packages/memento-core/src/domains/search/repositories/vector-search/vector-search-knn-query.js');
const db = await initializeDatabase(':memory:');
const vector = Array(384).fill(0); vector[0] = 1;
const blob = encodeFloat32Embedding(vector);
const memory = db.prepare("INSERT INTO memory_item (id, type, content) VALUES (?, 'semantic', 'bench')");
const embedding = db.prepare(`INSERT INTO memory_embedding
(memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
VALUES (?, 'minilm', 'native', ?, 384, 'bench', 384, 32, 1, 1, 'test')`);
db.transaction(() => { for (let i = 0; i < 5000; i++) { memory.run(`m${i}`); embedding.run(`m${i}`, blob); } })();
function captureSql(livePointers: boolean) {
 let sql = ''; let params: unknown[] = [];
 const capture = { prepare: (query: string) => ({
   get: () => livePointers ? { present: 1 } : undefined,
   all: (...values: unknown[]) => { sql = query; params = values; return []; },
 }) };
 executeKnnQuery({ db: capture as never, effectiveQueryVector: vector,
  runtimeContext: { provider: 'minilm', tableName: 'memory_item_vec_minilm', modelFilter: null, expectedDimensions: 384, actualStoredDimensions: 384, targetDimensions: 384 },
  scope: {}, options: { limit: 10, threshold: 0, includeContent: true } });
 return { sql, params };
}
const unscoped = captureSql(false), stage1 = captureSql(true);
if (/rowid IN/.test(unscoped.sql) || /superseded_by/.test(unscoped.sql)) throw new Error('Unscoped SQL changed');
const ids = (query: typeof unscoped) => (db.prepare(query.sql).all(...query.params) as { memory_id: string }[]).map(row=>row.memory_id).sort();
if (JSON.stringify(ids(unscoped)) !== JSON.stringify(ids(stage1))) throw new Error('NULL-pointer results differ');
// Same SQL timing boundary as the original artifact, now including prepare and the new per-request probe.
const runs = [
 { name: 'legacy_unscoped', run: () => db.prepare(unscoped.sql).all(...unscoped.params) },
 { name: 'stage1_always_scoped', run: () => db.prepare(stage1.sql).all(...stage1.params) },
 { name: 'review_unscoped_including_probe', run: () => {
   if (hasActiveSupersedePointers(db)) throw new Error('Expected empty index');
   return db.prepare(unscoped.sql).all(...unscoped.params);
 } },
];
const samples = new Map(runs.map(run => [run.name, [] as number[]]));
// Round-robin sampling controls warm-cache and background drift between implementations.
for (let i=0; i<120; i++) for (const candidate of [...runs.slice(i % runs.length), ...runs.slice(0, i % runs.length)]) {
 const t=performance.now(); candidate.run();
 if (i>=20) samples.get(candidate.name)!.push(performance.now()-t);
}
const timings=Object.fromEntries([...samples].map(([name, times])=>{
 times.sort((a,b)=>a-b); return [name,{p50_ms:times[50],p95_ms:times[95]}];
}));
let probeSql='';
hasActiveSupersedePointers({prepare(sql:string){probeSql=sql; return db.prepare(sql);}} as never);
const plan=(query:typeof unscoped)=>db.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.params);
const ratio = timings.review_unscoped_including_probe!.p95_ms! / timings.legacy_unscoped!.p95_ms!;
const legacyPlan = plan(unscoped);
const reviewPlan = plan(unscoped);
const probePlan = db.prepare('EXPLAIN QUERY PLAN ' + probeSql).all() as Array<{ detail: string }>;
assert.deepEqual(reviewPlan, legacyPlan);
assert.ok(probePlan.some(row => row.detail.includes('idx_memory_item_superseded_by')), 'Probe must use the partial index');

// #1615: live pointers alone keep unscoped KNN off the every-embedding rowid IN path.
const MAX_ON_P95_RATIO = 1.3;
const livePointerIds = ['m1', 'm2', 'm3', 'm4', 'm5'];
const setPointers = (on: boolean) => db.prepare(`UPDATE memory_item SET superseded_by = ? WHERE id IN (${livePointerIds.map(() => '?').join(',')})`)
 .run(on ? 'm0' : null, ...livePointerIds);
const realKnn = (target: typeof db) => executeKnnQuery({ db: target, effectiveQueryVector: vector,
 runtimeContext: { provider: 'minilm', tableName: 'memory_item_vec_minilm', modelFilter: 'bench', expectedDimensions: 384, actualStoredDimensions: 384, targetDimensions: 384 },
 scope: {}, options: { limit: 10, threshold: 0, includeContent: true } });
const onSamples = { off: [] as number[], on: [] as number[] };
for (let i=0; i<120; i++) for (const state of (i % 2 ? ['on', 'off'] : ['off', 'on']) as Array<'off' | 'on'>) {
 setPointers(state === 'on');
 const t=performance.now(); const rows = realKnn(db);
 if (state === 'on') assert.ok(!rows.some(row => livePointerIds.includes(row.memory_id)), 'Live pointers must hide replaced rows');
 if (i>=20) onSamples[state].push(performance.now()-t);
}
const p95 = (times: number[]) => [...times].sort((a,b)=>a-b)[95]!;
const onRatio = p95(onSamples.on) / p95(onSamples.off);
setPointers(true);
const onStatements: Array<{ sql: string; params: unknown[] }> = [];
realKnn({ prepare(sql: string) {
 const statement = db.prepare(sql);
 const record = (run: (...params: unknown[]) => unknown) => (...params: unknown[]) => { onStatements.push({ sql, params }); return run(...params); };
 return { get: record((...params) => statement.get(...params)), all: record((...params) => statement.all(...params)) };
} } as never);
const onPlans = onStatements.map(({ sql, params }) => (db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params) as Array<{ detail: string }>).map(row => row.detail));
setPointers(false);
const hiddenCountPlan = onPlans.find((_, index) => onStatements[index]!.sql.includes('AS hidden'))!;
const knnOnPlan = onPlans.at(-1)!;
assert.ok(hiddenCountPlan[0]?.includes('idx_memory_item_superseded_by'), 'Hidden-row count must start from the partial index');
assert.ok(!knnOnPlan.some(detail => detail.includes('scoped_me')), 'Live pointers alone must not enumerate embeddings before KNN');

process.stdout.write(JSON.stringify({rows:5000,dimensions:384,limit:10,flag:'off',livePointers:0,warmup:20,samples:100,timingBoundary:'prepare + SQL, review includes fresh indexed probe; round-robin',timings,p95Ratio:ratio,maxP95Ratio:1.15,probePlan,legacyPlan,stage1Plan:plan(stage1),reviewPlan,
 livePointersOn:{livePointers:livePointerIds.length,timingBoundary:'executeKnnQuery incl. probe and hidden-row count; round-robin',off_p95_ms:p95(onSamples.off),on_p95_ms:p95(onSamples.on),p95Ratio:onRatio,maxP95Ratio:MAX_ON_P95_RATIO,hiddenCountPlan,knnOnPlan}},null,2)+'\n');
db.close();
assert.ok(ratio <= 1.15, `Off/zero-pointer p95 ratio ${ratio.toFixed(3)} exceeds 1.15`);
assert.ok(onRatio <= MAX_ON_P95_RATIO, `Live-pointer p95 ratio ${onRatio.toFixed(3)} exceeds ${MAX_ON_P95_RATIO}`);
