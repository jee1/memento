/**
 * #961 nightly: long near-clone distractors must enter the vector channel.
 * Gated by VITEST_INCLUDE_NIGHTLY (excluded from PR CI via vitest.base.ts).
 *
 * Two kinds of assertion live here and they fail for different reasons (#1103):
 *
 *  (A) instrument liveness — does the distractor reach the vector channel at all?
 *      Rebaselined 2026-09-23 on an honest seed (minilm native 3,461 + window 154)
 *      with a pass-through weight calculator. Until then this file never measured
 *      the vector channel at all: it asked for vectorWeight 1 / textWeight 0 and
 *      AdaptiveWeightCalculator rewrote that to 0.8 / 0.2 for every multi-word
 *      query, so documents could enter through FTS with vectorScore 0. That is why
 *      0011 used to flip between vectorScore 0.2029604979788522 and 0 across runs.
 *      With the rewrite gone, two consecutive runs are identical.
 *
 *      MAXSIM_BASELINE below is the engine-independent truth: max-sim cosine rank
 *      over all 3,461 corpus documents, computed from the stored minilm vectors
 *      (native + window:N) with no prefetch, no FTS and no length decay. #1112
 *      removed the mean-pooling ceiling — every distractor now carries 8-10 window
 *      vectors — but that did not make them competitive. The best is 0008 at rank
 *      18; 0002 (2085) and 0004 (2575) are nowhere near their queries. After #973
 *      removed the answer-key leak these bodies are simply not near-clones of the
 *      questions they are paired with.
 *
 *      At limit 20 the KNN prefetch is resolveVectorPrefetchLimit(20) = 160 rows,
 *      so anything ranked past that cannot even become a candidate. 0001 (rank 66)
 *      does become one and still loses to the k=40 length decay. Only 0008 and 0010
 *      survive into the top 20, and REACHES_TOP_20 records exactly that.
 *
 *      The other six assert distractorIdx === -1. That is a tripwire, not an
 *      exemption: if a fixture or ranking change makes one of them reachable the
 *      assertion goes red and forces a new measurement. Do not retune thresholds
 *      and do not widen REACHES_TOP_20 to make anything green.
 *
 *  (B) product ranking — answer above distractor, and no cross-contamination.
 *      Real ranking defects. Tracked in #922 / #1095. Do not relax these.
 *      Measuring the vector channel honestly moved one failure and removed another:
 *      0010 no longer contaminates other short queries (that was the text channel),
 *      and the answer for 0009 now surfaces. The 0011 pair still fails.
 *
 * Seeding: scripts/seed-benchmark-db.ts imports @memento/core from dist, and only
 * vitest maps that specifier to src. Seeding without `npm run build -w @memento/core`
 * first produces no window rows at all, and this file then measures pre-#1112
 * behaviour with no error to say so. benchmark-search-database.ts fails closed on
 * that since #1103.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type Database from 'better-sqlite3';
import {
  closeDatabase,
  initializeDatabase,
} from '../../../../infrastructure/database/sqlite/init.js';
import { createSeededBenchmarkDatabase } from '../../../../../../../scripts/lib/benchmark-search-database.js';
import { HybridSearchFactory } from '../../../search/factories/hybrid-search.factory.js';
import type { IAdaptiveWeightCalculator, HybridWeights } from '../../../search/algorithms/hybrid-search-types.js';
import { resetRankingWeightsCache } from '../../../../shared/config/ranking-weights-loader.js';
import { getBenchmarkVectorProviderFilter } from '../../../../shared/types/benchmark.types.js';
import {
  loadBenchmarkCorpus,
  loadBenchmarkGroundTruth,
} from './search-quality-benchmark-fixtures.js';

// vitest.setup.ts mocks these; real MiniLM required for vector reach assertions (#889 pattern).
vi.unmock('@huggingface/transformers');
vi.unmock('onnxruntime-node');

const ROOT = process.cwd();
const BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
const BASE_TOML = join(ROOT, 'config/ranking-weights.toml');

const PAIRS: Array<{
  query: string;
  distractorId: string;
  answerId: string;
}> = [
  {
    query: 'HTTP 서버 에러 처리',
    distractorId: 'bench_syn_long_0001',
    answerId: 'bench_syn_ans_0001',
  },
  {
    query: '검색 품질 측정 방법',
    distractorId: 'bench_syn_long_0002',
    answerId: 'bench_syn_ans_0002',
  },
  {
    query: '재시도 전략 RetryManager',
    distractorId: 'bench_syn_long_0003',
    answerId: 'bench_syn_ans_0006',
  },
  {
    query: '이 프로젝트의 코드 스타일과 린트 규칙은 무엇인가',
    distractorId: 'bench_syn_long_0004',
    answerId: 'bench_syn_ans_0007',
  },
  {
    query: 'FTS5 마이그레이션 fallback',
    distractorId: 'bench_syn_long_0008',
    answerId: 'bench_syn_ans_0004',
  },
  {
    query: 'docker 컨테이너가 readonly database 로 죽은 원인',
    distractorId: 'bench_syn_long_0009',
    answerId: 'bench_syn_long_0005',
  },
  {
    query: '마이그레이션 실패 시 롤백은 어떤 순서로 하나',
    distractorId: 'bench_syn_long_0010',
    answerId: 'bench_syn_long_0006',
  },
  {
    query: '임베딩 provider를 바꾸려면 어떤 설정을 건드리나',
    distractorId: 'bench_syn_long_0011',
    answerId: 'bench_syn_long_0007',
  },
];

/**
 * 호출자가 준 가중치를 그대로 쓴다 (#1103).
 *
 * AdaptiveWeightCalculator 는 `isPhrase`(3단어 이상) 분기에서 vectorWeight 1 / textWeight 0 을
 * 0.8 / 0.2 로 다시 쓴다. 그러면 이 파일이 재는 것은 벡터 채널이 아니라 하이브리드 결과가 되고,
 * 문서가 FTS 로 들어와 vectorScore 0 을 갖는 일이 생긴다.
 */
