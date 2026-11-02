/**
 * #1614: 직접 대체(#1551)와 현재 상태 읽기(#1552)를 운영 DB 사본에서 함께 검증한다.
 *
 * 사본에 승인을 걸고(apply) 읽기 경로마다 대체된 기억의 노출, 범위 유출, 역사 조회를 잰 뒤
 * restore 로 되돌려 원상태를 확인한다. 마지막으로 live 포인터 0개와 N개의 지연과 실행 계획을 비교한다.
 * 사본에 적용 가능한 후보가 없으면 2B 짝짓기(SupersedeCandidateService.scan)를 LLM 없이 돌려
 * verdict 를 pending 으로 고정한 후보를 만든다. 짝은 실제이고 판정은 합성이다.
 *
 * Usage: npx tsx scripts/verify-supersede-integration.ts --db <copy.db> [--approve 5] [--scan-pairs 40] [--lookback-days 7]
 */
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

const { values: args } = parseArgs({
  options: {
    db: { type: 'string' },
    approve: { type: 'string', default: '5' },
    'scan-pairs': { type: 'string', default: '40' },
    'lookback-days': { type: 'string', default: '7' },
  },
});
if (!args.db) throw new Error('--db <copy.db> is required');
const dbPath = realpathSync(resolve(args.db));
for (const live of [join(homedir(), '.memento/data/memory.db'), process.env.DB_PATH?.replace(/^~/, homedir())]) {
  if (live && dbPath === (() => { try { return realpathSync(live); } catch { return null; } })()) {
    throw new Error(`Refusing to run against the live database ${live}; pass a copy`);
  }
}
const APPROVE = Number(args.approve);
const SCAN_PAIRS = Number(args['scan-pairs']);
const LOOKBACK_DAYS = Number(args['lookback-days']);
const K = 5;
const ACTOR = 'issue-1614-harness';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = dbPath;
process.env.BATCH_SCHEDULER_ENABLED = 'false';
process.env.EMBEDDING_PROVIDER = 'minilm';
const { initializeDatabase } = await import('../packages/memento-core/src/infrastructure/database/sqlite/init.js');
const { sqliteRepositoryProvider } = await import('../packages/memento-core/src/infrastructure/database/factories/sqlite-repository-provider.js');
const { createSearchEmbeddingAndOptimizerServices } = await import('../packages/memento-core/src/bootstrap/search-and-embedding.js');
const { createAnchorStack } = await import('../packages/memento-core/src/bootstrap/anchor-stack.js');
const { ErrorLoggingService } = await import('../packages/memento-core/src/domains/monitoring/services/error-logging-service.js');
const { createRelationGraph } = await import('../packages/memento-core/src/infrastructure/relation-graph-factory.js');
const { RecallTool } = await import('../packages/memento-core/src/domains/memory/recall/recall-tool.js');
const { MemoryInjectionPrompt } = await import('../packages/memento-core/src/domains/memory/tools/memory-injection-prompt.js');
const { GetMemoryNeighborsTool } = await import('../packages/memento-core/src/domains/memory/tools/get-memory-neighbors-tool.js');
const { GetRelationsTool } = await import('../packages/memento-core/src/domains/relation/tools/get-relations-tool.js');
const { RelationGraphTraversal } = await import('../packages/memento-core/src/domains/relation/services/relation-graph-traversal.js');
const { ConsolidationRepository } = await import('../packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.js');
const { findMemoryResourceRowById } = await import('../packages/memento-core/src/domains/memory/repositories/memory-item-repository.js');
const { SupersedeCandidateService } = await import('../packages/memento-core/src/domains/memory/supersede/supersede-candidate-service.js');
const { applySupersedeCandidate, restoreSupersededMemory } = await import('../packages/memento-core/src/domains/memory/supersede/supersede-apply-service.js');
const { executeKnnQuery } = await import('../packages/memento-core/src/domains/search/repositories/vector-search/vector-search-knn-query.js');
const { embeddingColumnToNumbers } = await import('../packages/memento-core/src/shared/utils/embedding-serialization.js');

