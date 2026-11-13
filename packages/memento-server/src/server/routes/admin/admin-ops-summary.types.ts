import type { TelemetryPeriod } from '@memento/core';

export type OpsSummaryAvailability = 'measured' | 'unmeasured' | 'partial';

export interface OpsSummaryTimeWindow {
  period: TelemetryPeriod;
  since: string;
  until: string;
}

export interface OpsSummarySearchHealth {
  availability: OpsSummaryAvailability;
  window: OpsSummaryTimeWindow;
  /** recall tool requests in window */
  request_count: number | null;
  /** recall tool errors in window */
  error_count: number | null;
  search_query_count: number | null;
  p95_latency_ms: number | null;
  empty_retrieval_rate: number | null;
  search_failed_events: number;
  recent_search_failures: Array<{ at: string; request_id: string | null }>;
  note?: string;
}

export interface OpsSummaryBatchJobs {
  availability: OpsSummaryAvailability;
  window: OpsSummaryTimeWindow;
  failed_run_count: number;
  success_run_count: number;
  stuck_or_error_jobs: Array<{
    name: string;
    is_running: boolean;
    paused: boolean;
    error_count: number;
  }>;
  recent_failed_runs: Array<{
    job_name: string;
    started_at: string;
    error_count: number | null;
    trigger: string;
  }>;
  note?: string;
}

export interface OpsSummaryLlmPressure {
  availability: OpsSummaryAvailability;
  window: OpsSummaryTimeWindow;
  reason?: string;
  by_feature?: Array<{
    feature: string;
    attempts: number;
    rate_limited: number;
    other_failures: number;
    final_fallback: number;
    final_deferred: number;
  }>;
}

export interface OpsSummaryQualityTrend {
  availability: OpsSummaryAvailability;
  window: OpsSummaryTimeWindow;
  measured_metric_count: number;
  unmeasured_metric_count: number;
  evaluable_metric_count: number;
  history_sample_count: number;
  overall_status: 'pass' | 'warning' | 'fail' | 'no_threshold' | 'unmeasured' | null;
  note?: string;
}

/** Server-computed color for status-first zones (#1698). null = no threshold yet. */
export type OpsSummarySeverity = 'ok' | 'warn' | 'crit' | null;

/**
 * One signal in a zone. `window` is the aggregation period for this value
 * (request `period`, or 30d when sourced from admin_status).
 * Developer `source` strings are intentionally omitted.
 */
export interface OpsSummaryZoneItem {
  key: string;
  value: number | string | boolean | null;
  unit: string | null;
  severity: OpsSummarySeverity;
  as_of: string | null;
  window: OpsSummaryTimeWindow;
}

/**
 * First-screen zones for GET /admin/ops/summary (#1698).
 * Additive only — existing questions.* / admin_status stay unchanged.
 * - system_ok: process/DB, scheduler, batch fails, paused/overdue jobs, versions, auth_denied
 * - doing_work: injection item filter, feedback, search empty split, gate drift, LLM, relation extraction
 * - needs_action: review queue, supersede pending, embedding problems
 */
export interface OpsSummaryZones {
  system_ok: OpsSummaryZoneItem[];
  doing_work: OpsSummaryZoneItem[];
  needs_action: OpsSummaryZoneItem[];
}

export interface OpsSummaryResponse {
  generated_at: string;
  window: OpsSummaryTimeWindow;
  /** Same payload as GET /admin/status (shared contract). */
  admin_status_path: '/admin/status';
  admin_status: ReturnType<typeof import('./admin-status-service.js').buildAdminStatus>;
  questions: {
    search_health: OpsSummarySearchHealth;
    batch_jobs: OpsSummaryBatchJobs;
    llm_pressure: OpsSummaryLlmPressure;
    quality_trend: OpsSummaryQualityTrend;
  };
  /**
   * Status-first zone signals (#1698). Additive; does not alter questions.* or admin_status.
   */
  zones: OpsSummaryZones;
  source_gets: string[];
}