class PassThroughWeightCalculator implements IAdaptiveWeightCalculator {
  calculateWeights(_query: string, vectorWeight: number, textWeight: number): HybridWeights {
    const total = vectorWeight + textWeight;
    if (total === 0) return { vectorWeight: 1, textWeight: 0 };
    return { vectorWeight: vectorWeight / total, textWeight: textWeight / total };
  }
}

/**
 * 2026-09-23 실측 — 엔진 비경유 max-sim 코사인 순위(코퍼스 3,461건)와 그 점수.
 * 저장된 minilm 벡터(native + window:N)만 쓴다. 프리페치·FTS·길이 감쇠 없음.
 * 재현: core 빌드 후 시드하면 native 3,461 / window 154 행이 나온다.
 */
const MAXSIM_BASELINE: Record<string, { rank: number; score: number; windows: number }> = {
  bench_syn_long_0001: { rank: 66, score: 0.4116, windows: 9 },
  bench_syn_long_0002: { rank: 2085, score: 0.1785, windows: 8 },
  bench_syn_long_0003: { rank: 180, score: 0.4223, windows: 9 },
  bench_syn_long_0004: { rank: 2575, score: 0.3129, windows: 8 },
  bench_syn_long_0008: { rank: 18, score: 0.4336, windows: 8 },
  bench_syn_long_0009: { rank: 340, score: 0.4601, windows: 10 },
  bench_syn_long_0010: { rank: 37, score: 0.5055, windows: 10 },
  bench_syn_long_0011: { rank: 266, score: 0.3446, windows: 9 },
};

/**
 * 2026-09-23 실측 — limit 20 · k=40 · 통과형 가중치에서 top-20 에 실제로 남는 디스트랙터.
 * 2회 연속 실행이 동일했다. 초록을 만들려고 여기에 id 를 더하지 마라.
 */
const REACHES_TOP_20 = new Set(['bench_syn_long_0008', 'bench_syn_long_0010']);

