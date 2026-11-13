/**
 * Ops summary zones (#1698) — additive read-only signals for the status first screen.
 * Severity rules: epic #1697 color table (implemented here; UI does not recompute).
 */

import type Database from 'better-sqlite3';
import {
  getBatchScheduler,
  mementoConfig,
  querySupersedeCandidates,
  readCurrentSchemaVersion,
} from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';
import { resolveJobIntervalMs } from './admin-batch-job-interval-keys.js';
import type { buildAdminStatus } from './admin-status-service.js';
import { readOpsDiskSignals, type OpsDiskSignals } from './admin-ops-summary-disk-signals.js';
import type {
  OpsSummaryLlmPressure,
  OpsSummarySeverity,
  OpsSummaryTimeWindow,
  OpsSummaryZoneItem,
  OpsSummaryZones,
} from './admin-ops-summary.types.js';

const DAY_MS = 86_400_000;

function item(
  key: string,
  value: number | string | boolean | null,
  unit: string | null,
  severity: OpsSummarySeverity,
  asOf: string | null,
  window: OpsSummaryTimeWindow | null,
): OpsSummaryZoneItem {
  return { key, value, unit, severity, as_of: asOf, window };
}

function adminStatusWindow(adminStatus: ReturnType<typeof buildAdminStatus>): OpsSummaryTimeWindow {
  return {
    period: '30d',
    since: adminStatus.since,
    until: adminStatus.timestamp,
  };
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`).get(name) as
    | { ok: number }
    | undefined;
  return Boolean(row);
}

function ownerClause(ownerId: string | null): { sql: string; params: unknown[] } {
  if (ownerId == null || ownerId === '') return { sql: '', params: [] };
  return { sql: ' AND owner_id = ?', params: [ownerId] };
}

function countAuthDenied(db: Database.Database, window: OpsSummaryTimeWindow, ownerId: string | null): number {
  if (!tableExists(db, 'audit_log')) return 0;
  const owner = ownerClause(ownerId);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM audit_log
       WHERE action = 'auth_denied' AND timestamp >= ? AND timestamp <= ?${owner.sql}`,
    )
    .get(window.since, window.until, ...owner.params) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

function lastHumanReviewAt(db: Database.Database): string | null {
  if (!tableExists(db, 'memory_review_candidate')) return null;
  try {
    const row = db
      .prepare(`SELECT MAX(reviewed_at) AS t FROM memory_review_candidate WHERE reviewed_at IS NOT NULL`)
      .get() as { t: string | null } | undefined;
    return row?.t ?? null;
  } catch {
    return null;
  }
}

function countPausedAndOverdue(
  db: Database.Database | null,
  nowMs: number,
): { pausedCount: number; overdueCount: number; asOf: string | null } {
  let pausedCount = 0;
  let overdueCount = 0;
  let asOf: string | null = null;
  try {
    const scheduler = getBatchScheduler();
    const pausedNames = new Set(
      typeof scheduler.getPausedJobNames === 'function' ? scheduler.getPausedJobNames() : [],
    );
    pausedCount = pausedNames.size;
    const lastSuccessByJob = new Map<string, string>();
    if (db && tableExists(db, 'job_run')) {
      const rows = db
        .prepare(
          `SELECT job_name, MAX(started_at) AS last_ok
             FROM job_run WHERE success = 1
             GROUP BY job_name`,
        )
        .all() as Array<{ job_name: string; last_ok: string }>;
      for (const row of rows) {
        lastSuccessByJob.set(row.job_name, row.last_ok);
        if (!asOf || row.last_ok > asOf) asOf = row.last_ok;
      }
    }
    const detailed = scheduler.getDetailedStats();
    const config = (detailed.status.config ?? {}) as unknown as Record<string, unknown>;
    for (const job of detailed.jobs) {
      if (pausedNames.has(job.name)) continue;
      const intervalMs = resolveJobIntervalMs(job.name, config);
      if (intervalMs == null || intervalMs <= 0) continue;
      const lastOk = lastSuccessByJob.get(job.name);
      // No success row yet: skip (new job / cleanup wipe) — do not treat as overdue.
      if (!lastOk) continue;
      const elapsed = nowMs - Date.parse(lastOk);
      if (Number.isFinite(elapsed) && elapsed > intervalMs * 2) {
        overdueCount += 1;
      }
    }
  } catch {
    /* scheduler unavailable → zeros */
  }
  return { pausedCount, overdueCount, asOf };
}

