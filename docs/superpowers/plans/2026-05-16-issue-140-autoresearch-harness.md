# Issue #140 Autoresearch Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement autoresearch-style search quality tuning harness via 4 issues (#407→#408→#410→#409), each in its own worktree, with a draft PR per issue.

**Architecture:** Issue #407 extends `compare-weight-profiles.ts` with new exports (`ProfileEvalResult`, `calcP95`, `evaluateProfile`). Issue #408 creates `tune-weights.ts` using those exports to run candidate generation and evaluation. Issue #410 creates `tune-report.ts` to report on `tune-weights` run artifacts. Issue #409 wires package.json scripts and .gitignore.

**Tech Stack:** TypeScript, tsx, vitest, @iarna/toml, better-sqlite3, @memento/core internals

---

## Files Overview

| File | Issue | Action |
|------|-------|--------|
| `scripts/compare-weight-profiles.ts` | #407 | Modify — add exports, rename function, add latency/recall |
| `scripts/compare-weight-profiles.spec.ts` | #407 | Modify — add 3 new test cases |
| `scripts/tune-weights.ts` | #408 | Create |
| `scripts/tune-report.ts` | #410 | Create |
| `package.json` | #409 | Modify — 3 new scripts |
| `.gitignore` | #409 | Modify — add `tmp/tune-weights/` |

---

## Issue #407 — compare-weight-profiles.ts 확장

**Worktree:** `git worktree add ../memento-issue-407 -b issue/407-compare-profile-extensions`

### Task 1: Add `ProfileEvalResult` interface and `calcP95` function

**Files:**
- Modify: `scripts/compare-weight-profiles.ts`
- Modify: `scripts/compare-weight-profiles.spec.ts`

- [ ] **Step 1: Write failing tests for `calcP95`**

Add to `scripts/compare-weight-profiles.spec.ts` (after existing tests):

```typescript
import {
  assertRankingProfileFilesExist,
  mean,
  pairedPermutationPValue,
  parseArgs,
  calcP95,
  evaluateProfile,
} from './compare-weight-profiles.js';
```

And add describe block:

```typescript
describe('calcP95', () => {
  it('빈 배열은 0 반환', () => {
    expect(calcP95([])).toBe(0);
  });

  it('단일 값은 그 값 반환', () => {
    expect(calcP95([42])).toBe(42);
  });

  it('정렬 순서 무관하게 p95 계산', () => {
    // nearest-rank: ceil(10 * 0.95) - 1 = 9 → sorted[9]
    const vals = [10, 30, 20, 90, 40, 50, 60, 70, 80, 100];
    expect(calcP95(vals)).toBe(100);
  });

  it('p95는 상위 5%를 제외한 최댓값', () => {
    // 20개 값: ceil(20 * 0.95) - 1 = 19 → sorted[18] = 95
    const vals = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
    expect(calcP95(vals)).toBe(95);
  });
});
```

- [ ] **Step 2: Run tests — expect fail with "calcP95 is not a function"**

```bash
cd ../memento-issue-407
npx vitest run scripts/compare-weight-profiles.spec.ts 2>&1 | tail -20
```

Expected: FAIL (import error or function not found)

- [ ] **Step 3: Add `ProfileEvalResult` interface and `calcP95` to compare-weight-profiles.ts**

Add right after the `mean` function export (around line 50):

```typescript
export interface ProfileEvalResult {
  mrr: number;
  ndcg_at_5: number;
  ndcg_at_10: number;
  recall_at_10: number;
  empty_result_rate: number;
  latency_ms: number[];
  p95_latency_ms: number;
  rr: number[];
}

export function calcP95(latencyMs: number[]): number {
  if (latencyMs.length === 0) return 0;
  const sorted = [...latencyMs].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}
```

- [ ] **Step 4: Run tests — expect calcP95 tests pass**

```bash
npx vitest run scripts/compare-weight-profiles.spec.ts 2>&1 | tail -20
```

Expected: `calcP95` tests PASS; `evaluateProfile` import still fails

- [ ] **Step 5: Commit**