describe.runIf(process.env.VITEST_INCLUDE_NIGHTLY === '1')(
  'long distractor vector reach (#961)',
  () => {
    let close: (() => void) | undefined;
    let db: Database.Database;
    let sourceByBenchmark = new Map<string, string>();
    let shortOtherQueries: string[] = [];
    let rankingTomlPath = '';

    const applyK40 = () => {
      process.env.MEMENTO_RANKING_WEIGHTS_PATH = rankingTomlPath;
      resetRankingWeightsCache();
    };

    beforeAll(async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'memento-961-nightly-'));
      rankingTomlPath = join(tmp, 'ranking-k40.toml');
      const patched = readFileSync(BASE_TOML, 'utf8').replace(
        /characteristic_length\s*=\s*\d+/,
        'characteristic_length = 40'
      );
      writeFileSync(rankingTomlPath, patched, 'utf8');
      applyK40();

      // Optional reuse of a persisted seed (plan §10) — skips ~15min minilm seed locally.
      // Nightly CI sets MEMENTO_BENCHMARK_DB_PATH after a single shared seed step.
      const reusePath = process.env.MEMENTO_BENCHMARK_DB_PATH?.trim();
      if (reusePath && existsSync(reusePath)) {
        db = await initializeDatabase(reusePath);
        close = () => closeDatabase(db);
      } else {
        const seeded = await createSeededBenchmarkDatabase(BENCHMARK_DIR);
        db = seeded.db;
        close = seeded.close;
      }
      const corpus = loadBenchmarkCorpus(BENCHMARK_DIR);
      sourceByBenchmark = new Map(corpus.map((e) => [e.benchmark_id, e.source_memory_id]));
      const lenByBid = new Map(corpus.map((e) => [e.benchmark_id, (e.content ?? '').length]));
      const aimed = new Set(PAIRS.map((p) => p.query));
      shortOtherQueries = loadBenchmarkGroundTruth(BENCHMARK_DIR)
        .filter((gt) => {
          const maxLen = Math.max(...gt.relevantIds.map((id) => lenByBid.get(id) ?? 0));
          return maxLen <= 1024 && !aimed.has(gt.queryId);
        })
        .map((gt) => gt.queryId);
    }, 1_800_000);

    afterAll(() => {
      close?.();
      delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
      resetRankingWeightsCache();
    });

    describe('(A) instrument liveness', () => {
      for (const pair of PAIRS) {
        it(`${pair.distractorId} matches its measured vector reach under ${pair.query}`, async () => {
          applyK40();
          // Fresh engine per case — weights must not be cached or rewritten (R4, #1103).
          const engine = HybridSearchFactory.createDefaultEngine(db, undefined, {
            weightCalculator: new PassThroughWeightCalculator(),
          });
          const result = await engine.search(db, {
            query: pair.query,
            limit: 20,
            provider_filter: getBenchmarkVectorProviderFilter(),
            vectorWeight: 1,
            textWeight: 0,
            include_score_breakdown: true,
          });

          const distractorSource = sourceByBenchmark.get(pair.distractorId);
          const answerSource = sourceByBenchmark.get(pair.answerId);
          expect(distractorSource).toBeTruthy();
          expect(answerSource).toBeTruthy();

          const distractorIdx = result.items.findIndex((i) => i.id === distractorSource);
          const answerIdx = result.items.findIndex((i) => i.id === answerSource);
          const baseline = MAXSIM_BASELINE[pair.distractorId]!;
          const why = `${pair.distractorId}: max-sim rank ${baseline.rank}/3461 (score ${baseline.score}, ${baseline.windows} windows), KNN prefetch at limit 20 is 160 rows`;

          if (!REACHES_TOP_20.has(pair.distractorId)) {
            // Tripwire, not an exemption (#1103). If this goes red the distractor
            // became reachable — re-measure and rewrite the baseline, do not delete
            // the assertion.
            expect(distractorIdx, why).toBe(-1);
            return;
          }

          expect(distractorIdx, why).toBeGreaterThanOrEqual(0);
          expect(answerIdx).toBeGreaterThanOrEqual(0);

          const distractor = result.items[distractorIdx]!;

          expect(distractor.vectorScore).toBeGreaterThan(0);
          expect(distractorIdx).toBeLessThan(10);
        });
      }
    });

    describe('(B) product ranking — answer above distractor', () => {
      for (const pair of PAIRS) {
        it(`${pair.answerId} outranks ${pair.distractorId} under ${pair.query}`, async () => {
          applyK40();
          // Fresh engine per case — weights must not be cached or rewritten (R4, #1103).
          const engine = HybridSearchFactory.createDefaultEngine(db, undefined, {
            weightCalculator: new PassThroughWeightCalculator(),
          });
          const result = await engine.search(db, {
            query: pair.query,
            limit: 20,
            provider_filter: getBenchmarkVectorProviderFilter(),
            vectorWeight: 1,
            textWeight: 0,
            include_score_breakdown: true,
          });

          const distractorSource = sourceByBenchmark.get(pair.distractorId);
          const answerSource = sourceByBenchmark.get(pair.answerId);
          expect(distractorSource).toBeTruthy();
          expect(answerSource).toBeTruthy();

          const distractorIdx = result.items.findIndex((i) => i.id === distractorSource);
          const answerIdx = result.items.findIndex((i) => i.id === answerSource);
          // The answer must be retrievable at all — that is a product requirement.
          expect(answerIdx).toBeGreaterThanOrEqual(0);
          // A distractor that never reached the candidate set is not competing for
          // rank. That is (A)'s problem (#1103), not a ranking defect — skip here.
          if (distractorIdx < 0) {
            return;
          }

          const distractor = result.items[distractorIdx]!;
          const answer = result.items[answerIdx]!;

          // Always: no GT pollution at k=40 (answer above distractor).
          expect(answerIdx).toBeLessThan(distractorIdx);
          expect(answer.finalScore).toBeGreaterThanOrEqual(distractor.finalScore);
        });
      }
    });

    describe('(B) product ranking — tracked in #922 / #1095', () => {
      for (const pair of PAIRS) {
        it(`${pair.distractorId} does not top-10 other short queries (cross-contam)`, async () => {
          applyK40();
          const distractorSource = sourceByBenchmark.get(pair.distractorId);
          expect(distractorSource).toBeTruthy();

          const hits: string[] = [];
          for (const query of shortOtherQueries) {
            const engine = HybridSearchFactory.createDefaultEngine(db, undefined, {
              weightCalculator: new PassThroughWeightCalculator(),
            });
            const result = await engine.search(db, {
              query,
              limit: 20,
              provider_filter: getBenchmarkVectorProviderFilter(),
              vectorWeight: 1,
              textWeight: 0,
              include_score_breakdown: true,
            });
            const idx = result.items.findIndex((i) => i.id === distractorSource);
            if (idx >= 0 && idx < 10 && (result.items[idx]!.vectorScore ?? 0) > 0) {
              hits.push(`${query.slice(0, 40)}@r${idx}`);
            }
          }
          expect(hits, `cross-contam top-10 hits: ${hits.join('; ')}`).toEqual([]);
        });
      }
    });
  }
);
