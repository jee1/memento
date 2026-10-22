/**
 * Ranking and perf baselines for the category-report gate (#1385).
 *
 * Identity is checked before any MRR subtraction. `threshold_passed` is not an input.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { calcP95 } from '../compare-weight-profiles.js';
import { loadBenchmarkCorpus } from '../../packages/memento-core/src/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { normalizeBenchmarkGroundTruths } from '../../packages/memento-core/src/domains/monitoring/services/quality-assurance/search-quality-review-verifier.js';
import {
  ALL_MACROS,
  type CategoryMeasurement,
  type CategoryQualityReport,
  type MacroCategory,
  type RankingScopeName,
  type ResolvedRankingScope,
} from '../../packages/memento-core/src/shared/types/benchmark.types.js';
import type { EmbeddingProvider } from '../../packages/memento-core/src/shared/types/embedding.types.js';

/** Fail when baseline_mrr - candidate_mrr is greater than this. */
export const MRR_DROP_EPSILON = 0.03;

/** Fail when candidate/baseline is strictly greater than this. */
export const PERF_P95_SLACK = 2;
export const PERF_RSS_SLACK = 1.5;

/** Required relevant and stale ids are kept. A required set longer than this throws. */
export const PR_CORPUS_CAP = 400;

export const PERF_CORPUS_ROWS = 10_000;

/** Post-seed collect budget. Not a search-wall p95. */
export const WALL_MS = 30_000;
export const MIN_QUERY_COVERAGE = 1.0;

export const RANKING_BASELINE_PATH: Readonly<Record<RankingScopeName, string>> = {
  nightly: 'tests/fixtures/search-quality/baselines/ranking-nightly.json',
  pr: 'tests/fixtures/search-quality/baselines/ranking-pr.json',
};

export const PERF_BASELINE_PATH = 'tests/fixtures/search-quality/baselines/perf-pr.json';

export type BaselineDocument = RankingBaseline | PerfBaseline;

export interface RankingBaseline {
  readonly schema: 1;
  readonly kind: 'ranking';
  readonly identity: RankingIdentity;
  readonly metrics: RankingMetrics;
}

export interface PerfBaseline {
  readonly schema: 1;
  readonly kind: 'perf';
  readonly identity: PerfIdentity;
  readonly metrics: PerfMetrics;
}

export interface RankingIdentity {
  readonly scope: RankingScopeName;
  readonly fixture: 'benchmark-v3';
  readonly embedding_provider: EmbeddingProvider;
  readonly corpus_row_count: number;
  readonly corpus_id_sha256: string;
  readonly scored_query_ids: Readonly<Record<MacroCategory, readonly string[]>>;
}

export interface RankingMetrics {
  readonly mrr_by_macro: Readonly<Record<MacroCategory, number>>;
}

export interface PerfIdentity {
  readonly fixture: 'benchmark-v3-scaled';
  readonly embedding_provider: EmbeddingProvider;
  readonly corpus_row_count: number;
  readonly measured_query_count: number;
}

export interface PerfMetrics {
  readonly search_p95_ms: number;
  readonly rss_bytes: number;
  readonly rss_sample_point: 'post_warmup';
}

export interface MacroDelta {
  readonly macro: MacroCategory;
  readonly baseline_mrr: number;
  readonly candidate_mrr: number;
  /** baseline_mrr - candidate_mrr. Positive is a regression. */
  readonly drop: number;
}

export type RankingMismatchField =
  | 'kind'
  | 'schema'
  | 'scope'
  | 'fixture'
  | 'embedding_provider'
  | 'corpus_row_count'
  | 'corpus_id_sha256'
  | 'scored_query_ids';

export type PerfMismatchField =
  | 'kind'
  | 'schema'
  | 'fixture'
  | 'embedding_provider'
  | 'corpus_row_count'
  | 'measured_query_count'
  | 'rss_sample_point';

