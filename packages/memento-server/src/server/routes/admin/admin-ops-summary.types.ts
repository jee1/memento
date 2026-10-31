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
  overall_status: 'pass' | 'warning' | 'fail' | null;
  note?: string;
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
  source_gets: string[];
}
