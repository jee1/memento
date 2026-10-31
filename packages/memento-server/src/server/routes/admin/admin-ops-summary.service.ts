/**
 * Read-only ops summary (Issue #1561 / M4) — composes existing admin GET data shapes.
 */

import type Database from 'better-sqlite3';
import {
  getBatchScheduler,
  JobRunRepository,
  QualityAssuranceService,
  sqliteRepositoryProvider,
  type TelemetryPeriod,
} from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';
import { buildAdminStatus } from './admin-status-service.js';
import { TELEMETRY_PERIODS, effectiveTelemetryPeriod } from './admin-telemetry-utils.js';
import type {
  OpsSummaryAvailability,
  OpsSummaryResponse,
  OpsSummaryTimeWindow,
} from './admin-ops-summary.types.js';

const PERIOD_MS: Record<TelemetryPeriod, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export function resolveOpsSummaryPeriod(raw: string | undefined): TelemetryPeriod | null {
  const effective = effectiveTelemetryPeriod(raw) as TelemetryPeriod;
  return TELEMETRY_PERIODS.includes(effective) ? effective : null;
}

function buildWindow(period: TelemetryPeriod, nowMs: number): OpsSummaryTimeWindow {
  const until = new Date(nowMs).toISOString();
  const since = new Date(nowMs - PERIOD_MS[period]).toISOString();
  return { period, since, until };
}

function countSearchFailures(
  serverServices: ServerServices,
  since: string,
  until: string,
): { count: number; recent: OpsSummaryResponse['questions']['search_health']['recent_search_failures'] } {
  const events = serverServices.telemetryService?.getEvents({
    event_type: 'memory.search.failed',
    from: since,
    to: until,
    limit: 100,
    offset: 0,
  });
  const rows = events?.events ?? [];
  return {
    count: events?.total ?? rows.length,
    recent: rows.slice(0, 5).map((row) => ({
      at: row.created_at,
      request_id: row.request_id ?? null,
    })),
  };
}

function buildBatchSection(
  db: Database.Database | null,
  window: OpsSummaryTimeWindow,
): OpsSummaryResponse['questions']['batch_jobs'] {
  if (!db) {
    return {
      availability: 'unmeasured',
      window,
      failed_run_count: 0,
      success_run_count: 0,
      stuck_or_error_jobs: [],
      recent_failed_runs: [],
    };
  }

  let inWindow: ReturnType<JobRunRepository['list']>;
  try {
    const sinceMs = Date.parse(window.since);
    inWindow = new JobRunRepository()
      .list(db, { limit: 100 })
      .filter((row) => Date.parse(row.started_at) >= sinceMs);
  } catch {
    return {
      availability: 'unmeasured',
      window,
      failed_run_count: 0,
      success_run_count: 0,
      stuck_or_error_jobs: [],
      recent_failed_runs: [],
      note: 'job_run unavailable',
    };
  }
  const failed = inWindow.filter((row) => row.success === 0);
  const success = inWindow.filter((row) => row.success === 1);

  let stuck: OpsSummaryResponse['questions']['batch_jobs']['stuck_or_error_jobs'];
  try {
    const scheduler = getBatchScheduler();
    const detailed = scheduler.getDetailedStats();
    stuck = detailed.jobs
      .filter((job) => job.isRunning || job.errorCount > 0)
      .map((job) => ({
        name: job.name,
        is_running: Boolean(job.isRunning),
        paused: Boolean(
          (job as { paused?: boolean }).paused ??
            (typeof scheduler.isJobPaused === 'function' && scheduler.isJobPaused(job.name)),
        ),
        error_count: job.errorCount,
      }));
  } catch {
    stuck = [];
  }

  return {
    availability: 'measured',
    window,
    failed_run_count: failed.length,
    success_run_count: success.length,
    stuck_or_error_jobs: stuck,
    recent_failed_runs: failed.slice(0, 5).map((row) => ({
      job_name: row.job_name,
      started_at: row.started_at,
      error_count: row.error_count,
      trigger: row.trigger,
    })),
  };
}

async function buildQualitySection(
  db: Database.Database | null,
  window: OpsSummaryTimeWindow,
): Promise<OpsSummaryResponse['questions']['quality_trend']> {
  if (!db) {
    return {
      availability: 'unmeasured',
      window,
      measured_metric_count: 0,
      unmeasured_metric_count: 0,
      evaluable_metric_count: 0,
      history_sample_count: 0,
      overall_status: null,
      note: 'DB unavailable',
    };
  }

  try {
    const service = new QualityAssuranceService(db, sqliteRepositoryProvider);
    const report = await service.getReportData({
      from: window.since,
      to: window.until,
      historyLimit: 20,
    });
    let measured = 0;
    let unmeasured = 0;
    let evaluable = 0;
    for (const metric of report.latest_metrics) {
      const state = metric.measurement_state;
      if (state && state.startsWith('unmeasured')) {
        unmeasured += 1;
      } else if (state === 'measured') {
        measured += 1;
        evaluable += 1;
      } else if (state) {
        unmeasured += 1;
      } else {
        unmeasured += 1;
      }
    }
    const availability: OpsSummaryAvailability =
      report.latest_metrics.length === 0 ? 'partial' : 'measured';
    return {
      availability,
      window,
      measured_metric_count: measured,
      unmeasured_metric_count: unmeasured,
      evaluable_metric_count: evaluable,
      history_sample_count: report.history.length,
      overall_status: report.summary.overall_status,
    };
  } catch {
    return {
      availability: 'unmeasured',
      window,
      measured_metric_count: 0,
      unmeasured_metric_count: 0,
      evaluable_metric_count: 0,
      history_sample_count: 0,
      overall_status: null,
      note: 'quality report unavailable',
    };
  }
}