type Db = import('better-sqlite3').Database;
const db: Db = await initializeDatabase(dbPath);

interface Pair {
  candidateId: string;
  oldId: string;
  newId: string;
  type: string;
  projectId: string | null;
  query: string;
  relationRoot: string | null;
  /** false 면 BFS 가 root 에서 new 에 old 를 거쳐서만 닿는다. old 를 숨기면 new 도 빠지는 게 정상이다. */
  newAdjacentToRoot: boolean;
}
type View = 'current' | 'history' | 'foreign';
type Phase = 'before' | 'applied' | 'restored';
/** null 은 그 경로가 이 짝에 해당하지 않는다는 뜻이다(관계 없음, episodic 아님, 역사 옵션 없음 등). */
type Probe = (pair: Pair, view: View) => Promise<string[] | null>;

const applicable = () => db.prepare(`SELECT c.id FROM memory_supersede_candidate c
  JOIN memory_item o ON o.id = c.old_memory_id AND COALESCE(o.is_deleted, 0) = 0 AND o.superseded_by IS NULL
  JOIN memory_item n ON n.id = c.new_memory_id AND COALESCE(n.is_deleted, 0) = 0
  WHERE c.verdict IN ('confirmed', 'pending')`).all() as Array<{ id: string }>;

let candidateSource = 'existing';
if (applicable().length === 0) {
  candidateSource = 'synthetic-pending';
  const port = {
    provider: 'ollama' as const,
    complete: async () => ({
      content: JSON.stringify({ verdict: 'pending', rationale: 'issue-1614 synthetic verdict for integration measurement', evidence_quote: null }),
      usage: { promptTokens: 0, completionTokens: 0 },
    }),
  };
  const scan = await new SupersedeCandidateService({ db, port, model: 'issue-1614-synthetic' })
    .scan({ runId: 'issue-1614', lookbackDays: LOOKBACK_DAYS, maxPairs: SCAN_PAIRS });
  process.stderr.write(`scan ${JSON.stringify(scan)}\n`);
}

const relationRoot = (oldId: string, newId: string) => (db.prepare(`SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END AS id
  FROM memory_relation r JOIN memory_item mi ON mi.id = CASE WHEN r.source_id = ? THEN r.target_id ELSE r.source_id END
  WHERE (source_id = ? OR target_id = ?) AND mi.id NOT IN (?, ?) AND COALESCE(mi.is_deleted, 0) = 0 AND mi.superseded_by IS NULL
  LIMIT 1`).get(oldId, oldId, oldId, oldId, oldId, newId) as { id: string } | undefined)?.id ?? null;

const rows = db.prepare(`SELECT c.id AS candidateId, c.old_memory_id AS oldId, c.new_memory_id AS newId,
  c.memory_type AS type, c.project_id AS projectId, o.content AS content
  FROM memory_supersede_candidate c JOIN memory_item o ON o.id = c.old_memory_id
  WHERE c.id IN (${applicable().map(() => '?').join(',') || 'NULL'})`).all(...applicable().map(row => row.id)) as Array<Omit<Pair, 'query' | 'relationRoot' | 'newAdjacentToRoot'> & { content: string }>;
const adjacent = (a: string | null, b: string) => a !== null && db.prepare(`SELECT 1 FROM memory_relation
  WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)`).get(a, b, b, a) !== undefined;
