import {
  AgentIntegrationError,
  type AgentContextInjectionBundle,
  type AgentContextInjectionRequest,
  type AgentContextInjectionService,
  AgentLifecycleService,
  AgentMemoryPromotionService,
  AgentSessionSummaryService,
  createPersonalAgentLlmPort,
  createToolContext,
  GeminiChatLlmAdapter,
  mementoConfig,
  OllamaChatLlmAdapter,
  OpenAiChatLlmAdapter,
  parsePersonalAgentLlmEnv,
  PersonalAgentLlmError,
  PersonalKnowledgeAgentService,
  ToolContextKnowledgeContextAdapter,
  ToolContextRememberPersistenceAdapter,
  SqliteAgentIntegrationRepository,
  TelemetryRepository,
  type AgentLifecycleServiceOptions,
  type ILLMPort,
  type KnowledgeCandidate,
  type ServerServices,
} from '@memento/core';
import {
  AGENT_EVENT_TYPES,
  MAX_BATCH_BYTES,
  MAX_BATCH_EVENTS,
  MAX_EVENT_BYTES,
} from '@memento/agent-integration';
import type Database from 'better-sqlite3';
import { Router, type Request, type Response } from 'express';
import {
  AgentTranscriptImporter,
} from './agent-transcript-import.js';
import {
  exportObservationDto,
  injectionDto,
  observationDto,
  promotionCandidateDto,
  provenanceDto,
  sessionDto,
} from './agent.routes.dto.js';
import {
  average,
  boundedStatusLimit,
  boundedStatusSince,
  parsePayload,
  percentile,
  requireString,
  safeTelemetrySessionId,
  writeError,
} from './agent.routes.utils.js';
import { prepareEvent } from './agent.routes.events.js';
import {
  buildInjectionDetails,
  initialInjectionQuery,
  injectionScope,
} from './agent.routes.injection.js';

const EVENT_TYPES = [...AGENT_EVENT_TYPES];
const EVENT_PAYLOAD_BYTES = MAX_EVENT_BYTES;
const BATCH_EVENTS = MAX_BATCH_EVENTS;
const BATCH_PAYLOAD_BYTES = MAX_BATCH_BYTES;
type PersonalAgentMemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';

export interface AgentRouterOptions extends AgentLifecycleServiceOptions {
  contextInjectionService?: Pick<AgentContextInjectionService, 'build'>;
  initialInjectionTokenBudget?: number;
  serverServices?: ServerServices;
  personalAgentLlm?: ILLMPort;
}

interface AgentRouterCtx {
  db: Database.Database | null;
  options: AgentRouterOptions;
  service: InstanceType<typeof AgentLifecycleService> | null;
  repository: InstanceType<typeof SqliteAgentIntegrationRepository> | null;
  telemetryRepository: InstanceType<typeof TelemetryRepository> | null;
  promotionService: InstanceType<typeof AgentMemoryPromotionService> | null;
  injectionService: Pick<AgentContextInjectionService, 'build'> | undefined;
  initialInjectionTokenBudget: number;
  summarizer: { summarize(sessionId: string): unknown } | null;
  transcriptImporter: InstanceType<typeof AgentTranscriptImporter> | null;
  recordInjection: (
    bundle: AgentContextInjectionBundle,
    ownerId: string | null,
    sessionId: string,
  ) => void;
  buildInjection: (
    request: AgentContextInjectionRequest,
  ) => Promise<AgentContextInjectionBundle | null>;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentIntegrationError(`${name} must be a non-empty string`, 'INVALID_PAYLOAD', 400);
  }
  return value.trim();
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new AgentIntegrationError(`${name} must be an array of non-empty strings`, 'INVALID_PAYLOAD', 400);
  }
  return value.map(item => item.trim());
}

function optionalOwnerId(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) return optionalStringArray(value, 'owner_id');
  return optionalString(value, 'owner_id');
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new AgentIntegrationError(`${name} must be a positive integer`, 'INVALID_PAYLOAD', 400);
  }
  return value;
}