export type GateCause =
  | { readonly kind: 'ranking'; readonly reason: 'mismatch'; readonly field: RankingMismatchField }
  | { readonly kind: 'ranking'; readonly reason: 'mrr_drop'; readonly macros: readonly MacroCategory[] }
  | { readonly kind: 'ranking'; readonly reason: 'coverage' }
  | { readonly kind: 'ranking'; readonly reason: 'wall' }
  | { readonly kind: 'ranking'; readonly reason: 'missing_baseline' }
  | { readonly kind: 'perf'; readonly reason: 'mismatch'; readonly field: PerfMismatchField }
  | { readonly kind: 'perf'; readonly reason: 'p95' | 'rss' }
  | { readonly kind: 'perf'; readonly reason: 'missing_baseline' };

export type GateOutcome =
  | { readonly mode: 'write'; readonly stdout: readonly string[]; readonly stderr: readonly string[] }
  | { readonly mode: 'pass'; readonly stdout: readonly string[]; readonly stderr: readonly string[] }
  | {
      readonly mode: 'fail';
      readonly causes: readonly [GateCause, ...GateCause[]];
      readonly stdout: readonly string[];
      readonly stderr: readonly string[];
    };

export interface EvaluateRankingInput {
  readonly measurement: CategoryMeasurement;
  readonly scope: ResolvedRankingScope;
  readonly seededBenchmarkIds?: readonly string[];
  readonly embeddingProvider: EmbeddingProvider;
  readonly baselinePath: string;
  readonly elapsedMs: number;
  readonly writeBaseline: boolean;
}

export interface EvaluatePerfInput {
  readonly embeddingProvider: EmbeddingProvider;
  readonly corpusRowCount: number;
  readonly searchWallMs: readonly number[];
  readonly rssBytes: number;
  readonly baselinePath: string;
  readonly writeBaseline: boolean;
}

type RankingCause = Extract<GateCause, { kind: 'ranking' }>;
type PerfCause = Extract<GateCause, { kind: 'perf' }>;

interface CompareResult {
  readonly status: 'pass' | 'mismatch' | 'drop';
  readonly field?: RankingMismatchField | PerfMismatchField;
  readonly deltas?: readonly MacroDelta[];
  readonly macros?: readonly MacroCategory[];
  readonly p95Ratio?: number;
  readonly rssRatio?: number;
  readonly perfField?: 'search_p95_ms' | 'rss_bytes';
}

/** One scope per process. PR pins relevant and stale ids, then sha256-ordered distractors up to the cap. */
export function planRankingRun(name: RankingScopeName, benchmarkDir: string): ResolvedRankingScope {
  return resolveRankingScope(name, benchmarkDir);
}

export function evaluateRanking(input: EvaluateRankingInput): GateOutcome {
  const candidate = buildRankingCandidate(input);
  const stdout = formatRankingStdout(input.measurement, undefined);
  if (input.writeBaseline) {
    writeBaselineDocument(input.baselinePath, candidate);
    return { mode: 'write', stdout, stderr: [] };
  }
  if (!existsSync(input.baselinePath)) {
    return fail([{ kind: 'ranking', reason: 'missing_baseline' }], stdout, [
      `missing baseline: ${input.baselinePath}`,
    ]);
  }
  const baseline = readBaseline(input.baselinePath);
  const compared = compareBaseline(baseline, candidate);
  if (compared.status === 'mismatch') {
    const field = (compared.field ?? 'kind') as RankingMismatchField;
    return fail(
      [{ kind: 'ranking', reason: 'mismatch', field }],
      formatRankingStdout(input.measurement, undefined),
      [`mismatch ${field}`],
    );
  }
  const causes: RankingCause[] = [];
  if (compared.status === 'drop') {
    causes.push({ kind: 'ranking', reason: 'mrr_drop', macros: compared.macros ?? [] });
  }
  if (coverageBelow(input.measurement.reports)) {
    causes.push({ kind: 'ranking', reason: 'coverage' });
  }
  if (input.elapsedMs > WALL_MS) {
    causes.push({ kind: 'ranking', reason: 'wall' });
  }
  const lines = formatRankingStdout(input.measurement, compared.deltas);
  if (causes.length === 0) {
    return { mode: 'pass', stdout: lines, stderr: [] };
  }
  return fail(causes, lines, causes.map(formatCause));
}

