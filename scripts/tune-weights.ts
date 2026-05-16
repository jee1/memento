#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
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