function batchFailureSeverity(
  adminStatus: ReturnType<typeof buildAdminStatus>,
  nowMs: number,
): OpsSummarySeverity {
  const impact = adminStatus.batchImpact;
  const lastFailedAt = impact.lastFailedAt;
  if (lastFailedAt) {
    const age = nowMs - Date.parse(lastFailedAt);
    if (Number.isFinite(age) && age <= DAY_MS) return 'crit';
  }
  if (impact.failedRunCount > 0 || impact.durationMsSum > 0 || lastFailedAt) return 'warn';
  return 'ok';
}

function decomposeEmptySearch(
  db: Database.Database,
  window: OpsSummaryTimeWindow,
  ownerId: string | null,
): { rejected: number; no_result: number; total: number; asOf: string | null } {
  if (!tableExists(db, 'telemetry_events')) {
    return { rejected: 0, no_result: 0, total: 0, asOf: null };
  }
  const owner = ownerClause(ownerId);
  const empties = db
    .prepare(
      `SELECT request_id, created_at FROM telemetry_events
       WHERE event_type = 'memory.search.empty'
         AND created_at >= ? AND created_at <= ?${owner.sql}
       ORDER BY created_at DESC`,
    )
    .all(window.since, window.until, ...owner.params) as Array<{
    request_id: string | null;
    created_at: string;
  }>;
  let rejected = 0;
  let no_result = 0;
  const asOf = empties[0]?.created_at ?? null;
  const verdictStmt = db.prepare(
    `SELECT json_extract(extra_data, '$.rejection_gate_verdict') AS verdict
       FROM telemetry_events
      WHERE event_type = 'memory.search.reranked' AND request_id = ?
      ORDER BY created_at DESC LIMIT 1`,
  );
  for (const row of empties) {
    let verdict: string | null = null;
    if (row.request_id) {
      const hit = verdictStmt.get(row.request_id) as { verdict: string | null } | undefined;
      verdict = hit?.verdict ?? null;
    }
    if (verdict === 'rejected') rejected += 1;
    else no_result += 1;
  }
  return { rejected, no_result, total: empties.length, asOf };
}

function readItemFilterStats(
  db: Database.Database,
  window: OpsSummaryTimeWindow,
  ownerId: string | null,
): {
  events: number;
  kept: number;
  dropped: number;
  filter_empty: number;
  injection_empty: number;
  asOf: string | null;
} {
  if (!tableExists(db, 'telemetry_events')) {
    return { events: 0, kept: 0, dropped: 0, filter_empty: 0, injection_empty: 0, asOf: null };
  }
  const owner = ownerClause(ownerId);
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS events,
         COALESCE(SUM(CAST(json_extract(extra_data, '$.item_filter_kept') AS INTEGER)), 0) AS kept,
         COALESCE(SUM(CAST(json_extract(extra_data, '$.item_filter_dropped') AS INTEGER)), 0) AS dropped,
         COALESCE(SUM(CASE WHEN json_extract(extra_data, '$.item_filter_empty') IN (1, 'true', true)
                           THEN 1 ELSE 0 END), 0) AS filter_empty,
         COALESCE(SUM(CASE WHEN outcome = 'empty' THEN 1 ELSE 0 END), 0) AS injection_empty,
         MAX(created_at) AS as_of
       FROM telemetry_events
       WHERE event_type = 'memory.injection.item_filtered'
         AND created_at >= ? AND created_at <= ?${owner.sql}`,
    )
    .get(window.since, window.until, ...owner.params) as {
    events: number;
    kept: number;
    dropped: number;
    filter_empty: number;
    injection_empty: number;
    as_of: string | null;
  };
  return {
    events: Number(row?.events ?? 0),
    kept: Number(row?.kept ?? 0),
    dropped: Number(row?.dropped ?? 0),
    filter_empty: Number(row?.filter_empty ?? 0),
    injection_empty: Number(row?.injection_empty ?? 0),
    asOf: row?.as_of ?? null,
  };
}

function countRelationExtractionFailures(
  db: Database.Database,
  window: OpsSummaryTimeWindow,
): { fail: number; asOf: string | null } {
  if (!tableExists(db, 'llm_usage_attempt')) return { fail: 0, asOf: null };
  try {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN outcome != 'success' THEN 1 ELSE 0 END), 0) AS fail,
           MAX(created_at) AS as_of
         FROM llm_usage_attempt
         WHERE feature = 'relation_extraction'
           AND created_at >= ? AND created_at <= ?`,
      )
      .get(window.since, window.until) as { fail: number; as_of: string | null } | undefined;
    return { fail: Number(row?.fail ?? 0), asOf: row?.as_of ?? null };
  } catch {
    return { fail: 0, asOf: null };
  }
}

