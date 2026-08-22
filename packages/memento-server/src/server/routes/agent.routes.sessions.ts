import { AgentIntegrationError } from '@memento/core';
import type { Request, Response } from 'express';
import {
  exportObservationDto,
  observationDto,
  provenanceDto,
  sessionDto,
} from './agent.routes.dto.js';
import { buildInjectionDetails } from './agent.routes.injection.js';
import type { AgentRouterCtx } from './agent.routes.types.js';
import { average, percentile, requireString, writeError } from './agent.routes.utils.js';

export function handleGetSessions(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const page = service.listSessions({
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      status: typeof req.query.status === 'string'
        ? req.query.status as NonNullable<Parameters<typeof service.listSessions>[0]>['status']
        : undefined,
      adapterName: typeof req.query.adapter_name === 'string'
        ? req.query.adapter_name
        : typeof req.query.adapter === 'string' ? req.query.adapter : undefined,
      ownerId: typeof req.query.owner_id === 'string' ? req.query.owner_id : undefined,
      projectId: typeof req.query.project_id === 'string' ? req.query.project_id : undefined,
    });
    const aggregate = service.getDashboardAggregate();
    return res.json({
      sessions: page.items.map(item => ({
        session: sessionDto(item.session),
        aggregate: item.aggregate,
      })),
      next_cursor: page.nextCursor,
      aggregate: {
        sessions_total: aggregate.sessionsTotal,
        observations_total: aggregate.observationsTotal,
        redacted_total: aggregate.redactedTotal,
        dropped_total: aggregate.droppedTotal,
        degraded_total: aggregate.degradedTotal,
        late_total: aggregate.lateTotal,
      },
    });
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleGetSessionsAggregate(_req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const aggregate = service.getDashboardAggregate();
    return res.json({
      sessions_total: aggregate.sessionsTotal,
      sessions_by_status: aggregate.sessionsByStatus,
      observations_total: aggregate.observationsTotal,
      observations_by_status: aggregate.observationsByStatus,
      observations_by_event_type: aggregate.observationsByEventType,
      redacted_total: aggregate.redactedTotal,
      dropped_total: aggregate.droppedTotal,
      degraded_total: aggregate.degradedTotal,
      late_total: aggregate.lateTotal,
    });
  } catch (error) {
    return writeError(res, error);
  }
}

export function handlePostInjectionUsage(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service, telemetryRepository } = ctx;
    if (!service || !telemetryRepository) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const sessionId = requireString(req.params.id, 'session_id');
    const session = service.getSession(sessionId);
    if (!session) {
      throw new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
    }
    const injectionId = requireString(req.params.injectionId, 'injection_id');
    const usedMemoryIds = Array.isArray(req.body?.used_memory_ids)
      ? req.body.used_memory_ids.filter((item: unknown): item is string =>
          typeof item === 'string' && item.trim() !== ''
        )
      : [];
    telemetryRepository.insertEventSync({
      eventType: 'agent.injection.used',
      requestId: `agent-injection:${injectionId}`,
      ownerId: session.ownerId,
      outcome: 'success',
      extraData: {
        injection_id: injectionId,
        session_id: session.id,
        observation_id: typeof req.body?.observation_id === 'string'
          ? req.body.observation_id
          : null,
        tool_name: typeof req.body?.tool_name === 'string' ? req.body.tool_name : null,
        used_memory_ids: usedMemoryIds,
      },
    });
    return res.status(202).json({ accepted: true, injection_id: injectionId });
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleGetInjectionMetrics(_req: Request, res: Response, ctx: AgentRouterCtx): Response {
  const { db } = ctx;
  if (!db) {
    return writeError(
      res,
      new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true),
    );
  }
  const rows = db.prepare(`
    SELECT latency_ms, extra_data
    FROM telemetry_events
    WHERE event_type = 'agent.injection.completed'
    ORDER BY latency_ms
  `).all() as Array<{ latency_ms: number | null; extra_data: string | null }>;
  const latencies = rows
    .map(row => row.latency_ms)
    .filter((value): value is number => typeof value === 'number');
  const metrics = rows.map(row => {
    try {
      return JSON.parse(row.extra_data ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  });
  const budgets = metrics
    .map(item => item.token_budget)
    .filter((value): value is number => typeof value === 'number');
  const used = metrics
    .map(item => item.token_used)
    .filter((value): value is number => typeof value === 'number');
  const budgetExceededCount = metrics.filter(item => item.budget_exceeded === true).length;
  return res.json({
    sample_count: rows.length,
    p50_latency_ms: percentile(latencies, 0.5),
    p95_latency_ms: percentile(latencies, 0.95),
    average_token_budget: average(budgets),
    average_token_used: average(used),
    budget_exceeded_count: budgetExceededCount,
    budget_exceeded_rate: rows.length === 0 ? 0 : budgetExceededCount / rows.length,
  });
}

export function handleGetSessionInjections(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service, db } = ctx;
    if (!service || !db) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const sessionId = requireString(req.params.id, 'session_id');
    if (!service.getSession(sessionId)) {
      throw new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
    }
    return res.json(buildInjectionDetails(db, sessionId));
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleGetSessionById(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const sessionId = requireString(req.params.id, 'session_id');
    const session = service.getSession(sessionId);
    if (!session) throw new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
    return res.json({
      session: sessionDto(session),
      aggregate: service.listObservations(sessionId, { limit: 1 }).aggregate,
    });
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleGetSessionObservations(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const sessionId = requireString(req.params.id, 'session_id');
    if (!service.getSession(sessionId)) {
      throw new AgentIntegrationError(
        'Agent session not found',
        'SESSION_NOT_STARTED',
        404,
      );
    }
    const page = service.listObservations(sessionId, {
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      eventType: typeof req.query.event_type === 'string' ? req.query.event_type : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });
    return res.json({
      observations: page.items.map(observationDto),
      next_cursor: page.nextCursor,
      aggregate: page.aggregate,
    });
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleGetSessionExport(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const sessionId = requireString(req.params.id, 'session_id');
    const exported = service.exportSession(sessionId);
    if (!exported) throw new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
    return res.json({
      session: sessionDto(exported.session),
      observations: exported.observations.map(exportObservationDto),
      provenance: exported.provenance.map(provenanceDto),
    });
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleDeleteSession(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const sessionId = requireString(req.params.id, 'session_id');
    if (!service.deleteSession(sessionId)) {
      throw new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
    }
    return res.status(204).send();
  } catch (error) {
    return writeError(res, error);
  }
}
