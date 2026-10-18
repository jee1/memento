#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';
import { fileURLToPath } from 'url';
import { stringify } from '@iarna/toml';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';
import {
  loadRankingWeights,
  type RankingWeightsConfig,
} from '@memento/core/shared/config/ranking-weights-loader.js';
import {
  evaluateProfile,
  mean,
  pairedPermutationPValue,
  restrictEvalToQueries,
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

export type KnobKey =
  | 'ranking_weights.alpha'
  | 'ranking_weights.beta'
  | 'ranking_weights.gamma'
  | 'ranking_weights.delta'
  | 'ranking_weights.epsilon'
  | 'ranking_weights.theta'
  | 'ranking_weights.zeta_fb'
  | 'relevance_signal.scale'
  | 'recency_signal.scale'
  | 'importance_signal.scale'
  | 'fts_relevance.temperature'
  | 'vector_length_decay.characteristic_length'
  | 'vector_length_decay.saturation_length';

/** perturb: 기준값 × U[0.8,1.2] 후 [min,max] 로 clamp. uniform: [min,max] 균등 추출(경계가 탐색 범위 상한). */
export interface KnobSpec {
  sample: 'perturb' | 'uniform';
  min: number;
  max: number;
}

const WEIGHT: KnobSpec = { sample: 'perturb', min: 0, max: 1 };

export const TUNABLE_KNOBS: Record<KnobKey, KnobSpec> = {
  'ranking_weights.alpha': WEIGHT,
  'ranking_weights.beta': WEIGHT,
  'ranking_weights.gamma': WEIGHT,
  'ranking_weights.delta': WEIGHT,
  'ranking_weights.epsilon': WEIGHT,
  'ranking_weights.theta': WEIGHT,
  'ranking_weights.zeta_fb': WEIGHT,
  'relevance_signal.scale': { sample: 'uniform', min: 0.5, max: 3.0 },
  'recency_signal.scale': { sample: 'uniform', min: 0.05, max: 1 },
  'importance_signal.scale': { sample: 'uniform', min: 0.05, max: 1 },
  'fts_relevance.temperature': { sample: 'uniform', min: 2, max: 30 },
  'vector_length_decay.characteristic_length': { sample: 'uniform', min: 10, max: 120 },
  'vector_length_decay.saturation_length': { sample: 'uniform', min: 20, max: 300 },
};

const ALL_KNOBS = Object.keys(TUNABLE_KNOBS) as KnobKey[];

/** 로더가 theta·zeta_fb 가 없을 때 쓰는 기본값과 같다. */
const OPTIONAL_WEIGHT_DEFAULTS: Partial<Record<KnobKey, number>> = {
  'ranking_weights.theta': 0.1,
  'ranking_weights.zeta_fb': 0.05,
};

type NumericSections = Record<string, Record<string, number | undefined>>;

function readKnob(config: RankingWeightsConfig, key: KnobKey): number {
  const [section, field] = key.split('.') as [string, string];
  return (config as unknown as NumericSections)[section]![field] ?? OPTIONAL_WEIGHT_DEFAULTS[key] ?? 0;
}

function writeKnob(config: RankingWeightsConfig, key: KnobKey, value: number): void {
  const [section, field] = key.split('.') as [string, string];
  (config as unknown as NumericSections)[section]![field] = value;
}

export function parseKnobs(csv: string): KnobKey[] {
  const keys = csv.split(',').map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) throw new Error('--knobs 에 키가 없습니다');
  for (const k of keys) {
    if (!Object.hasOwn(TUNABLE_KNOBS, k)) {
      throw new Error(`알 수 없는 knob: ${k}. 사용 가능: ${ALL_KNOBS.join(', ')}`);
    }
  }
  return [...new Set(keys)] as KnobKey[];
}

interface TuneArgs {
  candidates: number;
  seed: number;
  benchmarkDir: string;
  outputDir: string;
  baselineProfile: string;
  knobs: KnobKey[];
}

export function parseTuneArgs(argv: string[]): TuneArgs {
  const args: TuneArgs = {
    candidates: 30,
    seed: Date.now(),
    benchmarkDir: BENCHMARK_DIR,
    outputDir: join(ROOT, 'tmp/tune-weights'),
    baselineProfile: 'default',
    knobs: ALL_KNOBS,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--candidates' && argv[i + 1]) {
      const v = parseInt(argv[++i]!, 10);
      if (isNaN(v) || v <= 0) throw new Error(`--candidates must be a positive integer, got: ${argv[i]}`);
      args.candidates = v;
    } else if (argv[i] === '--seed' && argv[i + 1]) {
      const v = parseInt(argv[++i]!, 10);
      if (isNaN(v)) throw new Error(`--seed must be an integer, got: ${argv[i]}`);
      args.seed = v;
    } else if (argv[i] === '--benchmark-dir' && argv[i + 1]) {
      args.benchmarkDir = argv[++i]!;
    } else if (argv[i] === '--output-dir' && argv[i + 1]) {
      args.outputDir = argv[++i]!;
    } else if (argv[i] === '--baseline-profile' && argv[i + 1]) {
      args.baselineProfile = argv[++i]!;
    } else if (argv[i] === '--knobs' && argv[i + 1]) {
      args.knobs = parseKnobs(argv[++i]!);
    }
  }
  return args;
}

