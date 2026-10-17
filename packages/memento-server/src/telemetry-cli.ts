#!/usr/bin/env node
/**
 * Memento Telemetry CLI — immutable baseline spec:
 * https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/007-telemetry-cli-mcp/spec.md
 * HTTP 서버 없이 텔레메트리 지표를 터미널에서 확인합니다.
 * Usage: npm run telemetry [-- [options]]
 */

import { loadEnv } from './cli/env-loader.js';
import type {
  SearchQualityResult,
  MemoryQualityResult,
  FeedbackQualityResult
} from '@memento/core';

export type { SearchQualityResult, MemoryQualityResult, FeedbackQualityResult };

interface ToolMetricBucket {
  request_count: number | null;
  success_count: number | null;
  error_count: number | null;
  error_rate: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
}

export interface SystemMetricsResult {
  period: string;
  tools: {
    recall: ToolMetricBucket;
    remember: ToolMetricBucket;
    feedback: ToolMetricBucket;
  };
  background_jobs: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// CLI 옵션 타입
// ---------------------------------------------------------------------------

export type TelemetryPeriod = '24h' | '7d' | '30d';
export type TelemetryType = 'search-quality' | 'memory-quality' | 'feedback-quality' | 'system' | 'all';

export interface CliOptions {
  period: TelemetryPeriod;
  type: TelemetryType;
}

const ALLOWED_PERIODS: TelemetryPeriod[] = ['24h', '7d', '30d'];
const ALLOWED_TYPES: TelemetryType[] = ['search-quality', 'memory-quality', 'feedback-quality', 'system', 'all'];

// ---------------------------------------------------------------------------
// 옵션 파싱
// ---------------------------------------------------------------------------

/**
 * argv 배열에서 --period, --type, --help 옵션을 파싱합니다.
 * @throws Error - 잘못된 옵션 값
 */
export function parseCliOptions(argv: string[]): CliOptions {
  let period: TelemetryPeriod = '24h';
  let type: TelemetryType = 'all';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--period') {
      const val = argv[i + 1];
      if (!val || val.startsWith('-')) {
        throw new Error('--period requires a value. Allowed: ' + ALLOWED_PERIODS.join(', '));
      }
      if (!ALLOWED_PERIODS.includes(val as TelemetryPeriod)) {
        throw new Error(
          `Invalid --period value: "${val}". Allowed: ${ALLOWED_PERIODS.join(', ')}`
        );
      }
      period = val as TelemetryPeriod;
      i++;
      continue;
    }

    if (arg === '--type') {
      const val = argv[i + 1];
      if (!val || val.startsWith('-')) {
        throw new Error('--type requires a value. Allowed: ' + ALLOWED_TYPES.join(', '));
      }
      if (!ALLOWED_TYPES.includes(val as TelemetryType)) {
        throw new Error(
          `Invalid --type value: "${val}". Allowed: ${ALLOWED_TYPES.join(', ')}`
        );
      }
      type = val as TelemetryType;
      i++;
      continue;
    }
  }

  return { period, type };
}

// ---------------------------------------------------------------------------
// 비즈니스 로직 (테스트 가능한 코어)
// ---------------------------------------------------------------------------

export interface TelemetryRunner {
  getSearchQuality(period: TelemetryPeriod, ownerId: string | null): SearchQualityResult;
  getMemoryQuality(period: TelemetryPeriod, ownerId: string | null): MemoryQualityResult;
  getSystemMetrics(period: TelemetryPeriod, ownerId: string | null): SystemMetricsResult;
  getFeedbackQuality(period: TelemetryPeriod, ownerId: string | null): FeedbackQualityResult;
}

export interface TelemetryRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * 텔레메트리 데이터를 조회하고 포맷된 출력을 반환합니다.
 * main()에서 분리되어 단위 테스트가 가능합니다.
 */
interface TelemetrySection {
  type: Exclude<TelemetryType, 'all'>;
  collect(runner: TelemetryRunner, period: TelemetryPeriod): { empty: boolean; text: string };
}

function defineSection<T>(
  type: TelemetrySection['type'],
  load: (runner: TelemetryRunner, period: TelemetryPeriod) => T,
  isEmpty: (result: T) => boolean,
  format: (result: T) => string
): TelemetrySection {
  return {
    type,
    collect: (runner, period) => {
      const result = load(runner, period);
      return { empty: isEmpty(result), text: format(result) };
    },
  };
}