function supersedePendingCount(db: Database.Database): number {
  try {
    const result = querySupersedeCandidates(db, { page: 1, page_size: 25 });
    return result.pagination.total_count;
  } catch {
    return 0;
  }
}

function buildSystemOkZone(
  db: Database.Database | null,
  window: OpsSummaryTimeWindow,
  ownerId: string | null,
  nowMs: number,
  adminStatus: ReturnType<typeof buildAdminStatus>,
  diskSignals: OpsDiskSignals,
): OpsSummaryZoneItem[] {
  const statusWindow = adminStatusWindow(adminStatus);
  const generatedAt = new Date(nowMs).toISOString();
  const { pausedCount, overdueCount, asOf: jobAsOf } = countPausedAndOverdue(db, nowMs);
  return [
    item(
      'process_database',
      adminStatus.process.database,
      null,
      adminStatus.process.database === 'disconnected' ? 'crit' : 'ok',
      adminStatus.timestamp,
      statusWindow,
    ),
    item(
      'scheduler_running',
      adminStatus.scheduler.running,
      null,
      adminStatus.scheduler.running ? 'ok' : 'crit',
      adminStatus.timestamp,
      statusWindow,
    ),
    item(
      'batch_failed_run_count',
      adminStatus.batchImpact.failedRunCount,
      'count',
      batchFailureSeverity(adminStatus, nowMs),
      adminStatus.batchImpact.lastFailedAt,
      statusWindow,
    ),
    item(
      'paused_job_count',
      pausedCount,
      'count',
      pausedCount > 0 ? 'warn' : 'ok',
      jobAsOf ?? generatedAt,
      window,
    ),
    item(
      'job_interval_overdue_count',
      overdueCount,
      'count',
      overdueCount > 0 ? 'warn' : 'ok',
      jobAsOf ?? generatedAt,
      window,
    ),
    item('server_version', mementoConfig.serverVersion, null, null, generatedAt, window),
    item('schema_version', db ? readCurrentSchemaVersion(db) : null, null, null, generatedAt, window),
    item(
      'auth_denied_count',
      db ? countAuthDenied(db, window, ownerId) : 0,
      'count',
      null,
      generatedAt,
      window,
    ),
    ...buildDiskSignalItems(generatedAt, diskSignals),
  ];
}

/** Migration backup + DB/WAL sizes (#1704). severity null; window null (= 현재). */
function buildDiskSignalItems(generatedAt: string, disk: OpsDiskSignals): OpsSummaryZoneItem[] {
  return [
    item(
      'migration_backup',
      disk.migration_backup_latest_at,
      null,
      null,
      disk.migration_backup_latest_at,
      null,
    ),
    item(
      'migration_backup_file_count',
      disk.migration_backup_file_count,
      'count',
      null,
      disk.migration_backup_latest_at,
      null,
    ),
    item('db_size_mb', disk.db_size_mb, 'MB', null, generatedAt, null),
    item('wal_size_mb', disk.wal_size_mb, 'MB', null, generatedAt, null),
  ];
}