export function evaluatePerf(input: EvaluatePerfInput): GateOutcome {
  if (input.corpusRowCount !== PERF_CORPUS_ROWS) {
    throw new Error(`perf corpus must be ${PERF_CORPUS_ROWS} rows`);
  }
  if (input.searchWallMs.length === 0) {
    throw new Error('searchWallMs is empty');
  }
  if (!Number.isFinite(input.rssBytes) || input.rssBytes < 0) {
    throw new Error('rssBytes must be a non-negative finite byte count');
  }
  const candidate = buildPerfCandidate(input);
  const stdout = formatPerfStdout(candidate, undefined, undefined);
  if (input.writeBaseline) {
    writeBaselineDocument(input.baselinePath, candidate);
    return { mode: 'write', stdout, stderr: [] };
  }
  if (!existsSync(input.baselinePath)) {
    return fail([{ kind: 'perf', reason: 'missing_baseline' }], stdout, [
      `missing baseline: ${input.baselinePath}`,
    ]);
  }
  const baseline = readBaseline(input.baselinePath);
  const compared = compareBaseline(baseline, candidate);
  if (compared.status === 'mismatch') {
    const field = (compared.field ?? 'kind') as PerfMismatchField;
    return fail([{ kind: 'perf', reason: 'mismatch', field }], stdout, [`mismatch ${field}`]);
  }
  const causes: PerfCause[] = [];
  if (compared.status === 'drop') {
    if ((compared.p95Ratio ?? 0) > PERF_P95_SLACK) {
      causes.push({ kind: 'perf', reason: 'p95' });
    }
    if ((compared.rssRatio ?? 0) > PERF_RSS_SLACK) {
      causes.push({ kind: 'perf', reason: 'rss' });
    }
  }
  const lines = formatPerfStdout(candidate, compared.p95Ratio, compared.rssRatio);
  if (causes.length === 0) {
    return { mode: 'pass', stdout: lines, stderr: [] };
  }
  return fail(causes, lines, causes.map(formatCause));
}

function resolveRankingScope(name: RankingScopeName, benchmarkDir: string): ResolvedRankingScope {
  const corpusIds = loadBenchmarkCorpus(benchmarkDir).map((entry) => entry.benchmark_id);
  const groundTruths = normalizeBenchmarkGroundTruths(benchmarkDir).filter(
    (groundTruth) => groundTruth.relevantIds.length > 0,
  );
  const queryIds = groundTruths.map((groundTruth) => groundTruth.queryId).sort();
  const requiredIds = groundTruths.flatMap((groundTruth) => [
    ...groundTruth.relevantIds,
    ...(groundTruth.staleIds ?? []),
  ]);
  const corpusBenchmarkIds =
    name === 'nightly' ? uniqueSorted(corpusIds) : selectPrCorpus(corpusIds, requiredIds);
  return { name, corpusBenchmarkIds, queryIds };
}

function selectPrCorpus(corpusIds: readonly string[], requiredIds: readonly string[]): string[] {
  const corpusSet = new Set(corpusIds);
  const relevant: string[] = [];
  for (const id of requiredIds) {
    if (!corpusSet.has(id)) {
      throw new Error(`Ground truth id is not in the corpus: ${id}`);
    }
    if (!relevant.includes(id)) {
      relevant.push(id);
    }
  }
  if (relevant.length > PR_CORPUS_CAP) {
    throw new Error(`PR corpus required ids exceed PR_CORPUS_CAP: ${relevant.length} > ${PR_CORPUS_CAP}`);
  }
  const relevantSet = new Set(relevant);
  const distractors = corpusIds.filter((id) => !relevantSet.has(id));
  distractors.sort((a, b) => sha256Text(a).localeCompare(sha256Text(b)) || a.localeCompare(b));
  const picked = [...relevant];
  for (const id of distractors) {
    if (picked.length >= PR_CORPUS_CAP) {
      break;
    }
    picked.push(id);
  }
  return picked.sort();
}