const consolidationIds = new Set(new ConsolidationRepository(db).findEpisodicCandidates(undefined).map(row => row.id));
const coverage = (row: { relationRoot: string | null; oldId: string }) => Number(!!row.relationRoot) + Number(consolidationIds.has(row.oldId));
// 사람이 몇 건만 고르듯, 관계가 있는 짝을 먼저 고르되 타입별 절반을 넘기지 않고 한 기억이 두 번 쓰이지 않게 한다.
const ranked = rows
  .map(row => {
    const root = relationRoot(row.oldId, row.newId);
    return { ...row, query: row.content.slice(0, 300), relationRoot: root, newAdjacentToRoot: adjacent(root, row.newId) };
  })
  .sort((a, b) => coverage(b) - coverage(a) || a.oldId.localeCompare(b.oldId));
const used = new Set<string>();
const pairs: Pair[] = [];
const perType = Math.ceil(APPROVE / 2);
for (const row of ranked) {
  if (pairs.length >= APPROVE || used.has(row.oldId) || used.has(row.newId)) continue;
  if (pairs.filter(pair => pair.type === row.type).length >= perType) continue;
  used.add(row.oldId).add(row.newId);
  const { content: _content, ...pair } = row;
  pairs.push(pair);
}
assert.ok(pairs.length > 0, 'no applicable supersede candidate on the copy');

const foreignProject = (projectId: string | null) => (db.prepare(`SELECT project_id FROM memory_item
  WHERE project_id IS NOT NULL AND project_id IS NOT ? AND COALESCE(is_deleted, 0) = 0
  GROUP BY project_id ORDER BY COUNT(*) DESC LIMIT 1`).get(projectId) as { project_id: string }).project_id;

const services = createSearchEmbeddingAndOptimizerServices(db, sqliteRepositoryProvider);
const anchors = await createAnchorStack(db, services.embeddingService, services.hybridSearchEngine, new ErrorLoggingService());
const toolServices = { ...services, vectorSearchEngine: anchors.vectorSearchEngine, anchorManager: anchors.anchorManager, relationGraph: createRelationGraph(db) };
const boundProject = (pair: Pair, view: View) => view === 'foreign' ? foreignProject(pair.projectId) : pair.projectId ?? undefined;
const context = (pair: Pair, view: View) => ({ db, services: toolServices, boundProjectId: boundProject(pair, view) });
/** Mirrors scopeArgsToBoundAgent in the MCP dispatcher: a project-bound token forces project_id onto every tool call. Tool input is untyped at that boundary. */
const scoped = (pair: Pair, view: View, args: Record<string, unknown>): never => {
  const project = boundProject(pair, view);
  return (project ? { ...args, project_id: project } : args) as never;
};
const json = (result: { content: Array<{ text?: string }> }) => JSON.parse(result.content[0]!.text!);
const idsIn = (value: unknown, pair: Pair) => [pair.oldId, pair.newId].filter(id => JSON.stringify(value).includes(id));
const contentOf = (id: string) => db.prepare('SELECT content FROM memory_item WHERE id = ?').pluck().get(id) as string;
/** 질의가 old 본문이라 응답의 질의 줄(formatMemoryPrompt 의 검색 쿼리 줄)을 빼야 본문 일치가 의미를 가진다. */
const withoutQueryEcho = (message: string) => message.split('\n').filter(line => !line.startsWith('**검색 쿼리**')).join('\n');
const snippet = (id: string) => contentOf(id).trim().split('\n')[0]!.trim().slice(0, 40);
/** memory_injection 의 promptText 는 id 대신 본문을 싣는다. 본문 첫 줄 앞부분으로 찾고, 두 본문이 같은 줄로 시작하면 가릴 수 없어 null 이다. */
const idsByContent = (text: string, pair: Pair) => snippet(pair.oldId) === snippet(pair.newId) ? null
  : [pair.oldId, pair.newId].filter(id => text.includes(snippet(id)));
const recall = (extra: Record<string, unknown>): Probe => async (pair, view) => {
  const result = json(await new RecallTool().handle(scoped(pair, view, { query: pair.query, type: pair.type, limit: K, ...extra, include_superseded: view === 'history' }), context(pair, view) as never));
  return (result.items as Array<{ id: string }>).map(item => item.id);
};
const anchorAgent = (pair: Pair) => `${ACTOR}-${pairs.indexOf(pair)}`;

