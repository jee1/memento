#!/usr/bin/env node
/**
 * 랭킹 가중치 제안 미리보기 (#1584)
 *
 * 사용: npm run ranking:preview -- --changes '{"relevance_signal.scale":2.2}'
 *
 * 저장소의 config/ranking-weights.toml(현재)과 제안 값을 적용한 사본을 split.json 의 dev 쿼리로만 평가해
 * stdout 마지막 줄에 JSON 한 줄을 쓴다. held-out 쿼리는 실행하지 않는다.
 * 평가는 getRankingWeights 전역 캐시와 MEMENTO_RANKING_WEIGHTS_PATH 를 바꾸므로 서버 프로세스 안에서 부르지 않고 별도 프로세스로만 실행한다.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getEmbeddingModelFilter, initializeDatabase } from '@memento/core';
import { loadRankingWeights } from '@memento/core/shared/config/ranking-weights-loader.js';
import { applyRankingKnobChanges } from '@memento/core/shared/config/ranking-weights-patch.js';
import {
  validateKnobChanges,
  type KnobKey,
} from '@memento/core/shared/config/ranking-knobs.js';
import { resolveBenchmarkEmbeddingProvider } from '@memento/core/shared/types/benchmark.types.js';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';
import { isMain, parseArgs as parseCliArgs, type CliDatabase } from './lib/cli.js';
import { evaluateProfile, restrictEvalToQueries, type ProfileEvalResult } from './compare-weight-profiles.js';
import { loadCategoryMapping, queryMacroResolver, relevanceTieRate, tieGateRejectReason } from './tune-weights.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
const DEFAULT_PROFILE = join(ROOT, 'config/ranking-weights.toml');
// 캐시가 비었을 때 benchmark-v3 시드(실측 104초)가 시간 안에 들어와야 한다.
const DEFAULT_TIMEOUT_MS = 300_000;
// 시드가 코퍼스 전체를 임베딩하므로 원격 provider 면 외부 API 로 수천 건을 보낸다.
const REMOTE_EMBEDDING_PROVIDERS = new Set(['openai', 'gemini']);

export interface PreviewArgs {
  changes: Partial<Record<KnobKey, number>>;
  benchmarkDir: string;
  splitPath: string;
  cacheDir: string;
  timeoutMs: number;
  currentProfile: string;
}

export interface PreviewSplit {
  version: string;
  queries_sha256: string;
  dev_query_ids: string[];
  held_out_query_ids: string[];
}

export interface PreviewMetrics {
  ndcg_at_10: number;
  mrr: number;
  recall_at_10: number;
  empty_result_rate: number;
  p95_latency_ms: number;
  relevance_tie_rate: number;
}

type CategoryMetrics = Pick<PreviewMetrics, 'ndcg_at_10' | 'mrr' | 'recall_at_10'>;

export interface RankingPreviewResult {
  split_version: string;
  dev_query_count: number;
  changes: Partial<Record<KnobKey, number>>;
  current: PreviewMetrics;
  proposed: PreviewMetrics;
  delta: PreviewMetrics;
  per_category?: Record<
    string,
    { query_count: number; current: CategoryMetrics; proposed: CategoryMetrics; delta: CategoryMetrics }
  >;
  tie_gate: { passed: boolean; reason?: string };
  seed_cache: { hit: boolean; key: string };
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parsePreviewArgs(argv: string[]): PreviewArgs {
  let changesJson: string | undefined;
  let changesFile: string | undefined;
  const args: PreviewArgs = {
    changes: {},
    benchmarkDir: DEFAULT_BENCHMARK_DIR,
    splitPath: '',
    cacheDir: process.env.MEMENTO_RANKING_PREVIEW_CACHE_DIR || join(tmpdir(), 'memento-ranking-preview'),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    currentProfile: DEFAULT_PROFILE,
  };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (value === undefined) continue;
    switch (argv[i]) {
      case '--changes': changesJson = value; i++; break;
      case '--changes-file': changesFile = value; i++; break;
      case '--benchmark-dir': args.benchmarkDir = resolve(value); i++; break;
      case '--split': args.splitPath = resolve(value); i++; break;
      case '--cache-dir': args.cacheDir = resolve(value); i++; break;
      case '--current-profile': args.currentProfile = resolve(value); i++; break;
      case '--timeout-ms': {
        const ms = Number.parseInt(value, 10);
        if (!Number.isInteger(ms) || ms <= 0) throw new Error(`--timeout-ms 는 양의 정수여야 합니다: ${value}`);
        args.timeoutMs = ms;
        i++;
        break;
      }
    }
  }
  if (!args.splitPath) args.splitPath = join(args.benchmarkDir, 'split.json');
  if ((changesJson === undefined) === (changesFile === undefined)) {
    throw new Error('--changes 또는 --changes-file 중 하나만 지정하세요');
  }
  const parsed: unknown = JSON.parse(changesJson ?? readFileSync(resolve(changesFile!), 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('changes 는 knob → 값 객체여야 합니다');
  }
  const error = validateKnobChanges(parsed as Record<string, unknown>, loadRankingWeights(args.currentProfile));
  if (error) throw new Error(error.message);
  if (Object.keys(parsed).length === 0) throw new Error('changes 가 비어 있습니다');
  args.changes = parsed as Partial<Record<KnobKey, number>>;
  return args;
}

/** 분할 파일을 읽고 낡았거나 dev 와 held-out 이 겹치면 실패한다. */
export function loadPreviewSplit(benchmarkDir: string, splitPath: string): PreviewSplit {
  const split = JSON.parse(readFileSync(splitPath, 'utf8')) as Partial<PreviewSplit> & { version?: string };
  const dev = split.dev_query_ids;
  const heldOut = split.held_out_query_ids;
  if (!split.version || !Array.isArray(dev) || dev.length === 0 || !Array.isArray(heldOut)) {
    throw new Error(`split 파일 형식이 잘못되었습니다: ${splitPath}`);
  }
  const actual = sha256(readFileSync(join(benchmarkDir, 'queries.json')));
  if (split.queries_sha256 !== actual) {
    throw new Error(`split 이 낡았습니다: queries.json sha256 ${actual} != split ${split.queries_sha256}`);
  }
  const held = new Set(heldOut);
  const overlap = dev.filter((id) => held.has(id));
  if (overlap.length > 0) throw new Error(`dev 와 held-out 이 겹칩니다: ${overlap.join(', ')}`);
  return { version: split.version, queries_sha256: actual, dev_query_ids: dev, held_out_query_ids: heldOut };
}