function optionalMemoryTypes(value: unknown): PersonalAgentMemoryType[] | undefined {
  if (value === undefined || value === null) return undefined;
  const allowed = new Set<PersonalAgentMemoryType>(['working', 'episodic', 'semantic', 'procedural']);
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !allowed.has(item as PersonalAgentMemoryType))) {
    throw new AgentIntegrationError('memory_types must be an array of memory type strings', 'INVALID_PAYLOAD', 400);
  }
  return value as PersonalAgentMemoryType[];
}

function requireCandidates(value: unknown): KnowledgeCandidate[] {
  if (!Array.isArray(value)) {
    throw new AgentIntegrationError('candidates must be an array', 'INVALID_PAYLOAD', 400);
  }
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new AgentIntegrationError('candidates must contain objects', 'INVALID_PAYLOAD', 400);
    }
  }
  return value as KnowledgeCandidate[];
}

function createDefaultPersonalAgentLlm(): ILLMPort {
  const parsed = parsePersonalAgentLlmEnv(process.env, {
    openaiApiKey: mementoConfig.openaiApiKey,
    geminiApiKey: mementoConfig.geminiApiKey,
  });
  return createPersonalAgentLlmPort(parsed, {
    createOpenAi: (cfg) => new OpenAiChatLlmAdapter({
      apiKey: mementoConfig.openaiApiKey ?? '',
      model: cfg.model,
    }),
    createGemini: (cfg) => new GeminiChatLlmAdapter({
      apiKey: mementoConfig.geminiApiKey ?? '',
      model: cfg.model,
    }),
    createOllama: (cfg) => new OllamaChatLlmAdapter({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
    }),
  });
}