function readTelemetrySignals(
  serverServices: ServerServices | null,
  window: OpsSummaryTimeWindow,
  ownerId: string | null,
  generatedAt: string,
): {
  feedbackPositive: number;
  feedbackNegative: number;
  feedbackAsOf: string | null;
  searchCount: number | null;
  gateDriftAlert: boolean | null;
  gateDriftAsOf: string | null;
} {
  let feedbackPositive = 0;
  let feedbackNegative = 0;
  let feedbackAsOf: string | null = null;
  let searchCount: number | null = null;
  let gateDriftAlert: boolean | null = null;
  let gateDriftAsOf: string | null = null;
  const tel = serverServices?.telemetryService;
  if (!tel) {
    return {
      feedbackPositive,
      feedbackNegative,
      feedbackAsOf,
      searchCount,
      gateDriftAlert,
      gateDriftAsOf,
    };
  }
  try {
    const feedback = tel.getFeedbackQuality(window.period, ownerId);
    feedbackPositive = feedback.positive_count ?? 0;
    feedbackNegative = feedback.negative_count ?? 0;
    feedbackAsOf = generatedAt;
  } catch {
    /* zeros */
  }
  try {
    searchCount = tel.getSearchQuality(window.period, ownerId).search_count;
  } catch {
    searchCount = null;
  }
  if (ownerId === null) {
    try {
      const latest = tel.getRejectionGateDrift().latest_verdict;
      if (latest) {
        gateDriftAlert = Boolean(latest.alert);
        gateDriftAsOf = latest.checked_at;
      } else {
        gateDriftAlert = false;
      }
    } catch {
      gateDriftAlert = null;
    }
  }
  return {
    feedbackPositive,
    feedbackNegative,
    feedbackAsOf,
    searchCount,
    gateDriftAlert,
    gateDriftAsOf,
  };
}

function buildDoingWorkZone(
  db: Database.Database | null,
  serverServices: ServerServices | null,
  window: OpsSummaryTimeWindow,
  ownerId: string | null,
  nowMs: number,
  llmPressure: OpsSummaryLlmPressure,
): OpsSummaryZoneItem[] {
  const generatedAt = new Date(nowMs).toISOString();
  const filter = db
    ? readItemFilterStats(db, window, ownerId)
    : { events: 0, kept: 0, dropped: 0, filter_empty: 0, injection_empty: 0, asOf: null };
  const emptySearch = db
    ? decomposeEmptySearch(db, window, ownerId)
    : { rejected: 0, no_result: 0, total: 0, asOf: null };
  const tel = readTelemetrySignals(serverServices, window, ownerId, generatedAt);
  const gateDriftSeverity: OpsSummarySeverity =
    tel.gateDriftAlert === true ? 'warn' : tel.gateDriftAlert === false ? 'ok' : null;
  const relation = db ? countRelationExtractionFailures(db, window) : { fail: 0, asOf: null };
  const llmItems: OpsSummaryZoneItem[] = [];
  for (const row of llmPressure.by_feature ?? []) {
    llmItems.push(
      item(`llm_${row.feature}_attempts`, row.attempts, 'count', null, generatedAt, window),
      item(`llm_${row.feature}_other_failures`, row.other_failures, 'count', null, generatedAt, window),
      item(`llm_${row.feature}_rate_limited`, row.rate_limited, 'count', null, generatedAt, window),
    );
  }
  return [
    item('injection_item_filtered_events', filter.events, 'count', null, filter.asOf, window),
    item('item_filter_kept', filter.kept, 'count', null, filter.asOf, window),
    item('item_filter_dropped', filter.dropped, 'count', null, filter.asOf, window),
    item('item_filter_empty', filter.filter_empty, 'count', null, filter.asOf, window),
    item('injection_empty', filter.injection_empty, 'count', null, filter.asOf, window),
    item('feedback_positive_count', tel.feedbackPositive, 'count', null, tel.feedbackAsOf, window),
    item('feedback_negative_count', tel.feedbackNegative, 'count', null, tel.feedbackAsOf, window),
    item('search_query_count', tel.searchCount, 'count', null, generatedAt, window),
    item('search_empty_rejected', emptySearch.rejected, 'count', null, emptySearch.asOf, window),
    item('search_empty_no_result', emptySearch.no_result, 'count', null, emptySearch.asOf, window),
    item('gate_drift_alert', tel.gateDriftAlert, null, gateDriftSeverity, tel.gateDriftAsOf, window),
    ...llmItems,
    item('relation_extraction_failures', relation.fail, 'count', null, relation.asOf, window),
  ];
}

