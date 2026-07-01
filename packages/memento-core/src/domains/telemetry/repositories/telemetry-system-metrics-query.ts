import type Database from 'better-sqlite3';
import type {
  EventType,
  Outcome,
  TelemetryPeriod
} from '../types/telemetry.types.js';
import type {
  BackgroundJobMetric,
  SchedulerJobSnapshot,
  SystemMetricsResult,
  ToolMetricBucket
} from './telemetry-repository.js';
import { percentile95Sorted, periodCutoffIso } from './telemetry-repository-utils.js';

function toolBucketFromEvents(
  db: Database.Database,
  eventTypes: { req: EventType; terminal?: EventType[] },
  cutoff: string,
  ownerId?: string | null
): ToolMetricBucket {
  const o =
    ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner ';
  const params: Record<string, unknown> = { cutoff };
  if (ownerId !== undefined && ownerId !== null) params.owner = ownerId;

  const reqC = db
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
    const sql = `SELECT outcome, latency_ms FROM telemetry_events WHERE event_type IN (${placeholders}) AND created_at >= ? ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = ?'}`;
    if (ownerId !== undefined && ownerId !== null) args.push(ownerId);
    const rows = db.prepare(sql).all(...args) as { outcome: Outcome; latency_ms: number | null }[];
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

function mapJob(s: SchedulerJobSnapshot): BackgroundJobMetric {
  return {
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
  };
}

export function querySystemMetrics(
  db: Database.Database,
  period: TelemetryPeriod,
  ownerId: string | null | undefined,
  jobMeta: {
    sleep: SchedulerJobSnapshot;
    telemetryCleanup: SchedulerJobSnapshot;
  }
): SystemMetricsResult {
  const cutoff = periodCutoffIso(period);
  const recall = toolBucketFromEvents(
    db,
    {
      req: 'memory.search.requested',
      terminal: ['memory.search.selected', 'memory.search.empty', 'memory.search.failed']
    },
    cutoff,
    ownerId
  );
  const remember = toolBucketFromEvents(
    db,
    { req: 'memory.write.requested', terminal: ['memory.write.completed'] },
    cutoff,
    ownerId
  );
  const fbPos = db
    .prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events WHERE event_type = 'memory.feedback.positive' AND created_at >= @cutoff ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner'}`
    )
    .get(
      ownerId === undefined || ownerId === null
        ? { cutoff }
        : { cutoff, owner: ownerId }
    ) as { c: number };
  const fbNeg = db
    .prepare(
      `SELECT COUNT(*) AS c FROM telemetry_events WHERE event_type = 'memory.feedback.negative' AND created_at >= @cutoff ${ownerId === undefined || ownerId === null ? '' : ' AND owner_id = @owner'}`
    )
    .get(
      ownerId === undefined || ownerId === null
        ? { cutoff }
        : { cutoff, owner: ownerId }
    ) as { c: number };
  const fbTotal = fbPos.c + fbNeg.c;
  const fbLat = db
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