function seedCacheKey(benchmarkDir: string): string {
  const provider = resolveBenchmarkEmbeddingProvider();
  const model = getEmbeddingModelFilter(provider) ?? 'default';
  const manifestPath = join(benchmarkDir, 'manifest.json');
  const parts = [
    sha256(readFileSync(join(benchmarkDir, 'corpus.jsonl'))),
    existsSync(manifestPath) ? sha256(readFileSync(manifestPath)) : 'nomanifest',
    sha256(readFileSync(join(ROOT, 'scripts/lib/benchmark-search-database.ts'))),
  ].map((digest) => digest.slice(0, 10));
  return `${parts.join('-')}-${provider}-${model}`.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function openSeededDatabase(
  benchmarkDir: string,
  cacheDir: string,
): Promise<{ db: CliDatabase; close: () => void; cache: { hit: boolean; key: string } }> {
  const key = seedCacheKey(benchmarkDir);
  const cached = join(cacheDir, `benchmark-${key}.db`);
  const hit = existsSync(cached);
  if (!hit) {
    mkdirSync(cacheDir, { recursive: true });
    // 시드 도중 죽어도 반쪽짜리 DB 가 캐시로 읽히지 않도록 끝난 뒤에만 이름을 바꾼다.
    const partial = `${cached}.${process.pid}.partial`;
    const seeded = await createSeededBenchmarkDatabase(benchmarkDir, { dbPath: partial });
    seeded.close();
    renameSync(partial, cached);
  }
  const db = await initializeDatabase(cached);
  return { db, close: () => db.close(), cache: { hit, key } };
}

function metricsOf(r: ProfileEvalResult): PreviewMetrics {
  return {
    ndcg_at_10: r.ndcg_at_10,
    mrr: r.mrr,
    recall_at_10: r.recall_at_10,
    empty_result_rate: r.empty_result_rate,
    p95_latency_ms: r.p95_latency_ms,
    relevance_tie_rate: relevanceTieRate(r),
  };
}

function diffOf<T extends object>(proposed: T, current: T): T {
  return Object.fromEntries(
    (Object.keys(proposed) as Array<keyof T>).map((k) => [k, (proposed[k] as number) - (current[k] as number)]),
  ) as T;
}

function categoryReport(
  current: ProfileEvalResult,
  proposed: ProfileEvalResult,
  benchmarkDir: string,
): RankingPreviewResult['per_category'] {
  const mapping = loadCategoryMapping(benchmarkDir);
  if (!mapping) return undefined;
  const macroOf = queryMacroResolver(mapping);
  const byMacro = new Map<string, string[]>();
  for (const id of current.query_ids) byMacro.set(macroOf(id), [...(byMacro.get(macroOf(id)) ?? []), id]);
  const pick = (r: ProfileEvalResult): CategoryMetrics => ({ ndcg_at_10: r.ndcg_at_10, mrr: r.mrr, recall_at_10: r.recall_at_10 });
  const report: NonNullable<RankingPreviewResult['per_category']> = {};
  for (const [macro, ids] of [...byMacro].sort(([a], [b]) => a.localeCompare(b))) {
    const c = pick(restrictEvalToQueries(current, ids));
    const p = pick(restrictEvalToQueries(proposed, ids));
    report[macro] = { query_count: ids.length, current: c, proposed: p, delta: diffOf(p, c) };
  }
  return report;
}

export async function runRankingPreview(args: PreviewArgs): Promise<RankingPreviewResult> {
  const provider = resolveBenchmarkEmbeddingProvider();
  if (REMOTE_EMBEDDING_PROVIDERS.has(provider)) {
    throw new Error(`미리보기는 로컬 임베딩만 씁니다. EMBEDDING_PROVIDER=${provider} 대신 minilm 으로 실행하세요`);
  }
  const split = loadPreviewSplit(args.benchmarkDir, args.splitPath);
  const currentText = readFileSync(args.currentProfile, 'utf8');
  const proposedText = applyRankingKnobChanges(currentText, args.changes).text;

  const tmp = mkdtempSync(join(tmpdir(), 'ranking-preview-'));
  process.once('exit', () => rmSync(tmp, { recursive: true, force: true }));
  const proposedPath = join(tmp, 'proposed.toml');
  writeFileSync(proposedPath, proposedText);

  const { db, close, cache } = await openSeededDatabase(args.benchmarkDir, args.cacheDir);
  try {
    const options = { queryIds: split.dev_query_ids };
    // 첫 평가는 모델·SQLite 캐시를 데우느라 느려서 p95 비교를 왜곡한다. 결과는 버린다.
    await evaluateProfile(db, args.currentProfile, args.benchmarkDir, options);
    const current = await evaluateProfile(db, args.currentProfile, args.benchmarkDir, options);
    const proposed = await evaluateProfile(db, proposedPath, args.benchmarkDir, options);
    const currentMetrics = metricsOf(current);
    const proposedMetrics = metricsOf(proposed);
    const reason = tieGateRejectReason(proposedMetrics.relevance_tie_rate, currentMetrics.relevance_tie_rate);
    return {
      split_version: split.version,
      dev_query_count: current.query_ids.length,
      changes: args.changes,
      current: currentMetrics,
      proposed: proposedMetrics,
      delta: diffOf(proposedMetrics, currentMetrics),
      per_category: categoryReport(current, proposed, args.benchmarkDir),
      tie_gate: reason === undefined ? { passed: true } : { passed: false, reason },
      seed_cache: cache,
    };
  } finally {
    close();
  }
}

async function main(): Promise<void> {
  const args = parsePreviewArgs(parseCliArgs().args);
  const deadline = setTimeout(() => {
    console.error(`ranking-preview: ${args.timeoutMs}ms 안에 끝나지 않아 종료합니다`);
    process.exit(124);
  }, args.timeoutMs);
  const result = await runRankingPreview(args);
  clearTimeout(deadline);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isMain(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
