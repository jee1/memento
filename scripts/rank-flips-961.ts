#!/usr/bin/env npx tsx
/**
 * #961 diagnostic: rank flips k40→k320 + long-distractor cross-contamination.
 * Usage: npx tsx scripts/rank-flips-961.ts [dbPath]
 * Requires a seeded benchmark DB (scripts/seed-benchmark-db.ts).
 *
 * Cross-contamination counting (below): any top-10 appearance of an off-target
 * long distractor, regardless of channel (`vectorScore` may be 0). This is a
 * surface-exposure metric for FTS/BM25 leakage too.
 *
 * Nightly gate (`long-distractor-reach.nightly.spec.ts`) only counts hits with
 * `vectorScore > 0` (embedding-channel contamination). A non-zero count here
 * does NOT mean the nightly gate failed — compare criteria before escalating.
 */
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initializeDatabase, closeDatabase } from '@memento/core';
import { HybridSearchFactory } from '../packages/memento-core/src/domains/search/factories/hybrid-search.factory.js';
import { resetRankingWeightsCache } from '@memento/core/shared/config/ranking-weights-loader.js';
import { getBenchmarkVectorProviderFilter } from '../packages/memento-core/src/shared/types/benchmark.types.js';
import {
  loadBenchmarkCorpus,
  loadBenchmarkGroundTruth,
} from '../packages/memento-core/src/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';

const DIR = 'tests/fixtures/search-quality/benchmark-v3';
const LONG = new Set([
  'bench_syn_long_0001',
  'bench_syn_long_0002',
  'bench_syn_long_0003',
  'bench_syn_long_0004',
  'bench_syn_long_0008',
  'bench_syn_long_0009',
  'bench_syn_long_0010',
  'bench_syn_long_0011',
]);

type Mapping = {
  macro_categories: Record<string, string[]>;
  query_overrides?: Record<string, string>;
  query_id_to_category: Record<string, string>;
};

function resolveMacro(mapping: Mapping, queryId: string, category: string): string {
  if (mapping.query_overrides?.[queryId]) return mapping.query_overrides[queryId]!;
  const micro = mapping.query_id_to_category[queryId] ?? category;
  for (const [macro, micros] of Object.entries(mapping.macro_categories)) {
    if (micros.includes(micro)) return macro;
  }
  return '?';
}

function patchK(k: number): void {
  const tmp = mkdtempSync(join(tmpdir(), 'flip-'));
  const toml = join(tmp, `k${k}.toml`);
  writeFileSync(
    toml,
    readFileSync('config/ranking-weights.toml', 'utf8').replace(
      /characteristic_length\s*=\s*\d+/,
      `characteristic_length = ${k}`
    )
  );
  process.env.MEMENTO_RANKING_WEIGHTS_PATH = toml;
  resetRankingWeightsCache();
}