```bash
git add scripts/compare-weight-profiles.ts scripts/compare-weight-profiles.spec.ts
git commit -m "feat(#407): add ProfileEvalResult interface and calcP95 function"
```

---

### Task 2: Add optional `rng` to `pairedPermutationPValue` and test reproducibility

**Files:**
- Modify: `scripts/compare-weight-profiles.ts`
- Modify: `scripts/compare-weight-profiles.spec.ts`

- [ ] **Step 1: Write failing test for seeded rng**

Add to the `compare-weight-profiles (T026)` describe block:

```typescript
it('pairedPermutationPValue — seeded rng 주입 시 재현성', () => {
  let seed = 42;
  const seededRng = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 4294967296;
  };
  const rrA = [1, 0.5, 0];
  const rrB = [0, 1, 0.5];
  const p1 = pairedPermutationPValue(rrA, rrB, 1000, seededRng);
  seed = 42; // reset
  const seededRng2 = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 4294967296;
  };
  const p2 = pairedPermutationPValue(rrA, rrB, 1000, seededRng2);
  expect(p1).toBe(p2);
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npx vitest run scripts/compare-weight-profiles.spec.ts 2>&1 | grep -E "FAIL|PASS|rng"
```

- [ ] **Step 3: Add optional `rng` param to `pairedPermutationPValue`**

Change the function signature (keep body identical, replace `Math.random()` with `rng()`):

```typescript
export function pairedPermutationPValue(
  rrA: number[],
  rrB: number[],
  iterations: number,
  rng: () => number = Math.random,
): number {
  const n = rrA.length;
  if (n === 0) {
    return 1;
  }
  const diff = rrA.map((a, i) => a - rrB[i]!);
  const observed = Math.abs(mean(diff));
  if (observed < 1e-12) {
    return 1;
  }
  let count = 0;
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const flip = rng() < 0.5 ? 1 : -1;
      s += diff[i]! * flip;
    }
    if (Math.abs(s / n) >= observed - 1e-12) {
      count++;
    }
  }
  return count / iterations;
}
```

- [ ] **Step 4: Run — seeded rng test passes**

```bash
npx vitest run scripts/compare-weight-profiles.spec.ts 2>&1 | tail -15
```

