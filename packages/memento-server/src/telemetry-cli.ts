#!/usr/bin/env node
/**
 * Memento Telemetry CLI (specs/007-telemetry-cli-mcp)
 * HTTP 서버 없이 텔레메트리 지표를 터미널에서 확인합니다.
 * Usage: npm run telemetry [-- [options]]
 */

import { loadEnv } from './cli/env-loader.js';

// 타입 정의 (telemetry-repository의 타입 로컬 미러링 — 서브패스 export 미노출)
export interface SearchQualityResult {
  period: string;
  owner_id: string | null;
  search_count: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  empty_retrieval_rate: number | null;
  avg_candidate_count: number | null;
  top_k_selected_rate: number | null;
  timestamp: string;
}

export interface MemoryQualityResult {
  owner_id: string | null;
  total_memories: number | null;
  type_distribution: Record<string, number> | null;
  duplicate_write_rate_24h: number | null;
  relation_coverage_ratio: number | null;
  orphan_memory_ratio: number | null;
  timestamp: string;
}

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
export type TelemetryType = 'search-quality' | 'memory-quality' | 'system' | 'all';

export interface CliOptions {
  period: TelemetryPeriod;
  type: TelemetryType;
}

const ALLOWED_PERIODS: TelemetryPeriod[] = ['24h', '7d', '30d'];
const ALLOWED_TYPES: TelemetryType[] = ['search-quality', 'memory-quality', 'system', 'all'];

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
export function executeTelemetry(runner: TelemetryRunner, options: CliOptions): TelemetryRunResult {
  try {
    const { period, type } = options;

    const searchResult: SearchQualityResult | null = (type === 'search-quality' || type === 'all')
      ? runner.getSearchQuality(period, null)
      : null;
    const memoryResult: MemoryQualityResult | null = (type === 'memory-quality' || type === 'all')
      ? runner.getMemoryQuality(period, null)
      : null;
    const systemResult: SystemMetricsResult | null = (type === 'system' || type === 'all')
      ? runner.getSystemMetrics(period, null)
      : null;

    const isSearchEmpty = searchResult === null || (
      searchResult.search_count === null &&
      searchResult.avg_latency_ms === null &&
      searchResult.p95_latency_ms === null &&
      searchResult.empty_retrieval_rate === null
    );
    const isMemoryEmpty = memoryResult === null || (
      memoryResult.total_memories === null &&
      memoryResult.duplicate_write_rate_24h === null
    );
    const isSystemEmpty = systemResult === null || (
      systemResult.tools.recall.request_count === null &&
      systemResult.tools.remember.request_count === null &&
      systemResult.tools.feedback.request_count === null
    );

    const allEmpty =
      (type === 'all' && isSearchEmpty && isMemoryEmpty && isSystemEmpty) ||
      (type === 'search-quality' && isSearchEmpty) ||
      (type === 'memory-quality' && isMemoryEmpty) ||
      (type === 'system' && isSystemEmpty);

    if (allEmpty) {
      return { stdout: '기록된 텔레메트리 데이터가 없습니다.\n', stderr: '', exitCode: 0 };
    }

    const parts: string[] = [`=== Memento Telemetry (${period}) ===\n`];

    if (searchResult !== null) {
      parts.push('\n' + formatSearchQuality(searchResult) + '\n');
    }
    if (memoryResult !== null) {
      parts.push('\n' + formatMemoryQuality(memoryResult) + '\n');
    }
    if (systemResult !== null) {
      parts.push('\n' + formatSystemMetrics(systemResult) + '\n');
    }

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
    '  --type    <search-quality|memory-quality|system|all>',
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
  const { createMementoCore, closeDatabase, mementoConfig } = await import('@memento/core');

  const dbPath = process.env.DB_PATH ?? mementoConfig.dbPath;

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
