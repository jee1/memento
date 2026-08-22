import {
  AgentIntegrationError,
  AgentLifecycleService,
  SqliteAgentIntegrationRepository,
} from '@memento/core';
import type { AgentContextInjectionBundle } from '@memento/core';
import type { Request, Response } from 'express';
import { BATCH_EVENTS, BATCH_PAYLOAD_BYTES } from './agent.routes.constants.js';
import { injectionDto, observationDto, sessionDto } from './agent.routes.dto.js';
import { prepareEvent } from './agent.routes.events.js';
import { initialInjectionQuery, injectionScope } from './agent.routes.injection.js';
import type { AgentRouterCtx } from './agent.routes.types.js';
import { parsePayload, writeError } from './agent.routes.utils.js';

export async function handlePostSessions(
  req: Request,
  res: Response,
  ctx: AgentRouterCtx,
): Promise<Response> {
  try {
    const { service, db, injectionService, buildInjection, recordInjection, initialInjectionTokenBudget } = ctx;
    if (!service || !db) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const prepared = prepareEvent(req.body);
    if (prepared.eventType !== 'SESSION_START') {
      throw new AgentIntegrationError('SESSION_START is required', 'INTERNAL_ERROR', 400);
    }
    const result = service.capture(prepared);
    const injection = injectionService
      ? await buildInjection({
          trigger: 'session_start',
          query: initialInjectionQuery(prepared),
          scope: injectionScope(prepared),
          tokenBudget: initialInjectionTokenBudget,
        })
      : null;
    if (injection) {
      recordInjection(injection, prepared.scope.ownerId ?? null, prepared.sessionId);
    }
    return res.status(201).json({
      session: sessionDto(service.getSession(prepared.sessionId)!),
      observation: observationDto(
        new SqliteAgentIntegrationRepository(db).getObservation(result.observationId)!,
      ),
      result: {
        event_id: result.eventId,
        status: result.status,
        reason_code: result.reasonCode,
        observation_id: result.observationId,
        late_arrival: result.lateArrival,
      },
      initial_injection: injection ? injectionDto(injection) : null,
    });
  } catch (error) {
    return writeError(res, error);
  }
}

interface BatchPrepResult {
  prepared?: ReturnType<typeof prepareEvent>;
  errorResult?: { event_id: string; status: string; reason_code: string; late_arrival: boolean };
}

function prepareBatchEvent(item: unknown): BatchPrepResult {
  try {
    return { prepared: prepareEvent(item) };
  } catch (error) {
    const eventId =
      item && typeof item === 'object' && 'event_id' in item
      && typeof (item as { event_id?: unknown }).event_id === 'string'
        ? (item as { event_id: string }).event_id
        : '';
    if (error instanceof AgentIntegrationError) {
      return { errorResult: { event_id: eventId, status: 'INVALID', reason_code: error.reasonCode, late_arrival: false } };
    }
    return { errorResult: { event_id: eventId, status: 'DEGRADED', reason_code: 'INTERNAL_ERROR', late_arrival: false } };
  }
}

function captureOneBatchEvent(
  service: InstanceType<typeof AgentLifecycleService>,
  prepared: ReturnType<typeof prepareEvent>,
): object {
  try {
    const result = service.capture(prepared);
    return {
      event_id: result.eventId,
      status: result.status,
      reason_code: result.reasonCode,
      observation_id: result.observationId,
      late_arrival: result.lateArrival,
    };
  } catch (error) {
    if (error instanceof AgentIntegrationError && error.reasonCode === 'IDEMPOTENCY_CONFLICT') {
      throw error;
    }
    if (error instanceof AgentIntegrationError) {
      return { event_id: prepared.eventId, status: 'INVALID', reason_code: error.reasonCode, late_arrival: false };
    }
    return { event_id: prepared.eventId, status: 'DEGRADED', reason_code: 'INTERNAL_ERROR', late_arrival: false };
  }
}

async function maybePreCompactInjection(
  ctx: AgentRouterCtx,
  prepared: ReturnType<typeof prepareEvent>,
  payload: Record<string, unknown>,
  tokenBudget: number,
): Promise<AgentContextInjectionBundle | null> {
  if (!ctx.injectionService) return null;
  return ctx.buildInjection({
    trigger: 'pre_compact',
    query: typeof payload.context_summary === 'string' ? payload.context_summary : '',
    scope: injectionScope(prepared),
    tokenBudget,
  });
}

export function handlePostObservationsIngest(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length > BATCH_EVENTS) {
      throw new AgentIntegrationError('Agent event batch exceeds configured limits', 'BATCH_TOO_LARGE', 413);
    }
    const preparedEvents: BatchPrepResult[] = events.map((item: unknown) => prepareBatchEvent(item));
    const safeBatchBytes = Buffer.byteLength(
      JSON.stringify(preparedEvents.flatMap(item => item.prepared ? [item.prepared] : [])),
      'utf8',
    );
    if (safeBatchBytes > BATCH_PAYLOAD_BYTES) {
      throw new AgentIntegrationError('Agent event batch exceeds configured limits', 'BATCH_TOO_LARGE', 413);
    }
    const results = preparedEvents.map((item) => {
      if (!item.prepared) return item.errorResult;
      return captureOneBatchEvent(service, item.prepared);
    });
    return res.json({ results });
  } catch (error) {
    return writeError(res, error);
  }
}

export function handlePostTranscriptsImport(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { transcriptImporter } = ctx;
    if (!transcriptImporter) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const result = transcriptImporter.import({
      transcript: req.body?.jsonl,
      dryRun: req.body?.dry_run,
    });
    return res.status(result.dryRun ? 200 : 201).json({
      dry_run: result.dryRun,
      valid: true,
      session_id: result.sessionId,
      line_count: result.total,
      accepted_count: result.accepted,
      duplicate_count: result.duplicates,
      redacted_count: result.redacted,
      dropped_count: result.dropped,
      lines: result.lines.map(line => ({
        line: line.line,
        event_id: line.eventId,
        status: line.status,
        reason_code: line.reasonCode,
        observation_id: line.observationId,
        late_arrival: line.lateArrival,
      })),
    });
  } catch (error) {
    return writeError(res, error);
  }
}

export async function handleCaptureSessionEvent(
  req: Request,
  res: Response,
  ctx: AgentRouterCtx,
  expectedType: 'PRE_COMPACT' | 'STOP',
): Promise<Response> {
  try {
    const { service, recordInjection, initialInjectionTokenBudget } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const prepared = prepareEvent({ ...req.body, session_id: req.params.id });
    if (prepared.eventType !== expectedType) {
      throw new AgentIntegrationError(`${expectedType} is required`, 'INTERNAL_ERROR', 400);
    }
    const result = service.capture(prepared);
    const session = service.getSession(prepared.sessionId)!;
    const payload = parsePayload(prepared);
    const tokenBudget = typeof payload.token_budget === 'number'
      ? payload.token_budget
      : initialInjectionTokenBudget;
    const injection = expectedType === 'PRE_COMPACT'
      ? await maybePreCompactInjection(ctx, prepared, payload, tokenBudget)
      : null;
    if (injection) {
      recordInjection(injection, session.ownerId, session.id);
    }
    return res.json({
      session: sessionDto(session),
      result: {
        event_id: result.eventId,
        status: result.status,
        reason_code: result.reasonCode,
        observation_id: result.observationId,
        late_arrival: result.lateArrival,
      },
      ...(expectedType === 'PRE_COMPACT'
        ? { injection: injection ? injectionDto(injection) : null }
        : { summary_job_id: session.summaryMemoryId }),
    });
  } catch (error) {
    return writeError(res, error);
  }
}