function buildRankingCandidate(input: EvaluateRankingInput): RankingBaseline {
  const ids = input.seededBenchmarkIds ?? input.scope.corpusBenchmarkIds;
  if (input.scope.name === 'pr' && input.seededBenchmarkIds === undefined) {
    throw new Error('PR ranking requires seededBenchmarkIds');
  }
  if (input.seededBenchmarkIds !== undefined && !sameSet(input.seededBenchmarkIds, input.scope.corpusBenchmarkIds)) {
    throw new Error('seededBenchmarkIds do not match the ranking scope corpus');
  }
  const scored = {} as Record<MacroCategory, readonly string[]>;
  const mrrByMacro = {} as Record<MacroCategory, number>;
  for (const macro of ALL_MACROS) {
    const report = input.measurement.reports.find((row) => row.macro_category === macro);
    const queryIds = input.measurement.scored_query_ids_by_macro[macro];
    if (!report || queryIds === undefined) {
      throw new Error(`measurement is missing macro ${macro}`);
    }
    if (report.query_count !== queryIds.length) {
      throw new Error(`query_count for ${macro} does not match scored query ids`);
    }
    if (!Number.isFinite(report.mrr)) {
      throw new Error(`mrr for ${macro} is not finite`);
    }
    scored[macro] = [...queryIds].sort();
    mrrByMacro[macro] = report.mrr;
  }
  const flat = ALL_MACROS.flatMap((macro) => scored[macro]);
  if (!sameSet(flat, input.scope.queryIds)) {
    throw new Error('scored query ids do not match the ranking scope');
  }
  const sortedIds = [...ids].sort();
  return {
    schema: 1,
    kind: 'ranking',
    identity: {
      scope: input.scope.name,
      fixture: 'benchmark-v3',
      embedding_provider: input.embeddingProvider,
      corpus_row_count: sortedIds.length,
      corpus_id_sha256: sha256Text(sortedIds.join('\n')),
      scored_query_ids: scored,
    },
    metrics: { mrr_by_macro: mrrByMacro },
  };
}

function buildPerfCandidate(input: EvaluatePerfInput): PerfBaseline {
  return {
    schema: 1,
    kind: 'perf',
    identity: {
      fixture: 'benchmark-v3-scaled',
      embedding_provider: input.embeddingProvider,
      corpus_row_count: input.corpusRowCount,
      measured_query_count: input.searchWallMs.length,
    },
    metrics: {
      search_p95_ms: calcP95([...input.searchWallMs]),
      rss_bytes: input.rssBytes,
      rss_sample_point: 'post_warmup',
    },
  };
}

function compareBaseline(baseline: BaselineDocument, candidate: BaselineDocument): CompareResult {
  if (baseline.kind !== candidate.kind) {
    return { status: 'mismatch', field: 'kind' };
  }
  if (baseline.schema !== candidate.schema) {
    return { status: 'mismatch', field: 'schema' };
  }
  if (baseline.kind === 'ranking' && candidate.kind === 'ranking') {
    return compareRanking(baseline, candidate);
  }
  if (baseline.kind === 'perf' && candidate.kind === 'perf') {
    return comparePerf(baseline, candidate);
  }
  return { status: 'mismatch', field: 'kind' };
}

function compareRanking(baseline: RankingBaseline, candidate: RankingBaseline): CompareResult {
  const left = baseline.identity;
  const right = candidate.identity;
  if (left.scope !== right.scope) return { status: 'mismatch', field: 'scope' };
  if (left.fixture !== right.fixture) return { status: 'mismatch', field: 'fixture' };
  if (left.embedding_provider !== right.embedding_provider) {
    return { status: 'mismatch', field: 'embedding_provider' };
  }
  if (left.corpus_row_count !== right.corpus_row_count) {
    return { status: 'mismatch', field: 'corpus_row_count' };
  }
  if (left.corpus_id_sha256 !== right.corpus_id_sha256) {
    return { status: 'mismatch', field: 'corpus_id_sha256' };
  }
  if (!sameMacroIds(left.scored_query_ids, right.scored_query_ids)) {
    return { status: 'mismatch', field: 'scored_query_ids' };
  }
  if (!completeMrr(baseline.metrics.mrr_by_macro) || !completeMrr(candidate.metrics.mrr_by_macro)) {
    return { status: 'mismatch', field: 'scored_query_ids' };
  }
  const deltas = ALL_MACROS.map((macro) => {
    const baselineMrr = baseline.metrics.mrr_by_macro[macro];
    const candidateMrr = candidate.metrics.mrr_by_macro[macro];
    return {
      macro,
      baseline_mrr: baselineMrr,
      candidate_mrr: candidateMrr,
      drop: baselineMrr - candidateMrr,
    };
  });
  const macros = deltas
    .filter((delta) => delta.drop - MRR_DROP_EPSILON > 1e-9)
    .map((delta) => delta.macro);
  return macros.length > 0
    ? { status: 'drop', deltas, macros }
    : { status: 'pass', deltas };
}