const probes: Record<string, Probe> = {
  recall_hybrid: recall({}),
  recall_text: recall({ enable_hybrid: false }),
  recall_vector: recall({ vector_weight: 1, text_weight: 0 }),
  memory_injection: async (pair, view) => view === 'history' ? null
    : idsByContent(withoutQueryEcho(json(await new MemoryInjectionPrompt().handle(scoped(pair, view, { query: pair.query, memory_types: [pair.type], max_memories: K, importance_threshold: 0, token_budget: 8000 }), context(pair, view) as never)).message), pair),
  resource_read: async (pair, view) => {
    const project = boundProject(pair, view);
    const scope = project ? { project_id: project } : {};
    return [pair.oldId, pair.newId].filter(id => findMemoryResourceRowById(db, id, scope, view === 'history'));
  },
  relations: async (pair, view) => pair.relationRoot === null ? null
    : idsIn(json(await new GetRelationsTool().handle(scoped(pair, view, { memory_id: pair.relationRoot, limit: 1000, include_superseded: view === 'history' }), context(pair, view) as never)), pair),
  relation_bfs: async (pair, view) => pair.relationRoot === null || view !== 'current' ? null
    : (await new RelationGraphTraversal(db).getRelatedMemories(pair.relationRoot, { maxHops: 2 })).map(row => row.memory_id),
  neighbors: async (pair, view) => {
    if (view === 'history') return null;
    const result = await new GetMemoryNeighborsTool().handle(scoped(pair, view, { memory_id: pair.newId, limit: 20 }), context(pair, view) as never)
      .then(json, (error: Error) => { if (/not found|찾을 수 없습니다/.test(error.message)) return null; throw error; });
    return result === null ? [] : [pair.newId, ...idsIn(result.neighbors, pair)];
  },
  anchor: async (pair, view) => view !== 'current' ? null
    : [(await anchors.anchorManager.getAnchor(anchorAgent(pair), 'A') as { memory_id?: string } | null)?.memory_id ?? ''],
  consolidation_candidates: async (pair, view) => pair.type !== 'episodic' || view !== 'current' ? null
    : new ConsolidationRepository(db).findEpisodicCandidates(undefined).map(row => row.id),
};

type Cell = { old: boolean; new: boolean; count: number } | null;
const matrix: Record<Phase, Record<string, Record<View, Cell>>[]> = { before: [], applied: [], restored: [] };
async function measure(phase: Phase) {
  for (const pair of pairs) {
    const byProbe: Record<string, Record<View, Cell>> = {};
    for (const [name, probe] of Object.entries(probes)) {
      byProbe[name] = {} as Record<View, Cell>;
      for (const view of ['current', 'history', 'foreign'] as const) {
        const ids = await probe(pair, view);
        byProbe[name]![view] = ids === null ? null : { old: ids.includes(pair.oldId), new: ids.includes(pair.newId), count: ids.length };
      }
    }
    matrix[phase].push(byProbe);
  }
}

const touching = (id: string) => ({
  relations: db.prepare('SELECT COUNT(*) FROM memory_relation WHERE source_id = ? OR target_id = ?').pluck().get(id, id),
  // memory_injection 이 'default' agent 에 자동 앵커를 걸어 그 행은 읽기 부작용으로 바뀐다. 하네스가 건 앵커만 센다.
  anchors: db.prepare(`SELECT COUNT(*) FROM anchor WHERE memory_id = ? AND agent_id LIKE '${ACTOR}-%'`).pluck().get(id),
});

