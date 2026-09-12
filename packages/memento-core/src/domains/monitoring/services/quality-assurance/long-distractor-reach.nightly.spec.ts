/**
 * #961 nightly: long near-clone distractors must enter the vector channel.
 * Gated by VITEST_INCLUDE_NIGHTLY (excluded from PR CI via vitest.base.ts).
 *
 * Acceptance (k=40, vector_dom):
 * 1) distractor vectorScore > 0 (prefetch top-40 + threshold 0.38)
 * 2) distractor in top-10
 * 3) answer ranks above distractor at k=40 (no GT pollution)
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
import { loadBenchmarkCorpus } from './search-quality-benchmark-fixtures.js';

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

    beforeAll(async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'memento-961-nightly-'));
      const toml = join(tmp, 'ranking-k40.toml');
      const patched = readFileSync(BASE_TOML, 'utf8').replace(
        /characteristic_length\s*=\s*\d+/,
        'characteristic_length = 40'
      );
      writeFileSync(toml, patched, 'utf8');
      process.env.MEMENTO_RANKING_WEIGHTS_PATH = toml;
      resetRankingWeightsCache();

      // Optional reuse of a persisted seed (plan §10) — skips ~15min minilm seed locally.
      // Nightly CI leaves this unset and seeds fresh.
      const reusePath = process.env.MEMENTO_BENCHMARK_DB_PATH?.trim();
      if (reusePath && existsSync(reusePath)) {
        db = await initializeDatabase(reusePath);
        close = () => closeDatabase(db);
      } else {
        const seeded = await createSeededBenchmarkDatabase(BENCHMARK_DIR);
        db = seeded.db;
        close = seeded.close;
      }
      sourceByBenchmark = new Map(
        loadBenchmarkCorpus(BENCHMARK_DIR).map((e) => [e.benchmark_id, e.source_memory_id])
      );
    }, 1_800_000);

    afterAll(() => {
      close?.();
      delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
      resetRankingWeightsCache();
    });

    for (const pair of PAIRS) {
      it(`${pair.distractorId} reaches vector channel under ${pair.query}`, async () => {
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
        const answer = result.items[answerIdx]!;

        expect(distractor.vectorScore).toBeGreaterThan(0);
        expect(distractorIdx).toBeLessThan(10);
        expect(answerIdx).toBeLessThan(distractorIdx);
        expect(answer.finalScore).toBeGreaterThanOrEqual(distractor.finalScore);
      });
    }
  }
);