function comparePerf(baseline: PerfBaseline, candidate: PerfBaseline): CompareResult {
  const left = baseline.identity;
  const right = candidate.identity;
  if (left.fixture !== right.fixture) return { status: 'mismatch', field: 'fixture' };
  if (left.embedding_provider !== right.embedding_provider) {
    return { status: 'mismatch', field: 'embedding_provider' };
  }
  if (left.corpus_row_count !== right.corpus_row_count) {
    return { status: 'mismatch', field: 'corpus_row_count' };
  }
  if (left.measured_query_count !== right.measured_query_count) {
    return { status: 'mismatch', field: 'measured_query_count' };
  }
  if (
    baseline.metrics.rss_sample_point !== 'post_warmup' ||
    candidate.metrics.rss_sample_point !== 'post_warmup'
  ) {
    return { status: 'mismatch', field: 'rss_sample_point' };
  }
  const p95Ratio = ratio(candidate.metrics.search_p95_ms, baseline.metrics.search_p95_ms);
  const rssRatio = ratio(candidate.metrics.rss_bytes, baseline.metrics.rss_bytes);
  if (p95Ratio > PERF_P95_SLACK || rssRatio > PERF_RSS_SLACK) {
    return {
      status: 'drop',
      p95Ratio,
      rssRatio,
      perfField: p95Ratio > PERF_P95_SLACK ? 'search_p95_ms' : 'rss_bytes',
    };
  }
  return { status: 'pass', p95Ratio, rssRatio };
}

function readBaseline(path: string): BaselineDocument {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parseBaselineDocument(raw);
}

function parseBaselineDocument(raw: unknown): BaselineDocument {
  assertNoThresholdPassed(raw);
  if (!isRecord(raw)) {
    throw new Error('baseline document must be an object');
  }
  if (raw.schema !== 1) {
    throw new Error('baseline schema must be 1');
  }
  if (raw.kind === 'ranking') {
    return parseRanking(raw);
  }
  if (raw.kind === 'perf') {
    return parsePerf(raw);
  }
  throw new Error('baseline kind must be ranking or perf');
}

function parseRanking(raw: Record<string, unknown>): RankingBaseline {
  const identity = isRecord(raw.identity) ? raw.identity : undefined;
  const metrics = isRecord(raw.metrics) ? raw.metrics : undefined;
  const mrr = metrics && isRecord(metrics.mrr_by_macro) ? metrics.mrr_by_macro : undefined;
  const scoredRaw = identity && isRecord(identity.scored_query_ids) ? identity.scored_query_ids : undefined;
  if (!identity || !mrr || !scoredRaw) {
    throw new Error('ranking baseline is missing identity or metrics');
  }
  if (identity.scope !== 'nightly' && identity.scope !== 'pr') {
    throw new Error('ranking baseline scope must be nightly or pr');
  }
  if (identity.fixture !== 'benchmark-v3') {
    throw new Error('ranking baseline fixture must be benchmark-v3');
  }
  if (typeof identity.embedding_provider !== 'string') {
    throw new Error('ranking baseline embedding_provider must be a string');
  }
  if (typeof identity.corpus_row_count !== 'number' || typeof identity.corpus_id_sha256 !== 'string') {
    throw new Error('ranking baseline corpus identity is incomplete');
  }
  const scored = {} as Record<MacroCategory, readonly string[]>;
  const mrrByMacro = {} as Record<MacroCategory, number>;
  for (const macro of ALL_MACROS) {
    if (!Object.hasOwn(scoredRaw, macro) || !Object.hasOwn(mrr, macro)) {
      return incompleteRanking(identity, scored, mrrByMacro);
    }
    scored[macro] = parseStringArray(scoredRaw[macro], macro);
    const value = mrr[macro];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return incompleteRanking(identity, scored, mrrByMacro);
    }
    mrrByMacro[macro] = value;
  }
  return {
    schema: 1,
    kind: 'ranking',
    identity: {
      scope: identity.scope,
      fixture: 'benchmark-v3',
      embedding_provider: identity.embedding_provider as EmbeddingProvider,
      corpus_row_count: identity.corpus_row_count,
      corpus_id_sha256: identity.corpus_id_sha256,
      scored_query_ids: scored,
    },
    metrics: { mrr_by_macro: mrrByMacro },
  };
}