Expected: all existing tests + new rng test PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/compare-weight-profiles.ts scripts/compare-weight-profiles.spec.ts
git commit -m "feat(#407): add optional rng param to pairedPermutationPValue"
```

---

### Task 3: Rename `runProfile` → `evaluateProfile`, add latency/recall/empty_result_rate

**Files:**
- Modify: `scripts/compare-weight-profiles.ts`
- Modify: `scripts/compare-weight-profiles.spec.ts`

- [ ] **Step 1: Write failing export-check test**

Add to spec (in the outer describe):

```typescript
it('evaluateProfile이 export된 async function', () => {
  expect(typeof evaluateProfile).toBe('function');
});
```

- [ ] **Step 2: Run — expect fail (evaluateProfile not exported)**

```bash
npx vitest run scripts/compare-weight-profiles.spec.ts 2>&1 | grep -E "evaluateProfile|FAIL"
```

- [ ] **Step 3: Replace `runProfile` with `evaluateProfile` in compare-weight-profiles.ts**

Add import at top of file (after existing imports):

```typescript
import { calculateRecallAtK } from '@memento/core/test/helpers/search-quality-metrics.js';
```

Replace the entire `runProfile` function with this exported `evaluateProfile`:

```typescript
export async function evaluateProfile(
  db: Database.Database,
  profilePath: string,
  benchmarkDir: string = BENCHMARK_DIR,
): Promise<ProfileEvalResult> {
  resetRankingWeightsCache();

  const queries = loadBenchmarkQueries(benchmarkDir);
  const groundTruths = normalizeBenchmarkGroundTruths(benchmarkDir);
  const corpus = loadBenchmarkCorpus(benchmarkDir);
  const memoryIdToBenchmarkId = new Map(corpus.map((e) => [e.source_memory_id, e.benchmark_id]));
  const qById = new Map(queries.map((q) => [q.query_id, q]));

  const searchEngine = HybridSearchFactory.createDefaultEngine(db, undefined, {
    rankingWeightsPath: resolve(profilePath),
  });
  const queryResults = new Map<string, SearchResult[]>();
  const latencyMs: number[] = [];

  for (const gt of groundTruths) {
    const qrow = qById.get(gt.queryId);
    const queryText = qrow?.query ?? gt.queryId;
    const t0 = performance.now();
    const sr = await searchEngine.search(db, {
      query: queryText,
      limit: 20,
      provider_filter: BENCHMARK_OFFLINE_VECTOR_PROVIDER_FILTER,
    });
    latencyMs.push(performance.now() - t0);
    const mapped: SearchResult[] = sr.items.map((item) => ({
      id: memoryIdToBenchmarkId.get(item.id) ?? item.id,
      score: item.finalScore,
    }));
    queryResults.set(gt.queryId, mapped);
  }

  const rr: number[] = [];
  for (const gt of groundTruths) {
    const results = queryResults.get(gt.queryId) ?? [];
    const relevantSet = new Set(gt.relevantIds);
    let rank = -1;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result && relevantSet.has(result.id)) {
        rank = i + 1;
        break;
      }
    }
    rr.push(rank > 0 ? 1 / rank : 0);
  }

  const denom = groundTruths.length > 0 ? groundTruths.length : 1;
  const mrr = rr.reduce((a, b) => a + b, 0) / denom;

  let ndcg5 = 0;
  let ndcg10 = 0;
  let recall10 = 0;
  let emptyCount = 0;
  const ndcgDenom = groundTruths.length;

  for (const gt of groundTruths) {
    const results = queryResults.get(gt.queryId) ?? [];
    if (results.length === 0) {
      emptyCount++;
      continue;
    }
    ndcg5 += calculateNDCGAtK(results, gt.relevantIds, 5);
    ndcg10 += calculateNDCGAtK(results, gt.relevantIds, 10);
    recall10 += calculateRecallAtK(results, gt.relevantIds, 10);
  }

  return {
    mrr,
    ndcg_at_5: ndcgDenom > 0 ? ndcg5 / ndcgDenom : 0,
    ndcg_at_10: ndcgDenom > 0 ? ndcg10 / ndcgDenom : 0,
    recall_at_10: ndcgDenom > 0 ? recall10 / ndcgDenom : 0,
    empty_result_rate: ndcgDenom > 0 ? emptyCount / ndcgDenom : 0,
    latency_ms: latencyMs,
    p95_latency_ms: calcP95(latencyMs),
    rr,
  };
}
```

- [ ] **Step 4: Update `main()` to use `evaluateProfile` and rename output fields**

In `main()`, replace `runProfile` calls and update the report object:

```typescript
async function main(): Promise<void> {
  const { profileA, profileB } = parseArgs(process.argv.slice(2));
  const pathA = join(PROFILES_DIR, `${profileA}.toml`);
  const pathB = join(PROFILES_DIR, `${profileB}.toml`);
  assertRankingProfileFilesExist(pathA, pathB);

  const { db, close } = await createSeededBenchmarkDatabase(BENCHMARK_DIR);
  try {
    const a = await evaluateProfile(db, pathA);
    const b = await evaluateProfile(db, pathB);
    const pVal = pairedPermutationPValue(a.rr, b.rr, PERM_ITER);
    const mrrDelta = b.mrr - a.mrr;

    let verdict: 'a_better' | 'b_better' | 'inconclusive';
    if (pVal > 0.05) {
      verdict = 'inconclusive';
    } else if (mrrDelta < 0) {
      verdict = 'a_better';
    } else if (mrrDelta > 0) {
      verdict = 'b_better';
    } else {
      verdict = 'inconclusive';
    }

    const report = {
      profile_a: profileA,
      profile_b: profileB,
      profile_a_mrr: a.mrr,
      profile_b_mrr: b.mrr,
      profile_a_ndcg_at_5: a.ndcg_at_5,
      profile_b_ndcg_at_5: b.ndcg_at_5,
      profile_a_ndcg_at_10: a.ndcg_at_10,
      profile_b_ndcg_at_10: b.ndcg_at_10,
      mrr_delta: mrrDelta,
      mrr_p_value: pVal,
      mrr_significant: pVal < 0.05,
      verdict,
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    close();
  }
}
```

Also update the comment at the top of the file: change `p_value` / `significant` references to `mrr_p_value` / `mrr_significant`.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run scripts/compare-weight-profiles.spec.ts 2>&1 | tail -20
```

Expected: all 8 tests PASS (4 original + calcP95 ×4 + rng + evaluateProfile export)

- [ ] **Step 6: Commit**

```bash
git add scripts/compare-weight-profiles.ts scripts/compare-weight-profiles.spec.ts
git commit -m "feat(#407): rename runProfile→evaluateProfile, add latency/recall/empty_result_rate metrics"
```

- [ ] **Step 7: Create draft PR**

```bash
gh pr create --draft --title "feat(#407): compare-weight-profiles — ProfileEvalResult, calcP95, evaluateProfile" \
  --body "$(cat <<'EOF'
## Summary
- Closes #407
- Add `ProfileEvalResult` interface with full metric set
- Add `calcP95(latencyMs)` nearest-rank p95 function
- Add optional `rng` param to `pairedPermutationPValue` for reproducible testing
- Rename `runProfile` → `evaluateProfile` (exported, accepts `benchmarkDir`, measures latency, recall@10, empty_result_rate)
- Rename `p_value`→`mrr_p_value`, `significant`→`mrr_significant` in `main()` output

## Test plan
- [ ] `npx vitest run scripts/compare-weight-profiles.spec.ts` — all tests pass

Part of #140
EOF
)"
```

---

## Issue #408 — tune-weights.ts 구현

**Worktree:** `git worktree add ../memento-issue-408 -b issue/408-tune-weights`

> **Prerequisite:** This issue depends on `evaluateProfile`, `ProfileEvalResult`, `calcP95`, and `pairedPermutationPValue` from `compare-weight-profiles.ts`. Cherry-pick or merge issue/407 branch first:
> ```bash
> git merge origin/issue/407-compare-profile-extensions
> ```

### Task 4: Implement `scripts/tune-weights.ts`

**Files:**
- Create: `scripts/tune-weights.ts`

- [ ] **Step 1: Create the file**

```typescript
#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { stringify } from '@iarna/toml';
import type Database from 'better-sqlite3';
import { createSeededBenchmarkDatabase } from '@memento/core/test/helpers/benchmark-search-database.js';
import {
  loadRankingWeights,
  type RankingWeights,
  type RankingWeightsConfig,
} from '@memento/core/shared/config/ranking-weights-loader.js';
import {
  evaluateProfile,
  pairedPermutationPValue,
  type ProfileEvalResult,
} from './compare-weight-profiles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
const PROFILES_DIR = join(ROOT, 'config/ranking-profiles');

function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TuneArgs {
  candidates: number;
  seed: number;
  benchmarkDir: string;
  outputDir: string;
  baselineProfile: string;
}

export function parseTuneArgs(argv: string[]): TuneArgs {
  const args: TuneArgs = {
    candidates: 30,
    seed: Date.now(),
    benchmarkDir: BENCHMARK_DIR,
    outputDir: join(ROOT, 'tmp/tune-weights'),
    baselineProfile: 'default',
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--candidates' && argv[i + 1]) {
      args.candidates = parseInt(argv[++i]!, 10);
    } else if (argv[i] === '--seed' && argv[i + 1]) {
      args.seed = parseInt(argv[++i]!, 10);
    } else if (argv[i] === '--benchmark-dir' && argv[i + 1]) {
      args.benchmarkDir = argv[++i]!;
    } else if (argv[i] === '--output-dir' && argv[i + 1]) {
      args.outputDir = argv[++i]!;
    } else if (argv[i] === '--baseline-profile' && argv[i + 1]) {
      args.baselineProfile = argv[++i]!;
    }
  }
  return args;
}

export function generateCandidate(
  baseline: RankingWeights,
  rand: () => number,
): RankingWeights {
  const perturb = (v: number) => Math.min(1, Math.max(0, v * (0.8 + rand() * 0.4)));
  return {
    alpha: perturb(baseline.alpha),
    beta: perturb(baseline.beta),
    gamma: perturb(baseline.gamma),
    delta: perturb(baseline.delta),
    zeta: perturb(baseline.zeta),
    epsilon: perturb(baseline.epsilon),
    theta: perturb(baseline.theta ?? 0.1),
    zeta_fb: perturb(baseline.zeta_fb ?? 0.05),
  };
}

export function compositeScore(
  candidate: ProfileEvalResult,
  baseline: ProfileEvalResult,
): number {
  const normalizedP95 =
    baseline.p95_latency_ms > 0 ? candidate.p95_latency_ms / baseline.p95_latency_ms : 1;
  return (
    0.45 * candidate.ndcg_at_10 +
    0.30 * candidate.mrr +
    0.15 * candidate.recall_at_10 -
    0.07 * normalizedP95 -
    0.03 * candidate.empty_result_rate
  );
}

const LATENCY_BUDGET_MS = 2000;
const NDCG_REGRESSION_THRESHOLD = 0.05;

async function main(): Promise<void> {
  const args = parseTuneArgs(process.argv.slice(2));
  const rand = mulberry32(args.seed);

  const baselineProfilePath = join(PROFILES_DIR, `${args.baselineProfile}.toml`);
  const baselineConfig = loadRankingWeights(baselineProfilePath);
  const baselineWeights = baselineConfig.ranking_weights;

  const runId = `run-${args.seed}`;
  const runDir = join(args.outputDir, runId);
  const candidatesDir = join(runDir, 'candidates');
  mkdirSync(candidatesDir, { recursive: true });

  const { db, close } = await createSeededBenchmarkDatabase(args.benchmarkDir);

  try {
    const baseline = await evaluateProfile(db, baselineProfilePath, args.benchmarkDir);
    const baselineScore = compositeScore(baseline, baseline);

    type CandidateRecord = {
      candidate_index: number;
      weights: RankingWeights;
      result: ProfileEvalResult;
      composite_score: number;
      gate_passed: boolean;
      gate_reject_reason?: string;
      sum_warning: boolean;
    };

    const results: CandidateRecord[] = [];
    let candidatesWithSumWarning = 0;

    for (let i = 0; i < args.candidates; i++) {
      const candidateWeights = generateCandidate(baselineWeights, rand);
      const weightSum = Object.values(candidateWeights).reduce((a, b) => a + b, 0);
      const sumWarning = weightSum > 1.5;
      if (sumWarning) candidatesWithSumWarning++;

      const candidateConfig: RankingWeightsConfig = {
        ranking_weights: candidateWeights,
        relation_weights: baselineConfig.relation_weights,
      };
      const tmpTomlPath = join(candidatesDir, `candidate-${i}.toml`);
      writeFileSync(tmpTomlPath, stringify(candidateConfig as Record<string, unknown>));

      const result = await evaluateProfile(db, tmpTomlPath, args.benchmarkDir);
      const score = compositeScore(result, baseline);

      let gatePassed = true;
      let gateRejectReason: string | undefined;
      if (result.p95_latency_ms > LATENCY_BUDGET_MS) {
        gatePassed = false;
        gateRejectReason = `p95_latency_ms ${result.p95_latency_ms.toFixed(1)} > budget ${LATENCY_BUDGET_MS}`;
      } else if (result.ndcg_at_10 < baseline.ndcg_at_10 - NDCG_REGRESSION_THRESHOLD) {
        gatePassed = false;
        gateRejectReason = `ndcg_at_10 regression: ${result.ndcg_at_10.toFixed(4)} < ${(baseline.ndcg_at_10 - NDCG_REGRESSION_THRESHOLD).toFixed(4)}`;
      }

      const record: CandidateRecord = {
        candidate_index: i,
        weights: candidateWeights,
        result,
        composite_score: score,
        gate_passed: gatePassed,
        gate_reject_reason: gateRejectReason,
        sum_warning: sumWarning,
      };
      results.push(record);
      writeFileSync(join(candidatesDir, `candidate-${i}.json`), JSON.stringify(record, null, 2));
    }

    const passed = results.filter((r) => r.gate_passed);
    const best =
      passed.length > 0
        ? passed.reduce((a, b) => (a.composite_score > b.composite_score ? a : b))
        : null;

    let mrrPValue = 1;
    let mrrSignificant = false;
    let mrrVerdict: string;

    if (best) {
      const pVal = pairedPermutationPValue(best.result.rr, baseline.rr, 1000);
      mrrPValue = pVal;
      mrrSignificant = pVal < 0.05;
      mrrVerdict = mrrSignificant
        ? best.result.mrr > baseline.mrr
          ? 'best_better'
          : 'baseline_better'
        : 'inconclusive';
    } else {
      mrrVerdict = 'no_candidates_passed_gate';
    }

    const sortedByScore = [...results].sort((a, b) => b.composite_score - a.composite_score);
    const topCandidates = sortedByScore.slice(0, 10).map((r, idx) => ({
      rank: idx + 1,
      candidate_index: r.candidate_index,
      composite_score: r.composite_score,
      mrr: r.result.mrr,
      ndcg_at_10: r.result.ndcg_at_10,
      recall_at_10: r.result.recall_at_10,
      p95_latency_ms: r.result.p95_latency_ms,
      gate_passed: r.gate_passed,
      sum_warning: r.sum_warning,
    }));

    const summary = {
      seed: args.seed,
      candidates_evaluated: args.candidates,
      candidates_rejected: results.filter((r) => !r.gate_passed).length,
      candidates_with_sum_warning: candidatesWithSumWarning,
      baseline_composite_score: baselineScore,
      best_composite_score: best?.composite_score ?? null,
      best_candidate_index: best?.candidate_index ?? null,
      best_toml_path: best
        ? join(candidatesDir, `candidate-${best.candidate_index}.toml`)
        : null,
      mrr_p_value: mrrPValue,
      mrr_significant: mrrSignificant,
      mrr_verdict: mrrVerdict,
      top_candidates: topCandidates,
    };

    writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.error(`Run complete. Results in: ${runDir}`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    close();
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '')
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ../memento-issue-408
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "error TS|scripts/tune" | head -20
```

Expected: no errors for `scripts/tune-weights.ts`

- [ ] **Step 3: Run existing spec to confirm nothing broken**

```bash
npx vitest run scripts/compare-weight-profiles.spec.ts 2>&1 | tail -10
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/tune-weights.ts
git commit -m "feat(#408): implement tune-weights.ts — autoresearch candidate generation and evaluation"
```

- [ ] **Step 5: Create draft PR**

```bash
gh pr create --draft --title "feat(#408): tune-weights.ts — autoresearch candidate generation, eval, artifact saving" \
  --body "$(cat <<'EOF'
## Summary
- Closes #408
- New script: `scripts/tune-weights.ts`
- `mulberry32` seeded PRNG for reproducible runs
- CLI: `--candidates`, `--seed`, `--benchmark-dir`, `--output-dir`, `--baseline-profile`
- Baseline loaded via `loadRankingWeights()` (reuses existing validation)
- Candidate generation: baseline-relative ±20% perturbation per weight
- Gate: p95 latency budget (2000ms) + ndcg_at_10 regression guard (0.05)
- Artifacts: `tmp/tune-weights/run-<seed>/summary.json` + per-candidate JSON/TOML

## Test plan
- [ ] `npx tsc --noEmit --skipLibCheck` — no type errors
- [ ] `npx vitest run scripts/compare-weight-profiles.spec.ts` — all pass

Part of #140
EOF
)"
```

---

## Issue #410 — tune-report.ts 구현

**Worktree:** `git worktree add ../memento-issue-410 -b issue/410-tune-report`

> **Prerequisite:** Merge issue/408 branch (contains `summary.json` artifact format):
> ```bash
> git merge origin/issue/408-tune-weights
> ```

### Task 5: Implement `scripts/tune-report.ts`

**Files:**
- Create: `scripts/tune-report.ts`

- [ ] **Step 1: Create the file**

```typescript
#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_TUNE_DIR = join(ROOT, 'tmp/tune-weights');

function parseReportArgs(argv: string[]): { runDir?: string } {
  let runDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run-dir' && argv[i + 1]) {
      runDir = argv[++i]!;
    }
  }
  return { runDir };
}

function findLatestRunDir(tuneDir: string): string | null {
  if (!existsSync(tuneDir)) return null;
  const entries = readdirSync(tuneDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('run-'))
    .sort((a, b) => b.name.localeCompare(a.name));
  const latest = entries[0];
  return latest ? join(tuneDir, latest.name) : null;
}

interface TopCandidate {
  rank: number;
  candidate_index: number;
  composite_score: number;
  mrr: number;
  ndcg_at_10: number;
  recall_at_10: number;
  p95_latency_ms: number;
  gate_passed: boolean;
  sum_warning: boolean;
}

interface Summary {
  seed: number;
  candidates_evaluated: number;
  candidates_rejected: number;
  candidates_with_sum_warning: number;
  baseline_composite_score: number | null;
  best_composite_score: number | null;
  best_candidate_index: number | null;
  best_toml_path: string | null;
  mrr_p_value: number;
  mrr_significant: boolean;
  mrr_verdict: string;
  top_candidates: TopCandidate[];
}

async function main(): Promise<void> {
  const { runDir: explicitRunDir } = parseReportArgs(process.argv.slice(2));

  const runDir = explicitRunDir ?? findLatestRunDir(DEFAULT_TUNE_DIR);
  if (!runDir) {
    console.error(
      'No run directory found. Run `npm run quality:benchmark:tune-weights` first or specify --run-dir <path>.',
    );
    process.exit(1);
  }

  const summaryPath = join(runDir, 'summary.json');
  if (!existsSync(summaryPath)) {
    console.error(`summary.json not found in ${runDir}`);
    process.exit(1);
  }

  const summary: Summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));

  console.log('=== Tuning Run Report ===');
  console.log(`Seed:                    ${summary.seed}`);
  console.log(
    `Candidates:              ${summary.candidates_evaluated} evaluated, ${summary.candidates_rejected} rejected`,
  );
  console.log(`Sum warnings:            ${summary.candidates_with_sum_warning}`);
  console.log(
    `Baseline composite score: ${summary.baseline_composite_score?.toFixed(4) ?? 'N/A'}`,
  );
  console.log(
    `Best composite score:    ${summary.best_composite_score != null ? summary.best_composite_score.toFixed(4) : 'N/A'}`,
  );
  console.log(`MRR p-value:             ${summary.mrr_p_value?.toFixed(4) ?? 'N/A'}`);
  console.log(`MRR significant:         ${summary.mrr_significant}`);
  console.log(`MRR verdict:             ${summary.mrr_verdict}`);
  console.log('');

  if (summary.best_composite_score == null) {
    console.log(`⚠ No candidates passed gate (mrr_verdict: ${summary.mrr_verdict})`);
    if (summary.top_candidates?.length > 0) {
      console.log('(Gate-rejected candidates by composite score, for reference:)');
    }
  }

  if (summary.top_candidates?.length > 0) {
    console.table(
      summary.top_candidates.map((c) => ({
        rank: c.rank,
        candidate_index: c.candidate_index,
        composite_score: c.composite_score?.toFixed(4),
        mrr: c.mrr?.toFixed(4),
        ndcg_at_10: c.ndcg_at_10?.toFixed(4),
        recall_at_10: c.recall_at_10?.toFixed(4),
        p95_latency_ms: c.p95_latency_ms?.toFixed(1),
        sum_warning: c.sum_warning,
      })),
    );
  }

  if (summary.best_toml_path) {
    console.log('');
    console.log(`Best candidate TOML: ${summary.best_toml_path}`);
    console.log(
      'To apply: copy TOML content to config/ranking-weights.toml and sync config/ranking-profiles/default.toml',
    );
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '')
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ../memento-issue-410
npx tsc --noEmit --skipLibCheck 2>&1 | grep "scripts/tune-report" | head -10
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add scripts/tune-report.ts
git commit -m "feat(#410): implement tune-report.ts — format and display tune-weights run results"
```

- [ ] **Step 4: Create draft PR**

```bash
gh pr create --draft --title "feat(#410): tune-report.ts — format tune-weights run results" \
  --body "$(cat <<'EOF'
## Summary
- Closes #410
- New script: `scripts/tune-report.ts`
- CLI: `--run-dir <path>` (optional; auto-selects latest `tmp/tune-weights/run-*`)
- Reads `summary.json` produced by `tune-weights.ts`
- Prints header (seed, candidates, scores, MRR stats)
- Handles `best = null` case with `⚠` warning
- `console.table()` top-10 candidates (gate-rejected shown as reference when no best)
- Prints best TOML path + manual apply instructions

## Test plan
- [ ] `npx tsc --noEmit --skipLibCheck` — no type errors

Part of #140
EOF
)"
```

---

## Issue #409 — 빌드 통합 (package.json + .gitignore)

**Worktree:** `git worktree add ../memento-issue-409 -b issue/409-build-integration`

> **Prerequisite:** Merge issue/408 and issue/410 branches (scripts must exist for scripts to be valid):
> ```bash
> git merge origin/issue/408-tune-weights origin/issue/410-tune-report
> ```

### Task 6: Update package.json scripts and .gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Update `quality:benchmark:compare-profiles` script in package.json**

Find the current line:
```json
"quality:benchmark:compare-profiles": "tsx scripts/compare-weight-profiles.ts",
```

Replace with:
```json
"quality:benchmark:compare-profiles": "npm run build -w packages/memento-core && tsx scripts/compare-weight-profiles.ts",
```

- [ ] **Step 2: Add two new scripts after `quality:benchmark:compare-profiles`**

```json
"quality:benchmark:tune-weights": "npm run build -w packages/memento-core && tsx scripts/tune-weights.ts",
"quality:benchmark:tune-report": "tsx scripts/tune-report.ts",
```

- [ ] **Step 3: Add tmp/tune-weights/ to .gitignore**

Append to `.gitignore`:
```
tmp/tune-weights/
```

- [ ] **Step 4: Verify JSON validity**

```bash
cd ../memento-issue-409
node -e "JSON.parse(require('fs').readFileSync('package.json','utf-8')); console.log('JSON valid')"
```

Expected: `JSON valid`

- [ ] **Step 5: Verify scripts are accessible**

```bash
npm run quality:benchmark:compare-profiles -- --help 2>&1 | head -5 || true
npm run quality:benchmark:tune-report -- --help 2>&1 | head -5 || true
```

Expected: scripts resolve without "command not found"

- [ ] **Step 6: Run existing tests to confirm nothing broken**

```bash
npx vitest run scripts/compare-weight-profiles.spec.ts 2>&1 | tail -10
```

Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore
git commit -m "chore(#409): add tune-weights/tune-report scripts + build chain + .gitignore"
```

- [ ] **Step 8: Create draft PR**

```bash
gh pr create --draft --title "chore(#409): package.json scripts + .gitignore for tune-weights harness" \
  --body "$(cat <<'EOF'
## Summary
- Closes #409
- Add build-chain prefix to `quality:benchmark:compare-profiles` (memento-core build required for dist imports)
- Add `quality:benchmark:tune-weights` script (build + tsx)
- Add `quality:benchmark:tune-report` script (tsx only, no build needed)
- Add `tmp/tune-weights/` to `.gitignore`

## Test plan
- [ ] `node -e "JSON.parse(require('fs').readFileSync('package.json','utf-8'))"` — valid JSON
- [ ] `npx vitest run scripts/compare-weight-profiles.spec.ts` — all pass

Part of #140
EOF
)"
```

---

## Execution Order Summary

```
#407 → #408 (needs evaluateProfile from #407) → #410 (needs summary.json format from #408) → #409 (integrates all)
```

Each issue:
1. Create worktree
2. Merge prerequisite branches
3. Implement + test
4. Commit
5. `gh pr create --draft`