for (const pair of pairs) await anchors.anchorManager.setAnchor(anchorAgent(pair), pair.oldId, 'A');
const rowsBefore = pairs.map(pair => touching(pair.oldId));
await measure('before');
const applyOutcomes = pairs.map(pair => applySupersedeCandidate(db, { candidateId: pair.candidateId, actor: ACTOR, reason: 'issue-1614' }));
const reapply = applySupersedeCandidate(db, { candidateId: pairs[0]!.candidateId, actor: ACTOR });
await measure('applied');
const wrongRestore = restoreSupersededMemory(db, { oldMemoryId: pairs[0]!.oldId, expectedNewMemoryId: pairs[0]!.oldId, actor: ACTOR });
const restoreOutcomes = pairs.map(pair => restoreSupersededMemory(db, { oldMemoryId: pair.oldId, expectedNewMemoryId: pair.newId, actor: ACTOR, reason: 'issue-1614' }));
await measure('restored');
const rowsAfter = pairs.map(pair => touching(pair.oldId));
const events = pairs.map(pair => db.prepare(`SELECT action, actor, candidate_id IS NOT NULL AS hasCandidate,
  old_content_sha256 IS NOT NULL AND new_content_sha256 IS NOT NULL AS hasHashes
  FROM memory_supersede_event WHERE old_memory_id = ? ORDER BY created_at, rowid`).all(pair.oldId));

const failures: string[] = [];
const expect = (ok: boolean, message: string) => { if (!ok) failures.push(message); };
pairs.forEach((pair, i) => {
  expect(applyOutcomes[i]!.kind === 'applied', `pair ${i} apply ${JSON.stringify(applyOutcomes[i])}`);
  expect(restoreOutcomes[i]!.kind === 'restored', `pair ${i} restore ${JSON.stringify(restoreOutcomes[i])}`);
  expect(JSON.stringify(rowsBefore[i]) === JSON.stringify(rowsAfter[i]), `pair ${i} relation/anchor rows changed`);
  expect(JSON.stringify(events[i]!.map(e => (e as { action: string }).action)) === '["applied","restored"]', `pair ${i} events ${JSON.stringify(events[i])}`);
  for (const name of Object.keys(probes)) {
    const cellsAt = (phase: Phase) => matrix[phase][i]![name]!;
    const before = cellsAt('before'), applied = cellsAt('applied'), restored = cellsAt('restored');
    for (const view of ['current', 'history', 'foreign'] as const) {
      const b = before[view], a = applied[view], r = restored[view];
      if (!b || !a || !r) continue;
      if (view === 'foreign') expect(!b.old && !b.new && !a.old && !a.new && !r.old && !r.new, `pair ${i} ${name} scope leak`);
      if (view === 'current' && b.old) expect(!a.old, `pair ${i} ${name} stale exposure`);
      if (view === 'current' && b.new && (name !== 'relation_bfs' || pair.newAdjacentToRoot)) expect(a.new, `pair ${i} ${name} lost fresh`);
      if (view === 'history' && b.old) expect(a.old, `pair ${i} ${name} history lost`);
      expect(r.old === b.old && r.new === b.new, `pair ${i} ${name} ${view} not restored`);
    }
  }
});
expect(reapply.kind === 'already_applied', `reapply ${JSON.stringify(reapply)}`);
expect(wrongRestore.kind === 'rejected', `wrong restore ${JSON.stringify(wrongRestore)}`);

const setPointers = (on: boolean) => {
  const update = db.prepare('UPDATE memory_item SET superseded_by = ? WHERE id = ?');
  db.transaction(() => { for (const pair of pairs) update.run(on ? pair.newId : null, pair.oldId); })();
};
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!;
async function compare(warmup: number, samples: number, run: () => unknown) {
  const times: Record<'off' | 'on', number[]> = { off: [], on: [] };
  for (let i = 0; i < warmup + samples; i++) {
    for (const state of (i % 2 ? ['on', 'off'] : ['off', 'on']) as Array<'off' | 'on'>) {
      setPointers(state === 'on');
      const started = performance.now();
      await run();
      if (i >= warmup) times[state].push(performance.now() - started);
    }
  }
  setPointers(false);
  const stats = (values: number[]) => ({ p50_ms: percentile(values, 0.5), p95_ms: percentile(values, 0.95) });
  return { off: stats(times.off), on: stats(times.on), p95Ratio: percentile(times.on, 0.95) / percentile(times.off, 0.95) };
}