/**
 * A missing macro is still a document so compare can return mismatch
 * instead of subtracting against a different denominator.
 */
function incompleteRanking(
  identity: Record<string, unknown>,
  scored: Record<MacroCategory, readonly string[]>,
  mrrByMacro: Record<MacroCategory, number>,
): RankingBaseline {
  const filledScores = { ...scored };
  const filledMrr = { ...mrrByMacro };
  for (const macro of ALL_MACROS) {
    if (!Object.hasOwn(filledScores, macro)) {
      filledScores[macro] = [];
    }
    if (!Object.hasOwn(filledMrr, macro)) {
      filledMrr[macro] = Number.NaN;
    }
  }
  return {
    schema: 1,
    kind: 'ranking',
    identity: {
      scope: identity.scope === 'pr' ? 'pr' : 'nightly',
      fixture: 'benchmark-v3',
      embedding_provider: String(identity.embedding_provider) as EmbeddingProvider,
      corpus_row_count: Number(identity.corpus_row_count),
      corpus_id_sha256: String(identity.corpus_id_sha256),
      scored_query_ids: filledScores,
    },
    metrics: { mrr_by_macro: filledMrr },
  };
}

function parsePerf(raw: Record<string, unknown>): PerfBaseline {
  const identity = isRecord(raw.identity) ? raw.identity : undefined;
  const metrics = isRecord(raw.metrics) ? raw.metrics : undefined;
  if (!identity || !metrics) {
    throw new Error('perf baseline is missing identity or metrics');
  }
  if (metrics.rss_sample_point !== 'post_warmup') {
    throw new Error('rss_sample_point must be post_warmup');
  }
  if (identity.fixture !== 'benchmark-v3-scaled') {
    throw new Error('perf baseline fixture must be benchmark-v3-scaled');
  }
  if (
    typeof identity.embedding_provider !== 'string' ||
    typeof identity.corpus_row_count !== 'number' ||
    typeof identity.measured_query_count !== 'number' ||
    typeof metrics.search_p95_ms !== 'number' ||
    typeof metrics.rss_bytes !== 'number'
  ) {
    throw new Error('perf baseline fields are incomplete');
  }
  return {
    schema: 1,
    kind: 'perf',
    identity: {
      fixture: 'benchmark-v3-scaled',
      embedding_provider: identity.embedding_provider as EmbeddingProvider,
      corpus_row_count: identity.corpus_row_count,
      measured_query_count: identity.measured_query_count,
    },
    metrics: {
      search_p95_ms: metrics.search_p95_ms,
      rss_bytes: metrics.rss_bytes,
      rss_sample_point: 'post_warmup',
    },
  };
}