interface LlmUsageRepositoryPort {
  queryDailyAggregates: (
    from: string,
    to: string,
  ) => Array<{
    feature?: string;
    attempt_count?: number;
    rate_limited_count?: number;
    other_failure_count?: number;
    final_fallback_count?: number;
    final_deferred_count?: number;
  }>;
}

function readLlmUsageRepository(serverServices: ServerServices | null): LlmUsageRepositoryPort | undefined {
  if (!serverServices) return undefined;
  return (serverServices as { llmUsageRepository?: LlmUsageRepositoryPort }).llmUsageRepository;
}

function buildLlmSection(
  serverServices: ServerServices | null,
  window: OpsSummaryTimeWindow,
): OpsSummaryResponse['questions']['llm_pressure'] {
  const repo = readLlmUsageRepository(serverServices);
  if (!repo) {
    return {
      availability: 'unmeasured',
      window,
      reason: 'GET /admin/telemetry/llm-usage not deployed (#1546)',
    };
  }

  const from = window.since.slice(0, 10);
  const to = window.until.slice(0, 10);
  const aggregates = repo.queryDailyAggregates(from, to);
  if (aggregates.length === 0) {
    return {
      availability: 'partial',
      window,
      by_feature: [],
      reason: 'no llm usage rows in window',
    };
  }

  const byFeature = new Map<
    string,
    {
      attempts: number;
      rate_limited: number;
      other_failures: number;
      final_fallback: number;
      final_deferred: number;
    }
  >();

  for (const row of aggregates) {
    const feature = row.feature ?? 'unknown';
    const bucket = byFeature.get(feature) ?? {
      attempts: 0,
      rate_limited: 0,
      other_failures: 0,
      final_fallback: 0,
      final_deferred: 0,
    };
    bucket.attempts += row.attempt_count ?? 0;
    bucket.rate_limited += row.rate_limited_count ?? 0;
    bucket.other_failures += row.other_failure_count ?? 0;
    bucket.final_fallback += row.final_fallback_count ?? 0;
    bucket.final_deferred += row.final_deferred_count ?? 0;
    byFeature.set(feature, bucket);
  }

  return {
    availability: 'measured',
    window,
    by_feature: [...byFeature.entries()].map(([feature, counts]) => ({
      feature,
      ...counts,
    })),
  };
}

export async function buildOpsSummary(
  db: Database.Database | null,
  serverServices: ServerServices | null,
  period: TelemetryPeriod,
  ownerId: string | null,
  nowMs = Date.now(),
): Promise<OpsSummaryResponse> {
  const window = buildWindow(period, nowMs);
  const adminStatus = buildAdminStatus(db);

  const sourceGets = [
    '/admin/status',
    '/admin/batch/stats',
    '/admin/batch/run-history',
    '/admin/telemetry/search-quality',
    '/admin/telemetry/system',
    '/admin/telemetry/events',
    '/api/v1/quality/report',
    '/api/v1/quality/history',
  ];

  let searchHealth: OpsSummaryResponse['questions']['search_health'] = {
    availability: 'unmeasured',
    window,
    request_count: null,
    error_count: null,
    search_query_count: null,
    p95_latency_ms: null,
    empty_retrieval_rate: null,
    search_failed_events: 0,
    recent_search_failures: [],
    note: 'telemetry unavailable',
  };

  if (db && serverServices?.telemetryService) {
    const tel = serverServices.telemetryService;
    const searchQuality = tel.getSearchQuality(period, ownerId);
    const system = tel.getSystemMetrics(period, ownerId);
    const failures = countSearchFailures(serverServices, window.since, window.until);
    const recallBucket = system.tools.recall;
    searchHealth = {
      availability:
        searchQuality.search_count === null && failures.count === 0 ? 'partial' : 'measured',
      window,
      request_count: recallBucket.request_count,
      error_count: recallBucket.error_count,
      search_query_count: searchQuality.search_count,
      p95_latency_ms: searchQuality.p95_latency_ms,
      empty_retrieval_rate: searchQuality.empty_retrieval_rate,
      search_failed_events: failures.count,
      recent_search_failures: failures.recent,
    };
  }

  const batchJobs = buildBatchSection(db, window);
  const llmPressure = buildLlmSection(serverServices, window);
  const qualityTrend = await buildQualitySection(db, window);

  if (readLlmUsageRepository(serverServices)) {
    sourceGets.push('/admin/telemetry/llm-usage');
  }

  return {
    generated_at: new Date(nowMs).toISOString(),
    window,
    admin_status_path: '/admin/status',
    admin_status: adminStatus,
    questions: {
      search_health: searchHealth,
      batch_jobs: batchJobs,
      llm_pressure: llmPressure,
      quality_trend: qualityTrend,
    },
    source_gets: sourceGets,
  };
}