async function main(): Promise<void> {
  const dbPath = process.argv[2] ?? '.local/issue-961/after-v6.db';
  const db = await initializeDatabase(dbPath);
  const corpus = loadBenchmarkCorpus(DIR);
  const src = new Map(corpus.map((e) => [e.benchmark_id, e.source_memory_id]));
  const bidBySrc = new Map(corpus.map((e) => [e.source_memory_id, e.benchmark_id]));
  const lenByBid = new Map(corpus.map((e) => [e.benchmark_id, (e.content ?? '').length]));
  const gt = loadBenchmarkGroundTruth(DIR);
  const mapping = JSON.parse(readFileSync(join(DIR, 'category-mapping.json'), 'utf8')) as Mapping;
  const queries = JSON.parse(readFileSync(join(DIR, 'queries.json'), 'utf8')) as Array<{
    query_id: string;
    query: string;
    category: string;
  }>;

  async function search(k: number, query: string) {
    patchK(k);
    const engine = HybridSearchFactory.createDefaultEngine(db);
    return engine.search(db, {
      query,
      limit: 20,
      provider_filter: getBenchmarkVectorProviderFilter(),
      vectorWeight: 1,
      textWeight: 0,
      include_score_breakdown: true,
    });
  }

  const shortGts = gt.filter((g) => {
    const ansLen = Math.max(...g.relevantIds.map((id) => lenByBid.get(id) ?? 0));
    return ansLen <= 1024;
  });

  console.log('## rank flips (conceptual/procedural short, Δ≠0)');
  console.log('query\tmacro\tansLen\trankA40\trankA320\tdelta\ttopD320\ttop5_k40\ttop5_k320');
  for (const g of shortGts) {
    const qObj = queries.find((q) => q.query === g.queryId || q.query_id === g.queryId);
    if (!qObj) continue;
    const macro = resolveMacro(mapping, qObj.query_id, qObj.category);
    if (macro !== 'conceptual' && macro !== 'procedural') continue;

    const ansLen = Math.max(...g.relevantIds.map((id) => lenByBid.get(id) ?? 0));
    const a40 = await search(40, g.queryId);
    const a320 = await search(320, g.queryId);

    const answerRank = (items: typeof a40.items) => {
      let best = Infinity;
      for (const aid of g.relevantIds) {
        const sid = src.get(aid);
        if (!sid) continue;
        const i = items.findIndex((x) => x.id === sid);
        if (i >= 0 && i < best) best = i;
      }
      return best === Infinity ? -1 : best;
    };

    const r40 = answerRank(a40.items);
    const r320 = answerRank(a320.items);
    const delta = r40 >= 0 && r320 >= 0 ? r320 - r40 : 'na';
    if (delta === 0) continue;

    const topFmt = (items: typeof a40.items) =>
      items.slice(0, 5).map((it, i) => {
        const bid = bidBySrc.get(it.id) ?? it.id;
        return `${i}:${bid}:vec=${(it.vectorScore ?? 0).toFixed(3)}:fin=${(it.finalScore ?? 0).toFixed(3)}`;
      });

    const topD = a320.items
      .map((it, i) => {
        const bid = bidBySrc.get(it.id);
        return bid && LONG.has(bid) ? { rank: i, bid, vec: it.vectorScore ?? 0 } : null;
      })
      .find(Boolean);

    console.log(
      [
        g.queryId.slice(0, 48),
        macro,
        ansLen,
        r40,
        r320,
        delta,
        topD ? `${topD.bid}@r${topD.rank} vec=${topD.vec.toFixed(3)}` : '-',
        topFmt(a40.items).join(' | '),
        topFmt(a320.items).join(' | '),
      ].join('\t')
    );
  }

  console.log('\n## cross-contamination (long distractor top-10 hits outside aimed query)');
  console.log('distractor\taimed_query\toff_target_top10_count\toff_target_queries');
  const aimedByDistractor = new Map([
    ['bench_syn_long_0001', 'HTTP 서버 에러 처리'],
    ['bench_syn_long_0002', '검색 품질 측정 방법'],
    ['bench_syn_long_0003', '재시도 전략 RetryManager'],
    ['bench_syn_long_0004', '이 프로젝트의 코드 스타일과 린트 규칙은 무엇인가'],
    ['bench_syn_long_0008', 'FTS5 마이그레이션 fallback'],
    ['bench_syn_long_0009', 'docker 컨테이너가 readonly database 로 죽은 원인'],
    ['bench_syn_long_0010', '마이그레이션 실패 시 롤백은 어떤 순서로 하나'],
    ['bench_syn_long_0011', '임베딩 provider를 바꾸려면 어떤 설정을 건드리나'],
  ] as Array<[string, string]>);

  for (const [distractorId, aimed] of aimedByDistractor) {
    const sid = src.get(distractorId);
    if (!sid) continue;
    const hits: string[] = [];
    for (const g of shortGts) {
      if (g.queryId === aimed) continue;
      const r = await search(40, g.queryId);
      const idx = r.items.findIndex((it) => it.id === sid);
      if (idx >= 0 && idx < 10) hits.push(`${g.queryId.slice(0, 32)}@r${idx}`);
    }
    console.log(
      [distractorId, aimed.slice(0, 32), hits.length, hits.join('; ') || '-'].join('\t')
    );
  }

  console.log('\n## GT answer vectorScore at k=40 (short subset, vector_dom)');
  console.log('query\tmacro\tansLen\tanswerId\tvectorScore\tfinalScore\trank');
  for (const g of shortGts) {
    const qObj = queries.find((q) => q.query === g.queryId || q.query_id === g.queryId);
    if (!qObj) continue;
    const macro = resolveMacro(mapping, qObj.query_id, qObj.category);
    const ansLen = Math.max(...g.relevantIds.map((id) => lenByBid.get(id) ?? 0));
    const r = await search(40, g.queryId);
    for (const aid of g.relevantIds) {
      const sid = src.get(aid);
      if (!sid) continue;
      const idx = r.items.findIndex((it) => it.id === sid);
      const item = idx >= 0 ? r.items[idx] : undefined;
      console.log(
        [
          g.queryId.slice(0, 48),
          macro,
          ansLen,
          aid,
          item ? (item.vectorScore ?? 0).toFixed(3) : 'ABSENT',
          item ? (item.finalScore ?? 0).toFixed(3) : '-',
          idx,
        ].join('\t')
      );
    }
  }

  closeDatabase(db);
  delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
  resetRankingWeightsCache();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
