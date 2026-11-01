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
process.stdout.write(JSON.stringify({rows:5000,dimensions:384,limit:10,flag:'off',livePointers:0,warmup:20,samples:100,timingBoundary:'prepare + SQL, review includes fresh indexed probe; round-robin',timings,p95Ratio:ratio,maxP95Ratio:1.15,probePlan,legacyPlan,stage1Plan:plan(stage1),reviewPlan},null,2)+'\n');
db.close();
assert.ok(ratio <= 1.15, `Off/zero-pointer p95 ratio ${ratio.toFixed(3)} exceeds 1.15`);