const vectorRow = db.prepare(`SELECT embedding FROM memory_embedding WHERE memory_id = ? AND projection_type = 'native' ORDER BY id DESC LIMIT 1`).get(pairs[0]!.oldId) as { embedding: Buffer };
const queryVector = embeddingColumnToNumbers(vectorRow.embedding)!;
const knn = (target: Db, scope: Record<string, unknown> = {}) => executeKnnQuery({
  db: target, effectiveQueryVector: queryVector,
  runtimeContext: { provider: 'minilm', tableName: 'memory_item_vec_minilm', modelFilter: null, expectedDimensions: 384, actualStoredDimensions: 384, targetDimensions: 384 },
  scope, options: { limit: 10, threshold: 0, includeContent: true },
});
const knnPlan = (on: boolean) => {
  setPointers(on);
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  knn({ prepare: (sql: string) => {
    const statement = db.prepare(sql);
    return { get: (...p: unknown[]) => statement.get(...p), all: (...p: unknown[]) => { statements.push({ sql, params: p }); return statement.all(...p); } };
  } } as never);
  setPointers(false);
  const last = statements.at(-1)!;
  return (db.prepare(`EXPLAIN QUERY PLAN ${last.sql}`).all(...last.params) as Array<{ detail: string }>).map(row => row.detail);
};
const hybrid = services.hybridSearchEngine;
const perf = {
  livePointersOn: pairs.length,
  corpusRows: db.prepare('SELECT COUNT(*) FROM memory_item WHERE COALESCE(is_deleted, 0) = 0').pluck().get(),
  knnSql: await compare(20, 100, () => knn(db)),
  // project 범위 요청은 포인터가 없어도 이미 rowid 사전 필터 경로를 탄다.
  knnSqlProjectScoped: await compare(20, 100, () => knn(db, { project_id: foreignProject(null) })),
  hybridSearchWallPerQuery: await compare(5, 100, (() => {
    let next = 0;
    return () => hybrid.search(db, { query: pairs[next++ % pairs.length]!.query, limit: K });
  })()),
  knnPlanOff: knnPlan(false),
  knnPlanOn: knnPlan(true),
};

const summary = Object.fromEntries(Object.keys(probes).map(name => {
  const cells = (phase: Phase, view: View) => matrix[phase].map(row => row[name]![view]);
  const count = (phase: Phase, view: View, test: (cell: NonNullable<Cell>) => boolean) => cells(phase, view).filter(cell => cell && test(cell)).length;
  return [name, {
    pairsApplicable: cells('before', 'current').filter(Boolean).length,
    oldVisibleBefore: count('before', 'current', cell => cell.old),
    oldVisibleAfterApply: count('applied', 'current', cell => cell.old),
    newVisibleBefore: count('before', 'current', cell => cell.new),
    newVisibleAfterApply: count('applied', 'current', cell => cell.new),
    historyOldAfterApply: count('applied', 'history', cell => cell.old),
    foreignLeaks: (['before', 'applied', 'restored'] as const).reduce((sum, phase) => sum + count(phase, 'foreign', cell => cell.old || cell.new), 0),
    oldVisibleAfterRestore: count('restored', 'current', cell => cell.old),
  }];
}));

process.stdout.write(`${JSON.stringify({
  dbPath, candidateSource, k: K, summary,
  pairs: pairs.map(({ query: _query, ...pair }) => pair),
  applyOutcomes, reapply, wrongRestore, restoreOutcomes, rowsBefore, rowsAfter, events,
  matrix, perf, failures,
}, null, 2)}\n`);
db.close();
process.exitCode = failures.length > 0 ? 1 : 0;
