# Search Quality Benchmark Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 현재 전체 기억을 고정 스냅샷 benchmark corpus로 export하고, 사람 라벨링 Ground Truth를 기반으로 검색 품질을 CI에서 재현 가능하게 검증한다.

**Architecture:** 라이브 DB를 직접 품질 측정에 쓰지 않고, 전체 기억 스냅샷을 `tests/fixtures/search-quality/benchmark-v1/` 아래에 고정한다. 품질 측정 코드는 strict benchmark fixture를 명시적으로 로드하고, fixture가 없거나 자동 생성 데이터면 즉시 실패한다. Ground Truth는 사람이 query별 relevantIds를 확정하며, 스크립트는 라벨링 후보군 생성까지만 자동화한다.

**Tech Stack:** TypeScript, Vitest, tsx CLI scripts, SQLite, existing hybrid search quality helpers

---

### Task 1: Canonical source tree 확인 및 strict benchmark loader 추가

**Files:**
- Create: `src/test/helpers/search-quality-benchmark-fixtures.ts`
- Test: `src/test/helpers/search-quality-benchmark-fixtures.spec.ts`
- Modify: `src/test/helpers/vector-search-quality-metrics.ts`
- Mirror if needed: `packages/memento-core/src/test/helpers/search-quality-benchmark-fixtures.ts`
- Mirror if needed: `packages/memento-core/src/test/helpers/vector-search-quality-metrics.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  assertStrictBenchmark,
  loadBenchmarkManifest,
} from './search-quality-benchmark-fixtures.js';

describe('search-quality-benchmark-fixtures', () => {
  it('throws when strict benchmark manifest is missing', () => {
    expect(() => loadBenchmarkManifest('/tmp/does-not-exist')).toThrow(/manifest/i);
  });

  it('rejects auto generated benchmark in strict mode', () => {
    expect(() => assertStrictBenchmark({
      benchmark_version: 'v1',
      strict_ci: false,
      source: 'auto-generated',
    } as never)).toThrow(/strict benchmark/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest --run src/test/helpers/search-quality-benchmark-fixtures.spec.ts`
Expected: FAIL with module/function-not-found errors.

**Step 3: Write minimal implementation**

```ts
export interface BenchmarkManifest {
  benchmark_version: string;
  created_at: string;
  corpus_size: number;
  query_count: number;
  ground_truth_count: number;
  source: 'full-memory-snapshot' | 'auto-generated' | string;
  labeling_policy: 'binary-human-labeled' | string;
  strict_ci: boolean;
}

export function loadBenchmarkManifest(benchmarkDir: string): BenchmarkManifest {
  const manifestPath = join(benchmarkDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Benchmark manifest not found: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as BenchmarkManifest;
}

export function assertStrictBenchmark(manifest: BenchmarkManifest): void {
  if (!manifest.strict_ci || manifest.source !== 'full-memory-snapshot') {
    throw new Error('Strict benchmark requires a human-labeled full-memory-snapshot manifest');
  }
}
```

Also add fixture loaders for `queries.json`, `ground-truth.json`, and `corpus.jsonl`, then update `src/test/helpers/vector-search-quality-metrics.ts` so any new strict path uses these loaders instead of `data/` defaults.

**Step 4: Run test to verify it passes**

Run: `npx vitest --run src/test/helpers/search-quality-benchmark-fixtures.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/test/helpers/search-quality-benchmark-fixtures.ts src/test/helpers/search-quality-benchmark-fixtures.spec.ts src/test/helpers/vector-search-quality-metrics.ts packages/memento-core/src/test/helpers/search-quality-benchmark-fixtures.ts packages/memento-core/src/test/helpers/vector-search-quality-metrics.ts
git commit -m "feat: add strict search benchmark fixture loaders"
```

### Task 2: 전체 기억 스냅샷 exporter 추가

