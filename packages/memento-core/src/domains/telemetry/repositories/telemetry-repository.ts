/**
 * Telemetry persistence — specs/006 + data-model.md
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type {
EventType,
TelemetryEventInput,
TelemetryEventQueryFilters,
TelemetryEventRow,
TelemetryPeriod
} from '../types/telemetry.types.js';
import {
  queryConsolidationQuality,
  queryMemoryQuality
} from './telemetry-memory-quality-query.js';
import { querySearchQuality } from './telemetry-search-quality-query.js';
import { queryFeedbackQuality } from './telemetry-feedback-quality-query.js';
import { querySystemMetrics } from './telemetry-system-metrics-query.js';
import { rolling24hCutoffIso } from './telemetry-repository-utils.js';
export { percentile95Sorted } from './telemetry-repository-utils.js';

export interface SearchQualityResult {
  period: TelemetryPeriod;
  owner_id: string | null;
  search_count: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  empty_retrieval_rate: number | null;
  avg_candidate_count: number | null;
  top_k_selected_rate: number | null;
  text_candidate_count: number;
  vector_candidate_count: number;
  union_candidate_count: number;
  reranked_count: number;
  selected_count: number;
  ranking_versions: string[];
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

/** recall 피드백 품질 (Issue #666) */
export interface FeedbackQualityResult {
  period: TelemetryPeriod;
  owner_id: string | null;
  helpful_rate: number | null;
  positive_count: number;
  negative_count: number;
  feedback_with_ranking_context_count: number;
  timestamp: string;
}

/** 공고화 파이프라인 품질 (FR-009, SC-007) */
export interface ConsolidationQualityResult {
  episodic_consolidation_rate: number | null;
  triple_extraction_success_rate: number | null;
  cluster_processing_efficiency: number | null;
  recent_semantic_count_7d: number | null;
  pipeline_error_count: number | null;
  timestamp: string;
}

export interface ToolMetricBucket {
  request_count: number | null;
  success_count: number | null;
  error_count: number | null;
  error_rate: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
}

export interface BackgroundJobMetric {
  last_run_at: string | null;
  last_outcome: 'success' | 'failure' | null;
  total_runs_24h: number | null;
  success_runs_24h: number | null;
  failure_runs_24h: number | null;
  /** 24h 롤링 평균(ms); 미구현 시 null */
  avg_duration_ms: number | null;
  /** 직전 실행 duration(ms); avg_duration_ms가 null일 때 참고 */
  last_duration_ms: number | null;
}

export interface SystemMetricsResult {
  period: TelemetryPeriod;
  tools: {
    recall: ToolMetricBucket;
    remember: ToolMetricBucket;
    feedback: ToolMetricBucket;
  };
  background_jobs: {
    sleep_consolidation: BackgroundJobMetric;
    telemetry_cleanup: BackgroundJobMetric;
  };
  timestamp: string;
}

export interface SchedulerJobSnapshot {
  lastExecution: Date | null;
  lastSuccess: boolean | null;
  lastDurationMs: number | null;
  /** 롤링 24h(UTC) 텔레메트리 집계; 알 수 없는 잡 이름이면 null */
  successRuns24h: number | null;
  failureRuns24h: number | null;
  /** 24h 평균 duration(ms); 해당 기간 latency 샘플 없으면 null */
  avgDurationMs24h: number | null;
}

/** UTC 롤링 24h 윈도우의 background 잡 텔레메트리 집계. */
export interface BackgroundJobRolling24hStats {
  successRuns24h: number;
  failureRuns24h: number;
  avgDurationMs24h: number | null;
}

export class TelemetryRepository {
  constructor(private readonly db: Database.Database) {}

  insertEventSync(event: TelemetryEventInput): void {
    const id = randomUUID();
    const extraJson = event.extraData !== undefined ? JSON.stringify(event.extraData) : null;
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO telemetry_events
        (id, event_type, request_id, owner_id, latency_ms, outcome, error_code, extra_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        event.eventType,
        event.requestId,
        event.ownerId,
        event.latencyMs ?? null,
        event.outcome,
        event.errorCode ?? null,
        extraJson,
        createdAt
      );
    this.upsertDailyMetricRow(event, createdAt);
  }

