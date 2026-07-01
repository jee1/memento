import type Database from 'better-sqlite3';
import type { TelemetryPeriod } from '../types/telemetry.types.js';
import type { SearchQualityResult } from './telemetry-repository.js';
import {
  percentile95Sorted,
  periodCutoffIso,
  rolling24hCutoffIso
} from './telemetry-repository-utils.js';

/** candidates_retrieved의 candidate_count 평균 — DB에서 json_extract·AVG로 집계(대량 행 JS 파싱 회피) */
function avgCandidateCountForPeriod(
  db: Database.Database,
  cutoffIso: string,
  ownerId: string | null | undefined
): number | null {
  const ownerClause =
    ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
  const qParams: Record<string, unknown> = { cutoff: cutoffIso };
  if (ownerId !== undefined && ownerId !== null) {
    qParams.owner = ownerId;
  }
  const row = db
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

export function querySearchQuality(
  db: Database.Database,
  period: TelemetryPeriod,
  ownerId?: string | null
): SearchQualityResult {
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

  const requested = db
    .prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events
       WHERE event_type = 'memory.search.requested' AND created_at >= @cutoff ${ownerClause}`
    )
    .get(params) as { c: number };

  const emptyC = db
    .prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events
       WHERE event_type = 'memory.search.empty' AND created_at >= @cutoff ${ownerClause}`
    )
    .get(params) as { c: number };

  const candC = db
    .prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events
       WHERE event_type = 'memory.search.candidates_retrieved' AND created_at >= @cutoff ${ownerClause}`
    )
    .get(params) as { c: number };

  const selC = db
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
    const latRows = db
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

    avgCand = avgCandidateCountForPeriod(db, cutoff, ownerId);
  } else {
    const dateFrom = cutoff.slice(0, 10);
    const daily = db
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

    const lat24 = db
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

    avgCand = avgCandidateCountForPeriod(db, cutoff, ownerId);
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