**Files:**
- Create: `src/test/helpers/search-quality-benchmark-builder.ts`
- Test: `src/test/helpers/search-quality-benchmark-builder.spec.ts`
- Create: `scripts/export-search-quality-benchmark.ts`
- Modify: `package.json`
- Mirror if needed: `packages/memento-core/src/test/helpers/search-quality-benchmark-builder.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildBenchmarkCorpus } from './search-quality-benchmark-builder.js';

describe('buildBenchmarkCorpus', () => {
  it('assigns stable benchmark ids in input order', () => {
    const corpus = buildBenchmarkCorpus([
      { id: 'mem_b', type: 'semantic', content: 'B' },
      { id: 'mem_a', type: 'episodic', content: 'A' },
    ] as never);

    expect(corpus[0]?.benchmark_id).toBe('bench_mem_000001');
    expect(corpus[1]?.benchmark_id).toBe('bench_mem_000002');
    expect(corpus[0]?.source_memory_id).toBe('mem_b');
  });

  it('drops empty-content memories', () => {
    const corpus = buildBenchmarkCorpus([
      { id: 'mem_1', type: 'semantic', content: '   ' },
      { id: 'mem_2', type: 'semantic', content: 'kept' },
    ] as never);

    expect(corpus).toHaveLength(1);
    expect(corpus[0]?.source_memory_id).toBe('mem_2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest --run src/test/helpers/search-quality-benchmark-builder.spec.ts`
Expected: FAIL because builder does not exist yet.

**Step 3: Write minimal implementation**

```ts
export interface BenchmarkCorpusEntry {
  benchmark_id: string;
  source_memory_id: string;
  type: string;
  tags: string[];
  created_at?: string;
  content: string;
}

export function buildBenchmarkCorpus(rows: Array<{
  id: string;
  type: string;
  tags?: string[];
  created_at?: string;
  content: string;
}>): BenchmarkCorpusEntry[] {
  return rows
    .filter((row) => row.content.trim().length > 0)
    .map((row, index) => ({
      benchmark_id: `bench_mem_${String(index + 1).padStart(6, '0')}`,
      source_memory_id: row.id,
      type: row.type,
      tags: row.tags ?? [],
      created_at: row.created_at,
      content: row.content,
    }));
}
```

In `scripts/export-search-quality-benchmark.ts`, read all memories from the current DB, transform them with `buildBenchmarkCorpus`, and write:
- `tests/fixtures/search-quality/benchmark-v1/corpus.jsonl`
- `tests/fixtures/search-quality/benchmark-v1/manifest.json`

Add a package script:

```json
{
  "scripts": {
    "quality:benchmark:export": "tsx scripts/export-search-quality-benchmark.ts"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest --run src/test/helpers/search-quality-benchmark-builder.spec.ts`
Expected: PASS

Then dry-run the exporter:

Run: `npm run quality:benchmark:export -- --output-dir tests/fixtures/search-quality/benchmark-v1 --dry-run`
Expected: summary showing total memories, kept memories, dropped memories, output paths.

**Step 5: Commit**

```bash
git add src/test/helpers/search-quality-benchmark-builder.ts src/test/helpers/search-quality-benchmark-builder.spec.ts scripts/export-search-quality-benchmark.ts package.json packages/memento-core/src/test/helpers/search-quality-benchmark-builder.ts
git commit -m "feat: export full-memory search benchmark corpus"
```

### Task 3: 사람 라벨링용 candidate generator 추가

**Files:**
- Create: `src/test/helpers/search-quality-candidate-builder.ts`
- Test: `src/test/helpers/search-quality-candidate-builder.spec.ts`
- Create: `scripts/generate-search-quality-candidates.ts`
- Modify: `package.json`
- Create: `tests/fixtures/search-quality/benchmark-v1/queries.json`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mergeCandidateIds } from './search-quality-candidate-builder.js';

