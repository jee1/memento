/**
 * Telemetry persistence — specs/006 + data-model.md
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type {
  DailyMetricRow,
  EventType,
  Outcome,
  TelemetryEventInput,
  TelemetryEventQueryFilters,
  TelemetryEventRow,
  TelemetryPeriod
} from '../types/telemetry.types.js';

export interface SearchQualityResult {
  period: TelemetryPeriod;
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

function periodCutoffIso(period: TelemetryPeriod): string {
  const d = new Date();
  if (period === '24h') {
    d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
  } else if (period === '7d') {
    d.setTime(d.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    d.setTime(d.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return d.toISOString();
}

function rolling24hCutoffIso(): string {
  const d = new Date();
  d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
  return d.toISOString();
}

/** UTC 롤링 24h 윈도우의 background 잡 텔레메트리 집계 (contracts/admin-api.md `background_jobs` 24h 필드) */
export interface BackgroundJobRolling24hStats {
  successRuns24h: number;
  failureRuns24h: number;
  avgDurationMs24h: number | null;
}

/** p95 from sorted ascending latencies (1-based rank) */
export function percentile95Sorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}

export class TelemetryRepository {
  constructor(private readonly db: Database.Database) {}

  /** candidates_retrieved의 candidate_count 평균 — DB에서 json_extract·AVG로 집계(대량 행 JS 파싱 회피) */
  private avgCandidateCountForPeriod(
    cutoffIso: string,
    ownerId: string | null | undefined
  ): number | null {
    const ownerClause =
      ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
    const qParams: Record<string, unknown> = { cutoff: cutoffIso };
    if (ownerId !== undefined && ownerId !== null) {
      qParams.owner = ownerId;
    }
    const row = this.db
      .prepare(
        `SELECT AVG(CAST(json_extract(extra_data, '$.candidate_count') AS REAL)) AS a
         FROM telemetry_events
         WHERE event_type = 'memory.search.candidates_retrieved'
           AND created_at >= @cutoff
           AND extra_data IS NOT NULL
           ${ownerClause}
           AND json_extract(extra_data, '$.candidate_count') IS NOT NULL`
      )
      .get(qParams) as { a: number | null } | undefined;
    if (row?.a == null || Number.isNaN(row.a)) return null;
    return row.a;
  }

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
    const now = new Date().toISOString();
    const cutoff = periodCutoffIso(period);
    const ownerClause =
      ownerId === undefined || ownerId === null
        ? ''
        : ' AND owner_id = @owner ';
    const params: Record<string, unknown> = { cutoff };
    if (ownerId !== undefined && ownerId !== null) {
      params.owner = ownerId;
    }

