import { AgentIntegrationError } from '@memento/core';
import type Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import {
  BATCH_EVENTS,
  BATCH_PAYLOAD_BYTES,
  EVENT_PAYLOAD_BYTES,
  EVENT_TYPES,
} from './agent.routes.constants.js';
import { safeTelemetrySessionId, writeError } from './agent.routes.utils.js';
import type { AgentRouterCtx } from './agent.routes.types.js';
import {
  boundedStatusLimit,
  boundedStatusSince,
} from './agent.routes.utils.js';

interface ObservationRow {
  occurred_at: string;
  status: string;
  drop_reason: string | null;
  session_id: string;
  adapter_name: string;
  event_type: string;
}

interface InjectionRow {
  created_at: string;
  outcome: string;
  error_code: string | null;
  extra_data: string | null;
}

interface ObservationCounts {
  captures: number;
  dropped: number | null;
  degraded: number | null;
}

interface InjectionCounts {
  injections: number;
  degraded: number | null;
}

function queryObservationRows(db: Database.Database, since: string, limit: number): ObservationRow[] {
  return db.prepare(`
    SELECT
      received_at AS occurred_at,
      status,
      drop_reason,
      session_id,
      adapter_name,
      event_type
    FROM agent_observation
    WHERE received_at >= ?
    ORDER BY received_at DESC
    LIMIT ?
  `).all(since, limit) as ObservationRow[];
}

function queryInjectionRows(db: Database.Database, since: string, limit: number): InjectionRow[] {
  return db.prepare(`
    SELECT created_at, outcome, error_code, extra_data
    FROM telemetry_events
    WHERE event_type = 'agent.injection.completed'
      AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(since, limit) as InjectionRow[];
}

function queryObservationCounts(db: Database.Database, since: string): ObservationCounts {
  return db.prepare(`
    SELECT
      COUNT(*) AS captures,
      SUM(CASE WHEN status = 'DROPPED' THEN 1 ELSE 0 END) AS dropped,
      SUM(CASE WHEN status = 'DEGRADED' THEN 1 ELSE 0 END) AS degraded
    FROM agent_observation
    WHERE received_at >= ?
  `).get(since) as ObservationCounts;
}

function queryInjectionCounts(db: Database.Database, since: string): InjectionCounts {
  return db.prepare(`
    SELECT
      COUNT(*) AS injections,
      SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS degraded
    FROM telemetry_events
    WHERE event_type = 'agent.injection.completed'
      AND created_at >= ?
  `).get(since) as InjectionCounts;
}

function buildRecentEvents(
  observationRows: ObservationRow[],
  injectionRows: InjectionRow[],
  limit: number,
) {
  return [
    ...observationRows.map(row => ({
      occurred_at: row.occurred_at,
      kind: 'capture',
      status: row.status,
      reason_code: row.drop_reason ?? 'NONE',
      session_id: row.session_id,
      adapter_name: row.adapter_name,
      event_type: row.event_type,
    })),
    ...injectionRows.map(row => ({
      occurred_at: row.created_at,
      kind: 'injection',
      status: row.outcome === 'failure'
        ? 'degraded'
        : row.outcome === 'empty'
          ? 'empty'
          : 'ok',
      reason_code: row.error_code ?? 'NONE',
      session_id: safeTelemetrySessionId(row.extra_data),
    })),
  ]
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
    .slice(0, limit);
}

export function handleGetCapabilities(_req: Request, res: Response, ctx: AgentRouterCtx): Response {
  return res.json({
    contract_versions: [1],
    event_types: EVENT_TYPES,
    limits: {
      event_payload_bytes: EVENT_PAYLOAD_BYTES,
      batch_events: BATCH_EVENTS,
      batch_payload_bytes: BATCH_PAYLOAD_BYTES,
      hook_return_target_ms: 50,
    },
    features: {
      session_storage: true,
      provenance_trace: true,
      memory_promotion_review: true,
      pre_compact_injection: ctx.injectionService !== undefined,
    },
    schema_ready: ctx.service?.schemaReady() ?? false,
  });
}

export function handleGetOperationsStatus(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service, db, options } = ctx;
    if (!service || !db) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const generatedAt = (options.now ?? (() => new Date()))().toISOString();
    const since = boundedStatusSince(req.query.since, new Date(generatedAt));
    const limit = boundedStatusLimit(req.query.limit);
    const observationRows = queryObservationRows(db, since, limit);
    const injectionRows = queryInjectionRows(db, since, limit);
    const observationCounts = queryObservationCounts(db, since);
    const injectionCounts = queryInjectionCounts(db, since);
    return res.json({
      generated_at: generatedAt,
      window: { since, limit },
      counts: {
        captures: observationCounts.captures,
        injections: injectionCounts.injections,
        dropped: observationCounts.dropped ?? 0,
        degraded: (observationCounts.degraded ?? 0) + (injectionCounts.degraded ?? 0),
      },
      recent_events: buildRecentEvents(observationRows, injectionRows, limit),
    });
  } catch (error) {
    return writeError(res, error);
  }
}
