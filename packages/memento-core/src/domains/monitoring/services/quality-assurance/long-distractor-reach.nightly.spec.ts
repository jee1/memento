/**
 * #961 nightly: long near-clone distractors must enter the vector channel.
 * Gated by VITEST_INCLUDE_NIGHTLY (excluded from PR CI via vitest.base.ts).
 *
 * Two kinds of assertion live here and they fail for different reasons (#1103):
 *
 *  (A) instrument liveness — does the distractor reach the vector channel at all?
 *      Blocked on #1107: under MiniLM 16-window mean pooling a ~12,000 character
 *      document cannot compete with short ones no matter what it says. Measured:
 *      filling a distractor with nothing but its own query text tops out at
 *      cosine 0.4773 against a rank-40 floor of 0.4416, and a 12,000 character
 *      document built from the 60 most similar real corpus documents scores
 *      0.3094. Five of the eight distractors miss the top 40 at their ceiling.
 *      Do not retune the fixtures to make these green — the ceiling is the
 *      embedder, not the text.
 *
 *  (B) product ranking — answer above distractor, and no cross-contamination.
 *      Real ranking defects. Tracked in #922 / #1095. Do not relax these.
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

/**
 * fill()-only tip cannot clear these queries' corpus top-40 floor without ZWSP/nbsp
 * (린트 rank40≈0.54; 임베딩 answer also cannot clear ≈0.45). Documented C1 misses.
 */
const KNOWN_VECTOR_MISS = new Set(['bench_syn_long_0004', 'bench_syn_long_0011']);

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

    describe('(A) instrument liveness — blocked on #1107', () => {
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

          if (KNOWN_VECTOR_MISS.has(pair.distractorId)) {
            // Honest miss: fill() tip cannot clear top-40 without ZWSP (#961 C1).
            expect(distractor.vectorScore ?? 0).toBe(0);
            return;
          }

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
          // rank. That is (A)'s problem (#1107), not a ranking defect — skip here.
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