    const requested = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM telemetry_events
         WHERE event_type = 'memory.search.requested' AND created_at >= @cutoff ${ownerClause}`
      )
      .get(params) as { c: number };

    const emptyC = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM telemetry_events
         WHERE event_type = 'memory.search.empty' AND created_at >= @cutoff ${ownerClause}`
      )
      .get(params) as { c: number };

    const candC = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM telemetry_events
         WHERE event_type = 'memory.search.candidates_retrieved' AND created_at >= @cutoff ${ownerClause}`
      )
      .get(params) as { c: number };

    const selC = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM telemetry_events
         WHERE event_type = 'memory.search.selected' AND created_at >= @cutoff ${ownerClause}`
      )
      .get(params) as { c: number };

    const searchCount = requested.c;
    const emptyRate =
      searchCount > 0 ? emptyC.c / searchCount : searchCount === 0 ? null : 0;
    const topKRate = candC.c > 0 ? selC.c / candC.c : candC.c === 0 && selC.c === 0 ? null : 0;

    let avgLatency: number | null = null;
    let p95: number | null = null;
    let avgCand: number | null = null;

    if (period === '24h') {
      const latRows = this.db
        .prepare(
          `SELECT latency_ms FROM telemetry_events
           WHERE event_type IN ('memory.search.selected', 'memory.search.empty')
             AND created_at >= @cutoff
             AND latency_ms IS NOT NULL
             ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner '}
           ORDER BY latency_ms ASC`
        )
        .all(params) as { latency_ms: number }[];
      const lats = latRows.map(r => r.latency_ms);
      p95 = percentile95Sorted(lats);
      avgLatency =
        lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : null;

      avgCand = this.avgCandidateCountForPeriod(cutoff, ownerId);
    } else {
      const dateFrom = cutoff.slice(0, 10);
      const daily = this.db
        .prepare(
          `SELECT SUM(event_count) AS total, SUM(event_count * IFNULL(avg_latency_ms, 0)) AS latSum
           FROM telemetry_daily_metrics
           WHERE event_type IN ('memory.search.selected', 'memory.search.empty')
             AND date >= @dateFrom
             ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner '}`
        )
        .get({ ...params, dateFrom }) as { total: number | null; latSum: number | null };
      const t = daily.total ?? 0;
      avgLatency = t > 0 && daily.latSum != null ? daily.latSum / t : null;

      const lat24 = this.db
        .prepare(
          `SELECT latency_ms FROM telemetry_events
           WHERE event_type IN ('memory.search.selected', 'memory.search.empty')
             AND created_at >= @cutoff24
             AND latency_ms IS NOT NULL
             ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner '}
           ORDER BY latency_ms ASC`
        )
        .all({ ...params, cutoff24: rolling24hCutoffIso() }) as { latency_ms: number }[];
      const l24 = lat24.map(r => r.latency_ms);
      p95 = percentile95Sorted(l24);

      avgCand = this.avgCandidateCountForPeriod(cutoff, ownerId);
    }

    return {
      period,
      owner_id: ownerId ?? null,
      search_count: searchCount > 0 ? searchCount : searchCount === 0 ? 0 : null,
      avg_latency_ms: avgLatency,
      p95_latency_ms: p95,
      empty_retrieval_rate: emptyRate,
      avg_candidate_count: avgCand,
      top_k_selected_rate: topKRate,
      timestamp: now
    };
  }

  queryMemoryQuality(ownerId?: string | null): MemoryQualityResult {
    const now = new Date().toISOString();
    const since24h = rolling24hCutoffIso();
    const oClause =
      ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
    const params: Record<string, unknown> = {};
    if (ownerId !== undefined && ownerId !== null) params.owner = ownerId;

    const total = this.db
      .prepare(`SELECT COUNT(*) AS c FROM memory_item WHERE 1=1 ${oClause}`)
      .get(params) as { c: number };

    const byType = this.db
      .prepare(
        `SELECT type, COUNT(*) AS c FROM memory_item WHERE 1=1 ${oClause} GROUP BY type`
      )
      .all(params) as { type: string; c: number }[];

    const dist: Record<string, number> = {};
    const t = total.c;
    for (const row of byType) {
      dist[row.type] = t > 0 ? row.c / t : 0;
    }

    const relOwner =
      ownerId === undefined || ownerId === null
        ? ''
        : ' AND m.owner_id = @owner ';
    const withRel = this.db
      .prepare(
        `SELECT COUNT(DISTINCT m.id) AS c
         FROM memory_item m
         WHERE EXISTS (
           SELECT 1 FROM memory_relation r
           WHERE r.source_id = m.id OR r.target_id = m.id
         ) ${relOwner}`
      )
      .get(params) as { c: number };

    const coverage = t > 0 ? withRel.c / t : null;
    const orphan = coverage != null ? 1 - coverage : null;

    const dupParams = { since24h, ...params };
    const dupClause =
      ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
    const completed = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM telemetry_events
         WHERE event_type = 'memory.write.completed' AND created_at >= @since24h ${dupClause}`
      )
      .get(dupParams) as { c: number };
    const dupes = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM telemetry_events
         WHERE event_type = 'memory.write.completed' AND created_at >= @since24h
           AND json_extract(extra_data, '$.is_duplicate') = 1 ${dupClause}`
      )
      .get(dupParams) as { c: number };
    const dupRate = completed.c > 0 ? dupes.c / completed.c : null;

    return {
      owner_id: ownerId ?? null,
      total_memories: t > 0 ? t : 0,
      type_distribution: t > 0 ? dist : null,
      duplicate_write_rate_24h: dupRate,
      relation_coverage_ratio: coverage,
      orphan_memory_ratio: orphan,
      timestamp: now
    };
  }

  private toolBucketFromEvents(
    eventTypes: { req: EventType; terminal?: EventType[] },
    cutoff: string,
    ownerId?: string | null
  ): ToolMetricBucket {
    const o =
      ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
    const params: Record<string, unknown> = { cutoff };
    if (ownerId !== undefined && ownerId !== null) params.owner = ownerId;

    const reqC = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM telemetry_events WHERE event_type = @et AND created_at >= @cutoff ${o}`
      )
      .get({ ...params, et: eventTypes.req }) as { c: number };

    const terminalTypes = eventTypes.terminal ?? [];
    let successC = 0;
    let errC = 0;
    const latencies: number[] = [];
    if (terminalTypes.length > 0) {
      const placeholders = terminalTypes.map(() => '?').join(',');
      const args: unknown[] = [...terminalTypes, cutoff];
      let sql = `SELECT outcome, latency_ms FROM telemetry_events WHERE event_type IN (${placeholders}) AND created_at >= ? ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = ?'}`;
      if (ownerId !== undefined && ownerId !== null) args.push(ownerId);
      const rows = this.db.prepare(sql).all(...args) as { outcome: Outcome; latency_ms: number | null }[];
      for (const r of rows) {
        if (r.outcome === 'failure') errC++;
        else successC++;
        if (r.latency_ms != null) latencies.push(r.latency_ms);
      }
    }
    latencies.sort((a, b) => a - b);
    const p95 = percentile95Sorted(latencies);
    const avg =
      latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
    const total = reqC.c;
    const errRate = total > 0 ? errC / total : null;

    return {
      request_count: total > 0 ? total : total === 0 ? 0 : null,
      success_count: successC > 0 ? successC : successC === 0 && terminalTypes.length > 0 ? 0 : null,
      error_count: errC > 0 ? errC : errC === 0 && terminalTypes.length > 0 ? 0 : null,
      error_rate: errRate,
      avg_latency_ms: avg,
      p95_latency_ms: p95
    };
  }

  querySystemMetrics(
    period: TelemetryPeriod,
    ownerId: string | null | undefined,
    jobMeta: {
      sleep: SchedulerJobSnapshot;
      telemetryCleanup: SchedulerJobSnapshot;
    }
  ): SystemMetricsResult {
    const cutoff = periodCutoffIso(period);
    const recall = this.toolBucketFromEvents(
      {
        req: 'memory.search.requested',
        terminal: ['memory.search.selected', 'memory.search.empty', 'memory.search.failed']
      },
      cutoff,
      ownerId
    );
    const remember = this.toolBucketFromEvents(
      { req: 'memory.write.requested', terminal: ['memory.write.completed'] },
      cutoff,
      ownerId
    );
    const fbPos = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM telemetry_events WHERE event_type = 'memory.feedback.positive' AND created_at >= @cutoff ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner'}`
      )
      .get(
        ownerId === undefined || ownerId === null
          ? { cutoff }
          : { cutoff, owner: ownerId }
      ) as { c: number };
    const fbNeg = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM telemetry_events WHERE event_type = 'memory.feedback.negative' AND created_at >= @cutoff ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner'}`
      )
      .get(
        ownerId === undefined || ownerId === null
          ? { cutoff }
          : { cutoff, owner: ownerId }
      ) as { c: number };
    const fbTotal = fbPos.c + fbNeg.c;
    const fbLat = this.db
      .prepare(
        `SELECT latency_ms FROM telemetry_events
         WHERE event_type IN ('memory.feedback.positive','memory.feedback.negative')
           AND created_at >= @cutoff
           AND latency_ms IS NOT NULL
           ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner'}
         ORDER BY latency_ms ASC`
      )
      .all(
        ownerId === undefined || ownerId === null
          ? { cutoff }
          : { cutoff, owner: ownerId }
      ) as { latency_ms: number }[];
    const fl = fbLat.map(x => x.latency_ms);
    const feedback: ToolMetricBucket = {
      request_count: fbTotal > 0 ? fbTotal : fbTotal === 0 ? 0 : null,
      success_count: fbTotal > 0 ? fbTotal : fbTotal === 0 ? 0 : null,
      error_count: 0,
      error_rate: 0,
      avg_latency_ms: fl.length > 0 ? fl.reduce((a, b) => a + b, 0) / fl.length : null,
      p95_latency_ms: percentile95Sorted(fl)
    };

    const mapJob = (s: SchedulerJobSnapshot): BackgroundJobMetric => ({
      last_run_at: s.lastExecution ? s.lastExecution.toISOString() : null,
      last_outcome:
        s.lastSuccess === true ? 'success' : s.lastSuccess === false ? 'failure' : null,
      total_runs_24h:
        s.successRuns24h != null && s.failureRuns24h != null
          ? s.successRuns24h + s.failureRuns24h
          : null,
      success_runs_24h: s.successRuns24h,
      failure_runs_24h: s.failureRuns24h,
      avg_duration_ms: s.avgDurationMs24h ?? null,
      last_duration_ms: s.lastDurationMs ?? null
    });

    return {
      period,
      tools: { recall, remember, feedback },
      background_jobs: {
        sleep_consolidation: mapJob(jobMeta.sleep),
        telemetry_cleanup: mapJob(jobMeta.telemetryCleanup)
      },
      timestamp: new Date().toISOString()
    };
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