/** 프로파일 이름(config/ranking-profiles/<name>.toml) 또는 .toml 경로(절대 또는 cwd 기준). */
export function resolveBaselineProfilePath(nameOrPath: string): string {
  if (nameOrPath.endsWith('.toml') || nameOrPath.includes('/')) {
    return isAbsolute(nameOrPath) ? nameOrPath : resolve(process.cwd(), nameOrPath);
  }
  return join(PROFILES_DIR, `${nameOrPath}.toml`);
}

export interface GeneratedCandidate {
  config: RankingWeightsConfig;
  knobs: Record<KnobKey, number>;
}

/** 선택한 knob 만 움직이고 나머지는 baseline 값을 그대로 둔 전체 설정을 만든다. */
export function generateCandidate(
  baseline: RankingWeightsConfig,
  rand: () => number,
  selected: readonly KnobKey[] = ALL_KNOBS,
): GeneratedCandidate {
  const config = JSON.parse(JSON.stringify(baseline)) as RankingWeightsConfig;
  const chosen = new Set(selected);
  for (const key of ALL_KNOBS) {
    if (!chosen.has(key)) continue;
    const spec = TUNABLE_KNOBS[key];
    const raw =
      spec.sample === 'perturb'
        ? readKnob(baseline, key) * (0.8 + rand() * 0.4)
        : spec.min + rand() * (spec.max - spec.min);
    writeKnob(config, key, Math.min(spec.max, Math.max(spec.min, raw)));
  }
  // saturation_length >= characteristic_length. 움직인 쪽만 보정해 선택하지 않은 knob 은 건드리지 않는다.
  const charKey = 'vector_length_decay.characteristic_length';
  const satKey = 'vector_length_decay.saturation_length';
  const char = readKnob(config, charKey);
  const sat = readKnob(config, satKey);
  if (sat < char) {
    if (chosen.has(satKey)) writeKnob(config, satKey, char);
    else writeKnob(config, charKey, sat);
  }
  const knobs = Object.fromEntries(ALL_KNOBS.map((k) => [k, readKnob(config, k)])) as Record<KnobKey, number>;
  return { config, knobs };
}

export interface CategoryMapping {
  macro_categories: Record<string, string[]>;
  query_overrides?: Record<string, string>;
  query_id_to_category: Record<string, string>;
}

export interface QuerySplit {
  explore_query_ids: string[];
  judge_query_ids: string[];
  strata: Record<string, { explore: string[]; judge: string[] }>;
}

/** macro 카테고리별 층화 분할. 층마다 시드 셔플 후 ceil(n/2) 를 explore, 나머지를 judge 로 보낸다. */
export function splitQueries(queryIds: readonly string[], mapping: CategoryMapping | null, seed: number): QuerySplit {
  const categoryToMacro = new Map<string, string>();
  for (const [macro, cats] of Object.entries(mapping?.macro_categories ?? {})) {
    for (const c of cats) categoryToMacro.set(c, macro);
  }
  const byStratum = new Map<string, string[]>();
  for (const id of [...queryIds].sort()) {
    const label = mapping?.query_id_to_category[id];
    const macro = mapping?.query_overrides?.[id] ?? (label ? categoryToMacro.get(label) : undefined) ?? 'unmapped';
    byStratum.set(macro, [...(byStratum.get(macro) ?? []), id]);
  }
  const rand = mulberry32((seed ^ 0x5bd1e995) | 0);
  const strata: QuerySplit['strata'] = {};
  for (const stratum of [...byStratum.keys()].sort()) {
    const ids = byStratum.get(stratum)!;
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    const cut = Math.ceil(ids.length / 2);
    strata[stratum] = { explore: ids.slice(0, cut), judge: ids.slice(cut) };
  }
  const all = Object.values(strata);
  return {
    explore_query_ids: all.flatMap((s) => s.explore),
    judge_query_ids: all.flatMap((s) => s.judge),
    strata,
  };
}