/** 출력 순서대로. `all` 은 모든 섹션이 비었을 때만 "데이터 없음" 이다. */
const TELEMETRY_SECTIONS: TelemetrySection[] = [
  defineSection(
    'search-quality',
    (runner, period) => runner.getSearchQuality(period, null),
    (r) => r.search_count === null && r.avg_latency_ms === null
      && r.p95_latency_ms === null && r.empty_retrieval_rate === null,
    (r) => formatSearchQuality(r)
  ),
  defineSection(
    'memory-quality',
    (runner, period) => runner.getMemoryQuality(period, null),
    (r) => r.total_memories === null && r.duplicate_write_rate_24h === null,
    (r) => formatMemoryQuality(r)
  ),
  defineSection(
    'feedback-quality',
    (runner, period) => runner.getFeedbackQuality(period, null),
    (r) => r.recall_count === 0 && r.positive_count === 0 && r.negative_count === 0,
    (r) => formatFeedbackQuality(r)
  ),
  defineSection(
    'system',
    (runner, period) => runner.getSystemMetrics(period, null),
    (r) => r.tools.recall.request_count === null && r.tools.remember.request_count === null
      && r.tools.feedback.request_count === null,
    (r) => formatSystemMetrics(r)
  ),
];

export function executeTelemetry(runner: TelemetryRunner, options: CliOptions): TelemetryRunResult {
  try {
    const { period, type } = options;
    const collected = TELEMETRY_SECTIONS
      .filter((section) => type === 'all' || section.type === type)
      .map((section) => section.collect(runner, period));

    if (collected.every((section) => section.empty)) {
      return { stdout: '기록된 텔레메트리 데이터가 없습니다.\n', stderr: '', exitCode: 0 };
    }

    const parts = [
      `=== Memento Telemetry (${period}) ===\n`,
      ...collected.map((section) => '\n' + section.text + '\n'),
    ];
    return { stdout: parts.join(''), stderr: '', exitCode: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: msg, exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// 포맷터
// ---------------------------------------------------------------------------

function fmt(value: number | null, suffix = ''): string {
  if (value === null) return 'N/A';
  return `${value}${suffix}`;
}

function fmtPct(value: number | null): string {
  if (value === null) return 'N/A';
  return `${(value * 100).toFixed(1)} %`;
}

function fmtMs(value: number | null): string {
  if (value === null) return 'N/A';
  return `${Math.round(value)} ms`;
}

function pad(label: string, width = 20): string {
  return label.padEnd(width, ' ');
}

/**
 * SearchQualityResult를 포맷된 텍스트로 변환합니다.
 */
export function formatSearchQuality(data: SearchQualityResult): string {
  const lines: string[] = [
    '[Search Quality]',
    `  ${pad('Total queries')} : ${fmt(data.search_count)}`,
    `  ${pad('Avg latency')} : ${fmtMs(data.avg_latency_ms)}`,
    `  ${pad('p95 latency')} : ${fmtMs(data.p95_latency_ms)}`,
    `  ${pad('Empty result rate')} : ${fmtPct(data.empty_retrieval_rate)}`,
    `  ${pad('Avg candidate count')} : ${fmt(data.avg_candidate_count)}`,
    `  ${pad('Rejection rate')} : ${fmtPct(data.rejection_rate)}`,
    `  ${pad('Gate decided')} : ${fmt(data.rejection_decided_count)}`,
  ];
  return lines.join('\n');
}

/**
 * MemoryQualityResult를 포맷된 텍스트로 변환합니다.
 */
export function formatMemoryQuality(data: MemoryQualityResult): string {
  const rawDistStr =
    data.type_distribution !== null
      ? Object.entries(data.type_distribution)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ')
      : 'N/A';
  // "  Type distribution      : " prefix = 25 chars → max content = 55 chars to stay ≤ 80 cols
  const distStr = rawDistStr.length > 55 ? rawDistStr.slice(0, 52) + '...' : rawDistStr;

  const lines: string[] = [
    '[Memory Quality]',
    `  ${pad('Total memories')} : ${fmt(data.total_memories)}`,
    `  ${pad('Type distribution')} : ${distStr}`,
    `  ${pad('Duplicate rate (24h)')} : ${fmtPct(data.duplicate_write_rate_24h)}`,
    `  ${pad('Orphan ratio')} : ${fmtPct(data.orphan_memory_ratio)}`,
    `  ${pad('Relation coverage')} : ${fmtPct(data.relation_coverage_ratio)}`,
  ];
  return lines.join('\n');
}

/**
 * FeedbackQualityResult를 포맷된 텍스트로 변환합니다.
 */
export function formatFeedbackQuality(data: FeedbackQualityResult): string {
  const lines: string[] = [
    '[Feedback Quality]',
    `  ${pad('Recall count')} : ${fmt(data.recall_count)}`,
    `  ${pad('Helpful rate')} : ${fmtPct(data.helpful_rate)}`,
    `  ${pad('Positive / negative')} : ${fmt(data.positive_count)} / ${fmt(data.negative_count)}`,
    `  ${pad('No-feedback recall rate')} : ${fmtPct(data.recall_without_feedback_rate)}`,
  ];
  return lines.join('\n');
}

/**
 * SystemMetricsResult를 포맷된 텍스트로 변환합니다.
 */
export function formatSystemMetrics(data: SystemMetricsResult): string {
  function toolLine(name: string, bucket: SystemMetricsResult['tools']['recall']): string {
    const req = bucket.request_count ?? 'N/A';
    const suc = bucket.success_count ?? 'N/A';
    const err = bucket.error_rate !== null ? `${(bucket.error_rate * 100).toFixed(1)} %` : 'N/A';
    return `  ${name.padEnd(10)} - requests: ${String(req).padStart(3)}  success: ${String(suc).padStart(3)}  error_rate: ${err}`;
  }

  const lines: string[] = [
    `[System Metrics (${data.period})]`,
    toolLine('Recall', data.tools.recall),
    toolLine('Remember', data.tools.remember),
    toolLine('Feedback', data.tools.feedback),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 도움말
// ---------------------------------------------------------------------------

function printHelp(): void {
  process.stdout.write([
    'Usage: npm run telemetry [-- [options]]',
    '',
    'Options:',
    '  --period  <24h|7d|30d>                    조회 기간 (기본: 24h)',
    '  --type    <search-quality|memory-quality|feedback-quality|system|all>',
    '                                             지표 유형 (기본: all)',
    '  --help, -h                                 도움말 출력',
    '',
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// 메인 (CLI 진입점)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // env 로드
  loadEnv();

  // 옵션 파싱
  let options: CliOptions;
  try {
    options = parseCliOptions(process.argv.slice(2));
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    process.exit(1);
  }

  // 동적 import (env 로드 이후)
  const { createMementoCore, closeDatabase, mementoConfig, expandHomeDirPath } = await import('@memento/core');

  const dbPath = expandHomeDirPath(process.env.DB_PATH ?? mementoConfig.dbPath);

  let db: import('better-sqlite3').Database | null = null;
  let runtimeDiagnosticsSamplerCleanup: (() => Promise<void>) | undefined;

  const cleanup = async (): Promise<void> => {
    if (runtimeDiagnosticsSamplerCleanup) {
      try {
        await runtimeDiagnosticsSamplerCleanup();
      } catch (_) { /* intentional: cleanup errors ignored on exit */ }
      runtimeDiagnosticsSamplerCleanup = undefined;
    }

    if (db) {
      try {
        closeDatabase(db);
      } catch (_) { /* intentional: close errors ignored on exit */ }
      db = null;
    }
  };

  process.on('exit', () => {
    void cleanup();
  });
  process.on('uncaughtException', () => { void cleanup(); process.exit(1); });
  process.on('SIGINT', () => { void cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { void cleanup(); process.exit(143); });

  try {
    const core = await createMementoCore({ dbPath });
    db = core.db;
    runtimeDiagnosticsSamplerCleanup = core.services.runtimeDiagnosticsSamplerCleanup;

    const telService = core.services.telemetryService;
    if (!telService) {
      process.stderr.write('TelemetryService를 초기화할 수 없습니다.\n');
      cleanup();
      process.exit(1);
    }

    const result = executeTelemetry(telService as unknown as TelemetryRunner, options);
    if (result.stderr) process.stderr.write(result.stderr + '\n');
    if (result.stdout) process.stdout.write(result.stdout);
    cleanup();
    process.exit(result.exitCode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`DB 경로: ${dbPath}\n${msg}\n`);
    cleanup();
    process.exit(1);
  }
}

// CLI 직접 실행 여부 확인 (process.argv[1] 파일명 매칭)
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith('telemetry-cli.ts') || process.argv[1].endsWith('telemetry-cli.js'));

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(String(err?.message ?? err) + '\n');
    process.exit(1);
  });
}