function writeBaselineDocument(path: string, doc: BaselineDocument): void {
  const tmp = join(dirname(path), `.baseline-${randomBytes(6).toString('hex')}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, path);
}

function sameMacroIds(
  left: Readonly<Record<MacroCategory, readonly string[]>>,
  right: Readonly<Record<MacroCategory, readonly string[]>>,
): boolean {
  for (const macro of ALL_MACROS) {
    const a = left[macro];
    const b = right[macro];
    if (a === undefined || b === undefined || !sameList(a, b)) {
      return false;
    }
  }
  return true;
}

function completeMrr(mrr: Readonly<Record<MacroCategory, number>>): boolean {
  return ALL_MACROS.every((macro) => Number.isFinite(mrr[macro]));
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  if (rightSet.size !== right.length) return false;
  for (const id of left) {
    if (!rightSet.has(id)) return false;
  }
  return true;
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function ratio(candidate: number, baseline: number): number {
  if (baseline === 0) return Number.POSITIVE_INFINITY;
  return candidate / baseline;
}

function coverageBelow(reports: readonly CategoryQualityReport[]): boolean {
  const scored = reports.reduce((sum, report) => sum + report.query_count, 0);
  const authored = reports.reduce((sum, report) => sum + report.authored_query_count, 0);
  return authored === 0 || scored / authored < MIN_QUERY_COVERAGE;
}

function formatRankingStdout(
  measurement: CategoryMeasurement,
  deltas: readonly MacroDelta[] | undefined,
): string[] {
  const scored = measurement.reports.reduce((sum, report) => sum + report.query_count, 0);
  const authored = measurement.reports.reduce((sum, report) => sum + report.authored_query_count, 0);
  const coverage = authored > 0 ? scored / authored : 0;
  const lines = [
    `queries_authored=${authored} queries_scored=${scored} coverage=${coverage.toFixed(3)}`,
    'macro_category | scored/authored | MRR | NDCG@5 | NDCG@10 | top10_len | drop',
  ];
  for (const report of measurement.reports) {
    const delta = deltas?.find((row) => row.macro === report.macro_category);
    const drop = delta === undefined ? '—' : delta.drop.toFixed(4);
    lines.push(
      `${report.macro_category} | ${report.query_count}/${report.authored_query_count} | ${report.mrr.toFixed(4)} | ${report.ndcg_at_5.toFixed(4)} | ${report.ndcg_at_10.toFixed(4)} | ${report.mean_top10_content_length.toFixed(0)} | ${drop}`,
    );
    if (report.pair_rank) {
      lines.push(formatPairRankLine(report.pair_rank));
    }
  }
  return lines;
}

function formatPairRankLine(summary: NonNullable<CategoryQualityReport['pair_rank']>): string {
  const counts = summary.outcome_histogram;
  return [
    `knowledge_update fresh_strictly_above=${summary.fresh_strictly_above_rate.toFixed(3)}`,
    `judged=${summary.judged}`,
    'numerator=fresh_strictly_above+fresh_only_in_window',
    'denominator=scored_knowledge_update_queries',
    `fresh_strictly_above=${counts.fresh_strictly_above}`,
    `fresh_only_in_window=${counts.fresh_only_in_window}`,
    `stale_strictly_above=${counts.stale_strictly_above}`,
    `stale_only_in_window=${counts.stale_only_in_window}`,
    `tied=${counts.tied}`,
    `neither_in_window=${counts.neither_in_window}`,
  ].join(' ');
}

function formatPerfStdout(
  candidate: PerfBaseline,
  p95Ratio: number | undefined,
  rssRatio: number | undefined,
): string[] {
  const p95 = p95Ratio === undefined ? '—' : p95Ratio.toFixed(3);
  const rss = rssRatio === undefined ? '—' : rssRatio.toFixed(3);
  return [
    `search_p95_ms=${candidate.metrics.search_p95_ms} rss_bytes=${candidate.metrics.rss_bytes} rss_sample_point=${candidate.metrics.rss_sample_point} ratio_p95=${p95} ratio_rss=${rss}`,
  ];
}

function formatCause(cause: GateCause): string {
  if (cause.reason === 'mrr_drop') return `mrr_drop ${cause.macros.join(',')}`;
  if (cause.reason === 'mismatch') return `mismatch ${cause.field}`;
  return cause.reason;
}

function fail(
  causes: readonly GateCause[],
  stdout: readonly string[],
  stderr: readonly string[],
): GateOutcome {
  const [first, ...rest] = causes;
  if (first === undefined) {
    throw new Error('fail outcome requires a cause');
  }
  return { mode: 'fail', causes: [first, ...rest], stdout, stderr };
}

function assertNoThresholdPassed(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoThresholdPassed(item);
    return;
  }
  if (!isRecord(value)) return;
  if ('threshold_passed' in value) {
    throw new Error('baseline document must not contain threshold_passed');
  }
  for (const child of Object.values(value)) assertNoThresholdPassed(child);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`baseline ${label} must be a string array`);
  }
  return value;
}