describe('mergeCandidateIds', () => {
  it('deduplicates ranked ids while preserving first-seen order', () => {
    const ids = mergeCandidateIds([
      ['bench_mem_000003', 'bench_mem_000001'],
      ['bench_mem_000001', 'bench_mem_000002'],
      ['bench_mem_000004'],
    ]);

    expect(ids).toEqual([
      'bench_mem_000003',
      'bench_mem_000001',
      'bench_mem_000002',
      'bench_mem_000004',
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest --run src/test/helpers/search-quality-candidate-builder.spec.ts`
Expected: FAIL because helper does not exist yet.

**Step 3: Write minimal implementation**

```ts
export function mergeCandidateIds(groups: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const group of groups) {
    for (const id of group) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
  }

  return merged;
}
```

In `scripts/generate-search-quality-candidates.ts`:
- read `queries.json`
- run current search engine for each query
- gather top hybrid candidates plus random negatives
- emit `label-candidates.json`
- never write `ground-truth.json` automatically

Add package script:

```json
{
  "scripts": {
    "quality:benchmark:candidates": "tsx scripts/generate-search-quality-candidates.ts"
  }
}
```

Seed `queries.json` with 30-50 human-written queries.

**Step 4: Run test to verify it passes**

Run: `npx vitest --run src/test/helpers/search-quality-candidate-builder.spec.ts`
Expected: PASS

Then run the generator:

Run: `npm run quality:benchmark:candidates -- --benchmark-dir tests/fixtures/search-quality/benchmark-v1 --limit 30 --random-negatives 10`
Expected: `label-candidates.json` created with candidate ids per query.

**Step 5: Commit**

```bash
git add src/test/helpers/search-quality-candidate-builder.ts src/test/helpers/search-quality-candidate-builder.spec.ts scripts/generate-search-quality-candidates.ts package.json tests/fixtures/search-quality/benchmark-v1/queries.json
git commit -m "feat: add search benchmark labeling candidate generator"
```

### Task 4: quality measurement를 strict benchmark fixture 기반으로 전환

**Files:**
- Modify: `src/domains/monitoring/services/quality-assurance/quality-metrics-collector.ts`
- Test: `src/domains/monitoring/services/quality-assurance/quality-metrics-collector.spec.ts`
- Modify: `src/test/test-vector-search-quality-with-consolidation.spec.ts`
- Modify: `package.json`
- Mirror if needed: `packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-metrics-collector.ts`

**Step 1: Write the failing test**

```ts
it('fails in strict benchmark mode when manifest is missing', async () => {
  await expect(
    collector.collectSearchMetrics('ci', {
      benchmarkDir: '/tmp/missing-benchmark',
      strictBenchmark: true,
    })
  ).rejects.toThrow(/benchmark manifest/i);
});

it('fails in strict benchmark mode when no human-labeled ground truth exists', async () => {
  await expect(
    collector.collectSearchMetrics('ci', {
      benchmarkDir: fixtureDirWithAutoGeneratedManifest,
      strictBenchmark: true,
    })
  ).rejects.toThrow(/human-labeled/i);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest --run src/domains/monitoring/services/quality-assurance/quality-metrics-collector.spec.ts`
Expected: FAIL because collector does not understand `benchmarkDir` or `strictBenchmark` yet.

**Step 3: Write minimal implementation**

```ts
async collectSearchMetrics(context = 'default', options?: {
  groundTruths?: GroundTruth[];
  queryResults?: Map<string, SearchResult[]>;
  searchResultPairs?: SearchResultPair[];
  benchmarkDir?: string;
  strictBenchmark?: boolean;
}): Promise<CollectedMetrics> {
  let groundTruths = options?.groundTruths;

  if (options?.benchmarkDir) {
    const manifest = loadBenchmarkManifest(options.benchmarkDir);
    if (options.strictBenchmark) {
      assertStrictBenchmark(manifest);
    }
    groundTruths = loadBenchmarkGroundTruth(options.benchmarkDir);
  }

  if (options?.strictBenchmark && (!groundTruths || groundTruths.length === 0)) {
    throw new Error('Strict benchmark mode requires human-labeled ground truth');
  }

  // existing metric calculation continues here
}
```

Update `test:vector-search-quality:ci` to pass benchmark dir explicitly, for example via env var:

```json
{
  "scripts": {
    "test:vector-search-quality:ci": "MEMENTO_SEARCH_BENCHMARK_DIR=tests/fixtures/search-quality/benchmark-v1 vitest --run --reporter=junit --reporter=json --outputFile.junit=./test-results/vector-search-quality-junit.xml --outputFile.json=./test-results/vector-search-quality-results.json src/test/test-vector-search-quality-with-consolidation.spec.ts"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest --run src/domains/monitoring/services/quality-assurance/quality-metrics-collector.spec.ts`
Expected: PASS

Run: `npm run test:vector-search-quality:ci`
Expected: PASS using fixture benchmark, and FAIL if the fixture directory is removed.

**Step 5: Commit**

```bash
git add src/domains/monitoring/services/quality-assurance/quality-metrics-collector.ts src/domains/monitoring/services/quality-assurance/quality-metrics-collector.spec.ts src/test/test-vector-search-quality-with-consolidation.spec.ts package.json packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-metrics-collector.ts
git commit -m "feat: require strict benchmark fixtures for search quality CI"
```

### Task 5: benchmark fixture seed와 운영 문서 추가

**Files:**
- Create: `tests/fixtures/search-quality/benchmark-v1/manifest.json`
- Create: `tests/fixtures/search-quality/benchmark-v1/corpus.jsonl`
- Create: `tests/fixtures/search-quality/benchmark-v1/queries.json`
- Create: `tests/fixtures/search-quality/benchmark-v1/ground-truth.json`
- Create: `docs/testing/ko/search-quality-benchmarking.md`
- Modify: `docs/operations/ko/scripts-index.md`

**Step 1: Write the failing test**

Add an integration assertion in `src/test/test-vector-search-quality-with-consolidation.spec.ts`:

```ts
it('loads benchmark-v1 fixtures and computes non-zero quality metrics', async () => {
  const benchmarkDir = 'tests/fixtures/search-quality/benchmark-v1';
  const result = await collector.collectSearchMetrics('ci', {
    benchmarkDir,
    strictBenchmark: true,
  });

  expect(result.metadata?.has_ground_truth).toBe(true);
  expect(result.metrics.precision_at_5).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:vector-search-quality`
Expected: FAIL because the benchmark fixture files are not present yet.

**Step 3: Write minimal implementation**

- Export the first real corpus snapshot with `npm run quality:benchmark:export`
- Manually curate `queries.json` (start with 30-50 queries)
- Generate `label-candidates.json`
- Manually author `ground-truth.json`
- Fill `manifest.json` with:

```json
{
  "benchmark_version": "v1",
  "created_at": "2026-03-17T00:00:00.000Z",
  "source": "full-memory-snapshot",
  "labeling_policy": "binary-human-labeled",
  "strict_ci": true,
  "corpus_size": 0,
  "query_count": 0,
  "ground_truth_count": 0
}
```

Document the workflow in `docs/testing/ko/search-quality-benchmarking.md`:
- export corpus
- write queries
- generate candidates
- label relevant ids
- run CI quality test
- refresh benchmark version only with deliberate review

**Step 4: Run test to verify it passes**

Run: `npm run test:vector-search-quality`
Expected: PASS

Run: `npm run test:vector-search-quality:ci`
Expected: PASS with non-zero search-quality metrics.

**Step 5: Commit**

```bash
git add tests/fixtures/search-quality/benchmark-v1 docs/testing/ko/search-quality-benchmarking.md docs/operations/ko/scripts-index.md src/test/test-vector-search-quality-with-consolidation.spec.ts
git commit -m "feat: seed versioned search quality benchmark fixtures"
```

### Final verification

Run these commands in order:

```bash
npm run lint -- --fix
npm run type-check
npx vitest --run src/test/helpers/search-quality-benchmark-fixtures.spec.ts
npx vitest --run src/test/helpers/search-quality-benchmark-builder.spec.ts
npx vitest --run src/test/helpers/search-quality-candidate-builder.spec.ts
npx vitest --run src/domains/monitoring/services/quality-assurance/quality-metrics-collector.spec.ts
npm run test:vector-search-quality
npm run test:vector-search-quality:ci
npm run build
```

Expected:
- lint/type-check/build succeed
- helper/unit tests succeed
- `test:vector-search-quality` succeeds using versioned fixture benchmark
- `test:vector-search-quality:ci` succeeds only when strict benchmark fixture is present and valid
