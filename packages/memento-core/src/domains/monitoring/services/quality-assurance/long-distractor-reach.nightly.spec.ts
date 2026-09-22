/**
 * #961 nightly: long near-clone distractors must enter the vector channel.
 * Gated by VITEST_INCLUDE_NIGHTLY (excluded from PR CI via vitest.base.ts).
 *
 * Two kinds of assertion live here and they fail for different reasons (#1103):
 *
 *  (A) instrument liveness — does the distractor reach the vector channel at all?
 *      #1112 closed #1107 and removed the mean-pooling ceiling: every long
 *      distractor now gets its own window rows (0001→8, 0002→7, 0003→8, 0004→7,
 *      0008→7, 0009→9, 0010→9, 0011→8 on benchmark-v3). Measured 2026-09-22 at
 *      b31843d9: 0008, 0010 and 0011 reach the result list; 0001, 0002, 0003,
 *      0004 and 0009 do not appear in the top 20 at all. What is left is the
 *      distractor text, not the index — after #973 removed the answer-key leak
 *      these bodies are no longer near-clones of their queries.
 *      Do not retune thresholds or re-add exemptions to make these green.
 *
 *      0011 is not stable. Four runs against one seeded DB gave vectorScore
 *      0.2029604979788522, then 0, then two passes. Treat a single green run
 *      here as noise. The likely cause is that this file never measures the
 *      vector channel alone: every search logs AdaptiveWeightCalculator
 *      rewriting the requested vectorWeight 1 / textWeight 0 to 0.8 / 0.2, so a
 *      document can enter result.items through FTS with vectorScore 0. Fixing
 *      that override is a prerequisite for rebaselining (A), and is tracked in
 *      #1103.
 *
 *  (B) product ranking — answer above distractor, and no cross-contamination.
 *      Real ranking defects. Tracked in #922 / #1095. Do not relax these.
 *
 * Seeding: scripts/seed-benchmark-db.ts imports @memento/core from dist, and only
 * vitest maps that specifier to src. Seeding without `npm run build -w @memento/core`
 * first produces no window rows at all, and this file then measures pre-#1112
 * behaviour — 10 failures instead of 8, with no error to say so.
 * benchmark-search-database.ts fails closed on that since #1103.
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
        it(`${pair.distractorId} reaches vector channel under ${pair.query}`, async () => {
          applyK40();
          // Fresh engine per case — AdaptiveWeightCalculator caches by query (R4).
          const engine = HybridSearchFactory.createDefaultEngine(db);
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
          expect(distractorIdx).toBeGreaterThanOrEqual(0);
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
          // Fresh engine per case — AdaptiveWeightCalculator caches by query (R4).
          const engine = HybridSearchFactory.createDefaultEngine(db);
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
            const engine = HybridSearchFactory.createDefaultEngine(db);
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