function loadCategoryMapping(benchmarkDir: string): CategoryMapping | null {
  const path = join(benchmarkDir, 'category-mapping.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as CategoryMapping) : null;
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
const COMPOSITE_EPSILON = 1e-4;
// benchmark-v3 실측 relevance 동점 쌍 비율: scale 1.0 → 0, 2.0 → 0.0008, 2.25 → 0.0031, 2.5 → 0.0084, 3.0 → 0.036.
// 2.25 까지는 허용하고 2.5 부터 막는 선이 baseline 대비 +0.005 다.
export const TIE_RATE_TOLERANCE = 0.005;

/** top-10 relevance 컴포넌트 동점 쌍 비율. 정답 라벨을 쓰지 않아 judge 쿼리를 포함해도 누출이 없다. */
export function relevanceTieRate(r: Pick<ProfileEvalResult, 'relevance_tie_pairs' | 'pairs'>): number {
  const pairs = r.pairs.reduce((a, b) => a + b, 0);
  return pairs > 0 ? r.relevance_tie_pairs.reduce((a, b) => a + b, 0) / pairs : 0;
}

export function tieGateRejectReason(candidateRate: number, baselineRate: number): string | undefined {
  if (candidateRate <= baselineRate + TIE_RATE_TOLERANCE) return undefined;
  return `relevance tie rate ${candidateRate.toFixed(4)} > baseline ${baselineRate.toFixed(4)} + ${TIE_RATE_TOLERANCE}`;
}

type CandidateRecord = {
  candidate_index: number;
  knobs: Record<KnobKey, number>;
  weights: RankingWeightsConfig['ranking_weights'];
  result: ProfileEvalResult;
  explore: ProfileEvalResult;
  tie_rate: number;
  composite_score: number;
  gate_passed: boolean;
  gate_reject_reason?: string;
  sum_warning: boolean;
};

function selectBest(passed: CandidateRecord[]): CandidateRecord | null {
  if (passed.length === 0) return null;
  return passed.reduce((a, b) => {
    const diff = b.composite_score - a.composite_score;
    if (Math.abs(diff) > COMPOSITE_EPSILON) return diff > 0 ? b : a;
    const ndcgDiff = b.explore.ndcg_at_10 - a.explore.ndcg_at_10;
    if (Math.abs(ndcgDiff) > COMPOSITE_EPSILON) return ndcgDiff > 0 ? b : a;
    return b.explore.mrr > a.explore.mrr ? b : a;
  });
}

function verdictFor(
  candidate: number[],
  baseline: number[],
): { p: number; significant: boolean; verdict: string } {
  const p = pairedPermutationPValue(candidate, baseline, 1000);
  const significant = p < 0.05;
  const better = mean(candidate) > mean(baseline);
  return { p, significant, verdict: significant ? (better ? 'best_better' : 'baseline_better') : 'inconclusive' };
}

async function main(): Promise<void> {
  const args = parseTuneArgs(parseCliArgs().args);
  const rand = mulberry32(args.seed);

  const baselineProfilePath = resolveBaselineProfilePath(args.baselineProfile);
  if (!existsSync(baselineProfilePath)) {
    throw new Error(`랭킹 프로파일 파일을 찾을 수 없습니다: ${baselineProfilePath}`);
  }
  const baselineConfig = loadRankingWeights(baselineProfilePath);

  const runId = `run-${args.seed}`;
  const runDir = join(args.outputDir, runId);
  const candidatesDir = join(runDir, 'candidates');
  mkdirSync(candidatesDir, { recursive: true });

  const { db, close } = await createSeededBenchmarkDatabase(args.benchmarkDir);

  try {
    const baseline = await evaluateProfile(db, baselineProfilePath, args.benchmarkDir);
    const split = splitQueries(baseline.query_ids, loadCategoryMapping(args.benchmarkDir), args.seed);
    const baselineExplore = restrictEvalToQueries(baseline, split.explore_query_ids);
    const baselineScore = compositeScore(baselineExplore, baselineExplore);
    const baselineTieRate = relevanceTieRate(baseline);

    const results: CandidateRecord[] = [];
    let candidatesWithSumWarning = 0;

    for (let i = 0; i < args.candidates; i++) {
      const { config, knobs } = generateCandidate(baselineConfig, rand, args.knobs);
      const candidateWeights = config.ranking_weights;
      const weightSum = (Object.values(candidateWeights) as number[]).reduce((a, b) => a + b, 0);
      const sumWarning = weightSum > 1.5;
      if (sumWarning) candidatesWithSumWarning++;

      const tmpTomlPath = join(candidatesDir, `candidate-${i}.toml`);
      writeFileSync(tmpTomlPath, stringify(JSON.parse(JSON.stringify(config))));

      const result = await evaluateProfile(db, tmpTomlPath, args.benchmarkDir);
      const explore = restrictEvalToQueries(result, split.explore_query_ids);
      const score = compositeScore(explore, baselineExplore);
      const tieRate = relevanceTieRate(result);

      let gateRejectReason: string | undefined;
      if (result.p95_latency_ms > LATENCY_BUDGET_MS) {
        gateRejectReason = `p95_latency_ms ${result.p95_latency_ms.toFixed(1)} > budget ${LATENCY_BUDGET_MS}`;
      } else if (explore.ndcg_at_10 < baselineExplore.ndcg_at_10 - NDCG_REGRESSION_THRESHOLD) {
        gateRejectReason = `ndcg_at_10 regression: ${explore.ndcg_at_10.toFixed(4)} < ${(baselineExplore.ndcg_at_10 - NDCG_REGRESSION_THRESHOLD).toFixed(4)}`;
      } else {
        gateRejectReason = tieGateRejectReason(tieRate, baselineTieRate);
      }

      const record: CandidateRecord = {
        candidate_index: i,
        knobs,
        weights: candidateWeights,
        result,
        explore,
        tie_rate: tieRate,
        composite_score: score,
        gate_passed: gateRejectReason === undefined,
        gate_reject_reason: gateRejectReason,
        sum_warning: sumWarning,
      };
      results.push(record);
      writeFileSync(join(candidatesDir, `candidate-${i}.json`), JSON.stringify(record, null, 2));
    }

    const best = selectBest(results.filter((r) => r.gate_passed));

    // judge 쿼리는 선택에 쓰이지 않았다. 선택된 단일 후보만 여기서 baseline 과 비교한다.
    const judgeBaseline = restrictEvalToQueries(baseline, split.judge_query_ids);
    const judgeBest = best ? restrictEvalToQueries(best.result, split.judge_query_ids) : null;
    const none = { p: 1, significant: false, verdict: 'no_candidates_passed_gate' };
    const mrr = judgeBest ? verdictFor(judgeBest.rr, judgeBaseline.rr) : none;
    const ndcg = judgeBest ? verdictFor(judgeBest.ndcg_at_10_per_query, judgeBaseline.ndcg_at_10_per_query) : none;
    const recall = judgeBest ? verdictFor(judgeBest.recall_at_10_per_query, judgeBaseline.recall_at_10_per_query) : none;

    const sortedByScore = [...results].sort((a, b) => b.composite_score - a.composite_score);
    const topCandidates = sortedByScore.slice(0, 10).map((r, idx) => ({
      rank: idx + 1,
      candidate_index: r.candidate_index,
      composite_score: r.composite_score,
      mrr: r.explore.mrr,
      ndcg_at_10: r.explore.ndcg_at_10,
      recall_at_10: r.explore.recall_at_10,
      p95_latency_ms: r.result.p95_latency_ms,
      gate_passed: r.gate_passed,
      sum_warning: r.sum_warning,
    }));

    const summary = {
      seed: args.seed,
      knobs: args.knobs,
      split,
      baseline_tie_rate: baselineTieRate,
      candidates_evaluated: args.candidates,
      candidates_rejected: results.filter((r) => !r.gate_passed).length,
      candidates_with_sum_warning: candidatesWithSumWarning,
      baseline_composite_score: baselineScore,
      best_composite_score: best?.composite_score ?? null,
      best_candidate_index: best?.candidate_index ?? null,
      best_knobs: best?.knobs ?? null,
      best_toml_path: best
        ? join(candidatesDir, `candidate-${best.candidate_index}.toml`)
        : null,
      mrr_p_value: mrr.p,
      mrr_significant: mrr.significant,
      mrr_verdict: mrr.verdict,
      ndcg_p_value: ndcg.p,
      ndcg_significant: ndcg.significant,
      ndcg_verdict: ndcg.verdict,
      recall_p_value: recall.p,
      recall_significant: recall.significant,
      recall_verdict: recall.verdict,
      candidates: results.map((r) => ({
        candidate_index: r.candidate_index,
        knobs: r.knobs,
        composite_score: r.composite_score,
        gate_passed: r.gate_passed,
        ...(r.gate_reject_reason ? { gate_reject_reason: r.gate_reject_reason } : {}),
        tie_rate: r.tie_rate,
        explore: { mrr: r.explore.mrr, ndcg_at_10: r.explore.ndcg_at_10, recall_at_10: r.explore.recall_at_10 },
      })),
      top_candidates: topCandidates,
    };

    writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.error(`Run complete. Results in: ${runDir}`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    close();
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