function reviewSeverityFor(
  pendingTotal: number,
  lastReview: string | null,
  nowMs: number,
): OpsSummarySeverity {
  if (pendingTotal <= 0) return 'ok';
  if (!lastReview) return 'warn';
  const age = nowMs - Date.parse(lastReview);
  return Number.isFinite(age) && age > 30 * DAY_MS ? 'warn' : 'ok';
}

function buildNeedsActionZone(
  db: Database.Database | null,
  window: OpsSummaryTimeWindow,
  nowMs: number,
  adminStatus: ReturnType<typeof buildAdminStatus>,
): OpsSummaryZoneItem[] {
  const statusWindow = adminStatusWindow(adminStatus);
  const generatedAt = new Date(nowMs).toISOString();
  const lastReview = db ? lastHumanReviewAt(db) : null;
  const pendingTotal = adminStatus.review.pendingTotal;
  const reviewSeverity = reviewSeverityFor(pendingTotal, lastReview, nowMs);
  const netFlow = adminStatus.review.netFlow1h;
  const embeddingProblems = adminStatus.embedding.problemCount;
  return [
    item('review_pending_total', pendingTotal, 'count', reviewSeverity, lastReview, statusWindow),
    item('review_last_human_decision_at', lastReview, null, reviewSeverity, lastReview, statusWindow),
    item(
      'review_net_flow_1h',
      netFlow,
      'count',
      netFlow > 0 ? 'warn' : 'ok',
      adminStatus.timestamp,
      statusWindow,
    ),
    item(
      'supersede_pending_count',
      db ? supersedePendingCount(db) : 0,
      'count',
      null,
      generatedAt,
      window,
    ),
    item(
      'embedding_problem_count',
      embeddingProblems,
      'count',
      embeddingProblems > 0 ? 'warn' : 'ok',
      adminStatus.timestamp,
      statusWindow,
    ),
  ];
}

export function buildOpsSummaryZones(input: {
  db: Database.Database | null;
  serverServices: ServerServices | null;
  window: OpsSummaryTimeWindow;
  ownerId: string | null;
  nowMs: number;
  adminStatus: ReturnType<typeof buildAdminStatus>;
  llmPressure: OpsSummaryLlmPressure;
  /** Override for tests; default reads dirname(dbPath)/backups + db/wal stat. */
  diskSignals?: OpsDiskSignals;
}): OpsSummaryZones {
  const diskSignals = input.diskSignals ?? readOpsDiskSignals();
  return {
    system_ok: buildSystemOkZone(
      input.db,
      input.window,
      input.ownerId,
      input.nowMs,
      input.adminStatus,
      diskSignals,
    ),
    doing_work: buildDoingWorkZone(
      input.db,
      input.serverServices,
      input.window,
      input.ownerId,
      input.nowMs,
      input.llmPressure,
    ),
    needs_action: buildNeedsActionZone(input.db, input.window, input.nowMs, input.adminStatus),
  };
}

/** Test helper: empty-search split only. */
export function decomposeEmptySearchForTest(
  db: Database.Database,
  window: OpsSummaryTimeWindow,
  ownerId: string | null,
): { rejected: number; no_result: number; total: number } {
  const r = decomposeEmptySearch(db, window, ownerId);
  return { rejected: r.rejected, no_result: r.no_result, total: r.total };
}