  private upsertDailyMetricRow(event: TelemetryEventInput, createdAtIso: string): void {
    const dateKey = createdAtIso.slice(0, 10);
    const ownerKey = event.ownerId ?? '';
    const metricId = randomUUID();
    const lat = event.latencyMs ?? null;
    const errInc = event.outcome !== 'success' ? 1 : 0;
    const latForAvg = lat === null ? null : lat;
    this.db
      .prepare(
        `INSERT INTO telemetry_daily_metrics
        (id, date, event_type, owner_id, event_count, avg_latency_ms, error_count, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ON CONFLICT(date, event_type, owner_id) DO UPDATE SET
          event_count = event_count + 1,
          /* 일별 평균 지연: 기존 가중 평균에 이번 샘플 1건을 반영 */
          avg_latency_ms = CASE
            WHEN excluded.avg_latency_ms IS NULL THEN avg_latency_ms
            WHEN avg_latency_ms IS NULL THEN excluded.avg_latency_ms
            ELSE (avg_latency_ms * event_count + excluded.avg_latency_ms) / (event_count + 1)
          END,
          error_count = error_count + CASE WHEN excluded.error_count > 0 THEN 1 ELSE 0 END,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      )
      .run(metricId, dateKey, event.eventType, ownerKey, latForAvg, errInc);
  }

  deleteExpiredEvents(retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const r = this.db.prepare(`DELETE FROM telemetry_events WHERE created_at < ?`).run(cutoff);
    return r.changes;
  }

  /**
   * `consolidation.performed` / `telemetry.cleanup.performed` 등 잡 단위 이벤트의 롤링 24h 집계.
   * 스펙: `background_jobs.*.total_runs_24h` 등은 UTC 롤링 24h이며 `period` 쿼리와 무관.
   */
  getBackgroundJobRolling24hStats(eventType: EventType): BackgroundJobRolling24hStats {
    const cutoff = rolling24hCutoffIso();
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS s,
           COALESCE(SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END), 0) AS f,
           AVG(latency_ms) AS avg_lat
         FROM telemetry_events
         WHERE event_type = @et AND created_at >= @cutoff`
      )
      .get({ et: eventType, cutoff }) as {
      s: number;
      f: number;
      avg_lat: number | null;
    };
    return {
      successRuns24h: row.s,
      failureRuns24h: row.f,
      avgDurationMs24h: row.avg_lat != null && !Number.isNaN(row.avg_lat) ? row.avg_lat : null
    };
  }

  hasPriorWriteCompletedWithContentHash(ownerId: string | null, contentHash: string, sinceIso: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok FROM telemetry_events
         WHERE event_type = 'memory.write.completed'
           AND created_at >= ?
           AND json_extract(extra_data, '$.content_hash') = ?
           AND COALESCE(owner_id, '') = COALESCE(?, '')
         LIMIT 1`
      )
      .get(sinceIso, contentHash, ownerId ?? '') as { ok: number } | undefined;
    return Boolean(row);
  }

  querySearchQuality(period: TelemetryPeriod, ownerId?: string | null): SearchQualityResult {
    return querySearchQuality(this.db, period, ownerId);
  }

  queryMemoryQuality(period: TelemetryPeriod, ownerId?: string | null): MemoryQualityResult {
    return queryMemoryQuality(this.db, period, ownerId);
  }

  /** Sleep 공고화·트리플 추출 등 구조화 파이프라인 품질 지표 (기간·owner 선택) */
  queryConsolidationQuality(period: TelemetryPeriod, ownerId?: string | null): ConsolidationQualityResult {
    return queryConsolidationQuality(this.db, period, ownerId);
  }

  queryFeedbackQuality(period: TelemetryPeriod, ownerId?: string | null): FeedbackQualityResult {
    return queryFeedbackQuality(this.db, period, ownerId);
  }

  querySystemMetrics(
    period: TelemetryPeriod,
    ownerId: string | null | undefined,
    jobMeta: {
      sleep: SchedulerJobSnapshot;
      telemetryCleanup: SchedulerJobSnapshot;
    }
  ): SystemMetricsResult {
    return querySystemMetrics(this.db, period, ownerId, jobMeta);
  }

  queryEvents(filters: TelemetryEventQueryFilters): {
    events: TelemetryEventRow[];
    total: number;
  } {
    const clauses: string[] = ['1=1'];
    const params: unknown[] = [];
    if (filters.event_type) {
      clauses.push('event_type = ?');
      params.push(filters.event_type);
    }
    if (filters.request_id) {
      clauses.push('request_id = ?');
      params.push(filters.request_id);
    }
    if (filters.owner_id) {
      clauses.push('owner_id = ?');
      params.push(filters.owner_id);
    }
    if (filters.from) {
      clauses.push('created_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push('created_at <= ?');
      params.push(filters.to);
    }
    if (filters.outcome) {
      clauses.push('outcome = ?');
      params.push(filters.outcome);
    }
    const where = clauses.join(' AND ');
    const countRow = this.db.prepare(`SELECT COUNT(*) AS c FROM telemetry_events WHERE ${where}`).get(...params) as {
      c: number;
    };
    const lim = Math.min(100, Math.max(1, filters.limit));
    const off = Math.max(0, filters.offset);
    const rows = this.db
      .prepare(
        `SELECT id, event_type, request_id, owner_id, latency_ms, outcome, error_code, extra_data, created_at
         FROM telemetry_events WHERE ${where}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, lim, off) as TelemetryEventRow[];
    return { events: rows, total: countRow.c };
  }

  /** Test helper: read events for request */
  listEventsForRequest(requestId: string): TelemetryEventRow[] {
    return this.db
      .prepare(
        `SELECT id, event_type, request_id, owner_id, latency_ms, outcome, error_code, extra_data, created_at
         FROM telemetry_events WHERE request_id = ? ORDER BY created_at ASC`
      )
      .all(requestId) as TelemetryEventRow[];
  }
}
