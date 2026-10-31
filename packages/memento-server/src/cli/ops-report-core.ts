import type { OpsSummaryResponse } from '../server/routes/admin/admin-ops-summary.types.js';

export type OpsReportPeriod = '24h' | '7d' | '30d';

export interface OpsReportOptions {
  endpoint: string;
  apiKey: string;
  period: OpsReportPeriod;
  json: boolean;
  timeoutMs: number;
}

export type OpsReportRequest = (
  path: string,
  init?: RequestInit,
) => Promise<{ status: number; body: unknown }>;

function pad(label: string, width = 22): string {
  return label.padEnd(width, ' ');
}

function fmtAvail(value: string): string {
  if (value === 'measured') return '측정됨';
  if (value === 'partial') return '부분';
  return '미측정';
}

function fmtNum(value: number | null): string {
  return value === null ? 'N/A' : String(value);
}

function fmtRate(value: number | null): string {
  if (value === null) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

export function formatOpsSummaryHuman(data: OpsSummaryResponse): string {
  const w = data.window;
  const lines: string[] = [
    `=== Memento 운영 요약 (${w.period}, ${w.since} ~ ${w.until}) ===`,
    '',
    '[1] 최근 검색 장애·지연',
    `  ${pad('상태')} : ${fmtAvail(data.questions.search_health.availability)}`,
    `  ${pad('recall 요청')} : ${fmtNum(data.questions.search_health.request_count)} (분모)`,
    `  ${pad('recall 오류')} : ${fmtNum(data.questions.search_health.error_count)}`,
    `  ${pad('검색 쿼리')} : ${fmtNum(data.questions.search_health.search_query_count)}`,
    `  ${pad('p95 지연')} : ${fmtNum(data.questions.search_health.p95_latency_ms)} ms`,
    `  ${pad('빈 결과율')} : ${fmtRate(data.questions.search_health.empty_retrieval_rate)}`,
    `  ${pad('search.failed')} : ${data.questions.search_health.search_failed_events}건`,
    '',
    '[2] 배치 실패·정체',
    `  ${pad('상태')} : ${fmtAvail(data.questions.batch_jobs.availability)}`,
    `  ${pad('실패 실행')} : ${data.questions.batch_jobs.failed_run_count} / ${data.questions.batch_jobs.success_run_count + data.questions.batch_jobs.failed_run_count || 0} (실패/표본)`,
    `  ${pad('주의 잡')} : ${data.questions.batch_jobs.stuck_or_error_jobs.length}개`,
    '',
    '[3] 429·fallback·defer (기능별)',
    `  ${pad('상태')} : ${fmtAvail(data.questions.llm_pressure.availability)}`,
  ];

  if (data.questions.llm_pressure.reason) {
    lines.push(`  ${pad('사유')} : ${data.questions.llm_pressure.reason}`);
  }
  for (const row of data.questions.llm_pressure.by_feature ?? []) {
    lines.push(
      `  · ${row.feature}: attempts ${row.attempts}, 429 ${row.rate_limited}, fallback ${row.final_fallback}, defer ${row.final_deferred}`,
    );
  }

  lines.push(
    '',
    '[4] 품질 변화(측정 가능 표본)',
    `  ${pad('상태')} : ${fmtAvail(data.questions.quality_trend.availability)}`,
    `  ${pad('측정 지표')} : ${data.questions.quality_trend.measured_metric_count}`,
    `  ${pad('미측정 지표')} : ${data.questions.quality_trend.unmeasured_metric_count}`,
    `  ${pad('판정 가능')} : ${data.questions.quality_trend.evaluable_metric_count}`,
    `  ${pad('이력 표본')} : ${data.questions.quality_trend.history_sample_count}`,
    `  ${pad('overall')} : ${data.questions.quality_trend.overall_status ?? 'N/A'}`,
    '',
    `admin_status: ${data.admin_status_path} (동일 계약 포함)`,
  );

  return lines.join('\n') + '\n';
}

async function fetchOpsSummary(
  request: OpsReportRequest,
  period: OpsReportPeriod,
): Promise<OpsSummaryResponse> {
  const path = `/admin/ops/summary?period=${encodeURIComponent(period)}`;
  const { status, body } = await request(path, { method: 'GET' });
  if (status === 401 || status === 403) {
    throw new Error(`AUTH_FAILED HTTP ${status}`);
  }
  if (status !== 200) {
    throw new Error(`HTTP ${status}`);
  }
  return body as OpsSummaryResponse;
}

export async function runOpsReport(
  options: OpsReportOptions,
  request: OpsReportRequest,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const payload = await fetchOpsSummary(request, options.period);
    if (options.json) {
      return { stdout: `${JSON.stringify(payload, null, 2)}\n`, stderr: '', exitCode: 0 };
    }
    return { stdout: formatOpsSummaryHuman(payload), stderr: '', exitCode: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: msg, exitCode: 1 };
  }
}