function createPersonalKnowledgeAgent(ctx: AgentRouterCtx): PersonalKnowledgeAgentService {
  if (!ctx.db || !ctx.options.serverServices) {
    throw new AgentIntegrationError('Personal knowledge agent runtime is not initialized', 'SERVER_UNAVAILABLE', 503, true);
  }
  try {
    const toolContext = createToolContext(ctx.db, ctx.options.serverServices);
    return new PersonalKnowledgeAgentService({
      llm: ctx.options.personalAgentLlm ?? createDefaultPersonalAgentLlm(),
      context: new ToolContextKnowledgeContextAdapter(toolContext),
      persistence: new ToolContextRememberPersistenceAdapter(toolContext),
    });
  } catch (error) {
    if (error instanceof PersonalAgentLlmError) {
      throw new AgentIntegrationError(error.message, 'INVALID_PAYLOAD', 400);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Injection / promotion / router-ctx helpers
// ---------------------------------------------------------------------------

function buildInjectionExtraData(
  bundle: AgentContextInjectionBundle,
  sessionId: string,
): Record<string, unknown> {
  return {
    injection_id: bundle.injectionId,
    session_id: sessionId,
    trigger: bundle.trigger,
    candidate_count: bundle.selected.length + bundle.excluded.length,
    selected_count: bundle.selected.length,
    exclusion_count: bundle.excluded.length,
    selected: bundle.selected.map(item => ({
      memory_id: item.id,
      score: item.score,
      token_estimate: item.tokenEstimate,
      selection_reason: item.selectionReason,
      scope_level: item.scopeLevel,
    })),
    exclusions: bundle.excluded.map(item => ({
      memory_id: item.id,
      reason: item.reason,
      score: item.score,
      token_estimate: item.tokenEstimate,
      ...(item.duplicateOf ? { duplicate_of: item.duplicateOf } : {}),
    })),
    token_budget: bundle.tokenUsage.budget,
    token_used: bundle.tokenUsage.used,
    budget_exceeded: bundle.tokenUsage.used > bundle.tokenUsage.budget,
    degraded_reasons: bundle.degradedReasons,
  };
}

function promotionEventType(action: string): string {
  const map: Record<string, string> = {
    extracted: 'agent.promotion.extracted',
    approved: 'agent.promotion.approved',
    rejected: 'agent.promotion.rejected',
    usage: 'agent.promotion.usage',
  };
  return map[action] ?? 'agent.promotion.unknown';
}

function promotionOutcome(
  action: string,
  usageOutcome?: string,
): 'success' | 'failure' | 'empty' {
  if (action === 'rejected' || (action === 'usage' && usageOutcome === 'negative')) {
    return 'failure';
  }
  if (action === 'usage' && usageOutcome === 'unused') return 'empty';
  return 'success';
}

function promotionRequestId(event: {
  action: string;
  sessionId?: string;
  memoryId?: string;
  candidateId?: string;
}): string {
  if (event.action === 'extracted') return `agent-promotion:${event.sessionId}`;
  if (event.action === 'usage') return `agent-promotion-usage:${event.memoryId}`;
  return `agent-promotion-review:${event.candidateId}`;
}

function clampTokenBudget(value: number | undefined): number {
  return Number.isSafeInteger(value) ? Math.min(32_768, Math.max(1, value!)) : 2_048;
}

function buildSummarizer(
  summaryService: InstanceType<typeof AgentSessionSummaryService> | null,
  promotionService: InstanceType<typeof AgentMemoryPromotionService> | null,
): AgentRouterCtx['summarizer'] {
  if (!summaryService) return null;
  return {
    summarize(sessionId: string) {
      const result = summaryService.summarize(sessionId);
      if (result.status !== 'SKIPPED') {
        promotionService?.extractCandidates(sessionId);
      }
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Service setup helpers
// ---------------------------------------------------------------------------

function makeRecordInjection(
  telemetryRepository: InstanceType<typeof TelemetryRepository> | null,
) {
  return function recordInjection(
    bundle: AgentContextInjectionBundle,
    ownerId: string | null,
    sessionId: string,
  ) {
    try {
      telemetryRepository?.insertEventSync({
        eventType: 'agent.injection.completed',
        requestId: `agent-injection:${bundle.injectionId}`,
        ownerId,
        latencyMs: bundle.latencyMs,
        outcome: bundle.status === 'ok'
          ? 'success'
          : bundle.status === 'empty'
            ? 'empty'
            : 'failure',
        errorCode: bundle.failureReason ?? undefined,
        extraData: buildInjectionExtraData(bundle, sessionId),
      });
    } catch {
      return;
    }
  };
}

function makeBuildInjection(
  injectionService: Pick<AgentContextInjectionService, 'build'> | undefined,
) {
  return async function buildInjection(
    request: AgentContextInjectionRequest,
  ): Promise<AgentContextInjectionBundle | null> {
    try {
      return await injectionService?.build(request) ?? null;
    } catch {
      return null;
    }
  };
}

function makePromotionTelemetryCallback(
  repository: InstanceType<typeof SqliteAgentIntegrationRepository>,
  telemetryRepository: InstanceType<typeof TelemetryRepository> | null,
) {
  return function recordPromotionTelemetry(event: { action: string; sessionId?: string; memoryId?: string; candidateId?: string; usageOutcome?: string }) {
    const sessionId = event.action === 'extracted' ? event.sessionId ?? null : null;
    const session = sessionId ? repository.getSession(sessionId) : null;
    telemetryRepository?.insertEventSync({
      eventType: promotionEventType(event.action) as Parameters<typeof telemetryRepository.insertEventSync>[0]['eventType'],
      requestId: promotionRequestId(event),
      ownerId: session?.ownerId ?? null,
      outcome: promotionOutcome(event.action, event.usageOutcome) as Parameters<typeof telemetryRepository.insertEventSync>[0]['outcome'],
      extraData: { ...event },
    });
  };
}

function makeSummaryTelemetryCallback(
  repository: InstanceType<typeof SqliteAgentIntegrationRepository>,
  telemetryRepository: InstanceType<typeof TelemetryRepository> | null,
) {
  return function recordSummaryTelemetry(event: { outcome: string; sessionId: string; latencyMs?: number; reason?: string; observationCount?: number }) {
    const eventType = event.outcome === 'success'
      ? 'agent.summary.completed'
      : event.outcome === 'empty'
        ? 'agent.summary.skipped'
        : 'agent.summary.failed';
    telemetryRepository?.insertEventSync({
      eventType,
      requestId: `agent-summary:${event.sessionId}`,
      ownerId: repository.getSession(event.sessionId)?.ownerId ?? null,
      latencyMs: event.latencyMs,
      outcome: event.outcome as Parameters<typeof telemetryRepository.insertEventSync>[0]['outcome'],
      errorCode: event.reason,
      extraData: {
        session_id: event.sessionId,
        observation_count: event.observationCount,
        ...(event.reason ? { reason: event.reason } : {}),
      },
    });
  };
}

function buildRouterCtx(
  db: Database.Database | null,
  options: AgentRouterOptions,
): AgentRouterCtx {
  const repository = db ? new SqliteAgentIntegrationRepository(db) : null;
  const telemetryRepository = db ? new TelemetryRepository(db) : null;
  const promotionService = repository
    ? new AgentMemoryPromotionService(repository, {
        now: options.now,
        recordTelemetry: makePromotionTelemetryCallback(repository, telemetryRepository),
      })
    : null;
  const summaryService = repository
    ? new AgentSessionSummaryService(repository, {
        now: options.now,
        recordTelemetry: makeSummaryTelemetryCallback(repository, telemetryRepository),
      })
    : null;
  const summarizer = buildSummarizer(summaryService, promotionService);
  const service = repository
    ? new AgentLifecycleService(repository, options, summarizer ?? undefined)
    : null;
  const transcriptImporter = repository && service
    ? new AgentTranscriptImporter({
        prepareEvent,
        lifecycleService: service,
        repository,
      })
    : null;
  const injectionService = options.contextInjectionService;
  const initialInjectionTokenBudget = clampTokenBudget(options.initialInjectionTokenBudget);

  return {
    db,
    options,
    service,
    repository,
    telemetryRepository,
    promotionService,
    injectionService,
    initialInjectionTokenBudget,
    summarizer,
    transcriptImporter,
    recordInjection: makeRecordInjection(telemetryRepository),
    buildInjection: makeBuildInjection(injectionService),
  };
}

// ---------------------------------------------------------------------------
// Operations status query helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleGetCapabilities(_req: Request, res: Response, ctx: AgentRouterCtx): Response {
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

function handleGetSessions(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const page = service.listSessions({
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      status: typeof req.query.status === 'string'
        ? req.query.status as Parameters<typeof service.listSessions>[0]['status']
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

function handleGetSessionsAggregate(_req: Request, res: Response, ctx: AgentRouterCtx): Response {
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

function handleGetOperationsStatus(req: Request, res: Response, ctx: AgentRouterCtx): Response {
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

async function handlePostSessions(
  req: Request,
  res: Response,
  ctx: AgentRouterCtx,
): Promise<Response> {
  try {
    const { service, db, injectionService, buildInjection, recordInjection, initialInjectionTokenBudget } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
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
        new SqliteAgentIntegrationRepository(db!).getObservation(result.observationId)!,
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

// ---------------------------------------------------------------------------
// Batch ingest helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Personal agent body helper
// ---------------------------------------------------------------------------

function parsePersonalRunBody(body: Record<string, unknown>) {
  return {
    userMessage: requireString(body.user_message ?? body.userMessage, 'user_message'),
    projectId: optionalString(body.project_id ?? body.projectId, 'project_id'),
    ownerId: optionalOwnerId(body.owner_id ?? body.ownerId),
    sessionId: optionalString(body.session_id ?? body.sessionId, 'session_id'),
    tokenBudget: optionalPositiveInteger(body.token_budget ?? body.tokenBudget, 'token_budget'),
    maxMemories: optionalPositiveInteger(body.max_memories ?? body.maxMemories, 'max_memories'),
    memoryTypes: optionalMemoryTypes(body.memory_types ?? body.memoryTypes),
  };
}

// ---------------------------------------------------------------------------
// Capture session event helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Provenance detail helpers
// ---------------------------------------------------------------------------

function resolveProvenanceFilter(
  query: Request['query'],
): { memoryId: string | undefined; observationId: string | undefined } {
  return {
    memoryId: typeof query.memory_id === 'string' ? query.memory_id : undefined,
    observationId: typeof query.observation_id === 'string' ? query.observation_id : undefined,
  };
}

function loadProvenanceMemories(
  db: Database.Database,
  edges: ReadonlyArray<{ memoryId: string; sourceDeleted?: boolean | null }>,
) {
  const stmt = db.prepare(`
    SELECT id, type, substr(content, 1, 240) AS content_preview, created_at
    FROM memory_item
    WHERE id = ?
  `);
  const memoryIds = [...new Set(edges.map(e => e.memoryId))];
  return memoryIds.flatMap((id) => {
    const row = stmt.get(id) as {
      id: string; type: string; content_preview: string; created_at: string | null;
    } | undefined;
    return row ? [{ ...row, source_deleted: edges.some(e => e.memoryId === id && e.sourceDeleted) }] : [];
  });
}

function loadProvenanceObservations(
  repository: InstanceType<typeof SqliteAgentIntegrationRepository>,
  edges: ReadonlyArray<{ observationId?: string | null }>,
) {
  const observationIds = [...new Set(edges.flatMap(e => e.observationId ? [e.observationId] : []))];
  return observationIds.flatMap((id) => {
    const observation = repository.getObservation(id);
    return observation ? [observationDto(observation)] : [];
  });
}

function loadProvenanceSessions(
  service: InstanceType<typeof AgentLifecycleService>,
  edges: ReadonlyArray<{ sessionId?: string | null }>,
) {
  const sessionIds = [...new Set(edges.flatMap(e => e.sessionId ? [e.sessionId] : []))];
  return sessionIds.flatMap((id) => {
    const session = service.getSession(id);
    return session ? [sessionDto(session)] : [];
  });
}

function handlePostObservationsIngest(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length > BATCH_EVENTS) {
      throw new AgentIntegrationError('Agent event batch exceeds configured limits', 'BATCH_TOO_LARGE', 413);
    }
    const preparedEvents = events.map((item: unknown) => prepareBatchEvent(item));
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

function handlePostTranscriptsImport(req: Request, res: Response, ctx: AgentRouterCtx): Response {
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

async function handlePostPersonalRun(req: Request, res: Response, ctx: AgentRouterCtx): Promise<Response | void> {
  try {
    const agent = createPersonalKnowledgeAgent(ctx);
    const result = await agent.runOneTurn(parsePersonalRunBody(req.body ?? {}));
    return res.json({
      ok: true,
      knowledgeContext: {
        itemCount: result.knowledgeContext.itemCount,
        tokenEstimate: result.knowledgeContext.tokenEstimate,
        summary: result.knowledgeContext.summary,
      },
      llm: {
        response: result.llmResponse,
        metadata: result.llmMetadata ?? null,
      },
      candidates: result.candidates,
      persistence: { attempted: false, items: [], persistedCount: 0, errorCount: 0 },
    });
  } catch (error) {
    return writeError(res, error);
  }
}

async function handlePostPersonalPersistApproved(req: Request, res: Response, ctx: AgentRouterCtx): Promise<Response | void> {
  try {
    const body = req.body ?? {};
    const approvedCandidateIds = optionalStringArray(
      body.approved_candidate_ids ?? body.approvedCandidateIds,
      'approved_candidate_ids',
    );
    if (!approvedCandidateIds) {
      throw new AgentIntegrationError('approved_candidate_ids is required', 'INVALID_PAYLOAD', 400);
    }

    const service = createPersonalKnowledgeAgent(ctx);
    const result = await service.persistApprovedCandidates({
      candidates: requireCandidates(body.candidates),
      approvedCandidateIds,
      projectId: optionalString(body.project_id ?? body.projectId, 'project_id'),
      ownerId: optionalOwnerId(body.owner_id ?? body.ownerId),
      sessionId: optionalString(body.session_id ?? body.sessionId, 'session_id'),
      processId: optionalString(body.process_id ?? body.processId, 'process_id'),
    });

    return res.json({
      ok: true,
      persistence: {
        attempted: approvedCandidateIds.length > 0,
        items: result.items,
        persistedCount: result.persistedCount,
        errorCount: result.errorCount,
      },
    });
  } catch (error) {
    return writeError(res, error);
  }
}

async function handleCaptureSessionEvent(
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

function handlePostInjectionUsage(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service, telemetryRepository } = ctx;
    if (!service || !telemetryRepository) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const session = service.getSession(req.params.id);
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

function handleGetInjectionMetrics(_req: Request, res: Response, ctx: AgentRouterCtx): Response {
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

function handleGetSessionInjections(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service, db } = ctx;
    if (!service || !db) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    if (!service.getSession(req.params.id)) {
      throw new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
    }
    return res.json(buildInjectionDetails(db, req.params.id));
  } catch (error) {
    return writeError(res, error);
  }
}

function handleGetSessionById(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const session = service.getSession(req.params.id);
    if (!session) throw new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
    return res.json({
      session: sessionDto(session),
      aggregate: service.listObservations(req.params.id, { limit: 1 }).aggregate,
    });
  } catch (error) {
    return writeError(res, error);
  }
}

function handleGetSessionObservations(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    if (!service.getSession(req.params.id)) {
      throw new AgentIntegrationError(
        'Agent session not found',
        'SESSION_NOT_STARTED',
        404,
      );
    }
    const page = service.listObservations(req.params.id, {
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

function handlePostProvenance(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const provenance = service.linkProvenance({
      memoryId: requireString(req.body?.memory_id, 'memory_id'),
      sessionId: typeof req.body?.session_id === 'string' ? req.body.session_id : undefined,
      observationId:
        typeof req.body?.observation_id === 'string' ? req.body.observation_id : undefined,
      derivationType: requireString(req.body?.derivation_type, 'derivation_type'),
    });
    return res.status(201).json(provenanceDto(provenance));
  } catch (error) {
    return writeError(res, error);
  }
}

function handleGetProvenance(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    return res.json(service.getProvenance({
      memoryId: typeof req.query.memory_id === 'string' ? req.query.memory_id : undefined,
      observationId:
        typeof req.query.observation_id === 'string' ? req.query.observation_id : undefined,
      direction:
        req.query.direction === 'derived' || req.query.direction === 'both'
          ? req.query.direction
          : 'sources',
      maxDepth: typeof req.query.max_depth === 'string' ? Number(req.query.max_depth) : undefined,
    }));
  } catch (error) {
    return writeError(res, error);
  }
}

function handleGetProvenanceDetail(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service, repository, db } = ctx;
    if (!service || !repository || !db) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const { memoryId, observationId } = resolveProvenanceFilter(req.query);
    if (!memoryId && !observationId) {
      throw new AgentIntegrationError('memory_id or observation_id is required', 'INVALID_ENVELOPE', 400);
    }
    const edges = repository.listProvenance({ memoryId, observationId }).slice(0, 100);
    return res.json({
      edges: edges.map(provenanceDto),
      memories: loadProvenanceMemories(db, edges),
      observations: loadProvenanceObservations(repository, edges),
      sessions: loadProvenanceSessions(service, edges),
      truncated: edges.length === 100,
    });
  } catch (error) {
    return writeError(res, error);
  }
}

function handleGetPromotionCandidates(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { promotionService } = ctx;
    if (!promotionService) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const status = req.query.status;
    return res.json({
      candidates: promotionService.listCandidates({
        sessionId: typeof req.query.session_id === 'string'
          ? req.query.session_id
          : undefined,
        status: status === 'pending' || status === 'approved' || status === 'rejected'
          ? status
          : undefined,
      }).map(promotionCandidateDto),
    });
  } catch (error) {
    return writeError(res, error);
  }
}

function handleApproveCandidate(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { promotionService } = ctx;
    if (!promotionService) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const candidateId = (req.params as Record<string, string>).id;
    return res.json(promotionCandidateDto(
      promotionService.approveCandidate(candidateId),
    ));
  } catch (error) {
    return writeError(res, error);
  }
}

function handleRejectCandidate(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { promotionService } = ctx;
    if (!promotionService) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const candidateId = (req.params as Record<string, string>).id;
    return res.json(promotionCandidateDto(
      promotionService.rejectCandidate(
        candidateId,
        requireString(req.body?.reason, 'reason'),
      ),
    ));
  } catch (error) {
    return writeError(res, error);
  }
}

function handlePostRetentionEnforce(_req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const abandonedSessions = service.abandonExpiredSessions();
    return res.json({
      ...service.enforceRetention(),
      abandonedSessions,
    });
  } catch (error) {
    return writeError(res, error);
  }
}

function handleGetSessionExport(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const exported = service.exportSession(req.params.id);
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

function handleDeleteSession(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    if (!service.deleteSession(req.params.id)) {
      throw new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
    }
    return res.status(204).send();
  } catch (error) {
    return writeError(res, error);
  }
}

// ---------------------------------------------------------------------------
// Router factory - thin shell that wires handlers to routes
// ---------------------------------------------------------------------------

export function createAgentRouter(
  db: Database.Database | null,
  options: AgentRouterOptions = {},
): Router {
  const router = Router();
  const ctx = buildRouterCtx(db, options);

  router.get('/capabilities', (_req, res) => handleGetCapabilities(_req, res, ctx));
  router.get('/sessions', (req, res) => handleGetSessions(req, res, ctx));
  router.get('/sessions/aggregate', (_req, res) => handleGetSessionsAggregate(_req, res, ctx));
  router.get('/operations/status', (req, res) => handleGetOperationsStatus(req, res, ctx));
  router.post('/personal\\:run', (req, res) => handlePostPersonalRun(req, res, ctx));
  router.post('/personal\\:persist-approved', (req, res) => handlePostPersonalPersistApproved(req, res, ctx));
  router.post('/sessions', (req, res) => handlePostSessions(req, res, ctx));
  router.post('/observations:ingest', (req, res) => handlePostObservationsIngest(req, res, ctx));
  router.post('/transcripts/import', (req, res) => handlePostTranscriptsImport(req, res, ctx));
  router.post('/sessions/:id\\:pre-compact', (req, res) => handleCaptureSessionEvent(req, res, ctx, 'PRE_COMPACT'));
  router.post('/sessions/:id\\:stop', (req, res) => handleCaptureSessionEvent(req, res, ctx, 'STOP'));
  router.post('/sessions/:id/injections/:injectionId/usage', (req, res) => handlePostInjectionUsage(req, res, ctx));
  router.get('/injections/metrics', (_req, res) => handleGetInjectionMetrics(_req, res, ctx));
  router.get('/sessions/:id/injections', (req, res) => handleGetSessionInjections(req, res, ctx));
  router.get('/sessions/:id', (req, res) => handleGetSessionById(req, res, ctx));
  router.get('/sessions/:id/observations', (req, res) => handleGetSessionObservations(req, res, ctx));
  router.post('/provenance', (req, res) => handlePostProvenance(req, res, ctx));
  router.get('/provenance', (req, res) => handleGetProvenance(req, res, ctx));
  router.get('/provenance/detail', (req, res) => handleGetProvenanceDetail(req, res, ctx));
  router.get('/memory/promotion-candidates', (req, res) => handleGetPromotionCandidates(req, res, ctx));
  router.post('/memory/promotion-candidates/:id\\:approve', (req, res) => handleApproveCandidate(req, res, ctx));
  router.post('/memory/promotion-candidates/:id\\:reject', (req, res) => handleRejectCandidate(req, res, ctx));
  router.post('/retention:enforce', (_req, res) => handlePostRetentionEnforce(_req, res, ctx));
  router.get('/sessions/:id/export', (req, res) => handleGetSessionExport(req, res, ctx));
  router.delete('/sessions/:id', (req, res) => handleDeleteSession(req, res, ctx));

  return router;
}
