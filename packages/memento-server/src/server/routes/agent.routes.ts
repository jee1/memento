import {
  AgentIntegrationError,
  type AgentContextInjectionBundle,
  type AgentContextInjectionRequest,
  type AgentContextInjectionService,
  AgentLifecycleService,
  AgentMemoryPromotionService,
  AgentSessionSummaryService,
  SqliteAgentIntegrationRepository,
  TelemetryRepository,
  type AgentLifecycleServiceOptions,
  type AgentMemoryPromotionCandidate,
  type AgentObservation,
  type AgentSession,
  type MemoryProvenance,
  type PersistedAgentEventInput,
} from '@memento/core';
import {
  AGENT_EVENT_TYPES,
  MAX_BATCH_BYTES,
  MAX_BATCH_EVENTS,
  MAX_EVENT_BYTES,
  applySizePolicy,
  asAgentEvent,
  canonicalize,
  normalizeAgentEvent,
  redactAgentEvent,
  validateAgentEvent,
  type InjectionBundle,
  type CaptureReason,
} from '@memento/agent-integration';
import type Database from 'better-sqlite3';
import { Router, type Response } from 'express';
import {
  AgentTranscriptImportError,
  AgentTranscriptImporter,
} from './agent-transcript-import.js';

const EVENT_TYPES = [...AGENT_EVENT_TYPES];
const EVENT_PAYLOAD_BYTES = MAX_EVENT_BYTES;
const BATCH_EVENTS = MAX_BATCH_EVENTS;
const BATCH_PAYLOAD_BYTES = MAX_BATCH_BYTES;

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentIntegrationError(`${name} is required`, 'INVALID_ENVELOPE', 400);
  }
  return value.trim();
}

function statusForValidationReason(reason: CaptureReason): number {
  if (reason === 'UNSUPPORTED_CONTRACT_VERSION' || reason === 'UNSUPPORTED_EVENT_TYPE') {
    return 422;
  }
  return 400;
}

function prepareEvent(input: unknown): PersistedAgentEventInput {
  let normalized;
  try {
    normalized = normalizeAgentEvent(asAgentEvent(input));
  } catch {
    throw new AgentIntegrationError(
      'Agent event normalization failed',
      'INVALID_PAYLOAD',
      400,
    );
  }
  const validation = validateAgentEvent(normalized);
  if (!validation.valid) {
    const reason = validation.reason ?? 'INVALID_ENVELOPE';
    throw new AgentIntegrationError(
      'Agent event validation failed',
      reason,
      statusForValidationReason(reason),
    );
  }
  const redaction = redactAgentEvent(normalized);
  if (redaction.action === 'DROPPED') {
    const droppedHash = canonicalize({ reason: redaction.reason });
    return {
      contractVersion: normalized.contract_version,
      eventId: normalized.event_id,
      eventType: normalized.event_type,
      occurredAt: normalized.occurred_at,
      adapterName: normalized.adapter_name,
      adapterVersion: normalized.adapter_version,
      sessionId: normalized.session_id,
      sequenceNo: normalized.sequence_no,
      scope: {
        ownerId: normalized.scope.owner_id,
        projectId: normalized.scope.project_id,
        processId: normalized.scope.process_id,
      },
      payloadJson: null,
      payloadSha256: droppedHash.sha256,
      redactionMetadataJson: JSON.stringify(redaction.metadata),
      captureStatus: 'DROPPED',
      dropReason: redaction.reason,
    };
  }
  const sized = applySizePolicy(redaction.event);
  if (sized.action === 'DROPPED') {
    const droppedHash = canonicalize({ reason: sized.reason });
    return {
      contractVersion: normalized.contract_version,
      eventId: normalized.event_id,
      eventType: normalized.event_type,
      occurredAt: normalized.occurred_at,
      adapterName: normalized.adapter_name,
      adapterVersion: normalized.adapter_version,
      sessionId: normalized.session_id,
      sequenceNo: normalized.sequence_no,
      scope: {
        ownerId: normalized.scope.owner_id,
        projectId: normalized.scope.project_id,
        processId: normalized.scope.process_id,
      },
      payloadJson: null,
      payloadSha256: droppedHash.sha256,
      redactionMetadataJson: JSON.stringify(redaction.metadata),
      captureStatus: 'DROPPED',
      dropReason: sized.reason,
    };
  }
  const payload = sized.event.payload as unknown as Record<string, unknown>;
  const canonicalPayload = canonicalize(payload);

  return {
    contractVersion: sized.event.contract_version,
    eventId: sized.event.event_id,
    eventType: sized.event.event_type,
    occurredAt: sized.event.occurred_at,
    adapterName: sized.event.adapter_name,
    adapterVersion: sized.event.adapter_version,
    sessionId: sized.event.session_id,
    sequenceNo: sized.event.sequence_no,
    scope: {
      ownerId: sized.event.scope.owner_id,
      projectId: sized.event.scope.project_id,
      processId: sized.event.scope.process_id,
    },
    payloadJson: canonicalPayload.json,
    payloadSha256: canonicalPayload.sha256,
    redactionMetadataJson: JSON.stringify(redaction.metadata),
    captureStatus: redaction.action === 'REDACTED' ? 'REDACTED' : 'ACCEPTED',
    toolName: typeof payload.tool_name === 'string' ? payload.tool_name : undefined,
    outcome: typeof payload.outcome === 'string' ? payload.outcome : undefined,
  };
}

function sessionDto(session: AgentSession) {
  return {
    id: session.id,
    adapter_name: session.adapterName,
    adapter_version: session.adapterVersion,
    contract_version: session.contractVersion,
    owner_id: session.ownerId,
    project_id: session.projectId,
    process_id: session.processId,
    status: session.status,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    last_event_at: session.lastEventAt,
    max_sequence_no: session.maxSequenceNo,
    summary_memory_id: session.summaryMemoryId,
    degraded_reason: session.degradedReason,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

function observationDto(observation: AgentObservation) {
  let redactionCount = 0;
  try {
    const metadata = JSON.parse(observation.redactionMetadataJson) as unknown;
    if (Array.isArray(metadata)) {
      redactionCount = metadata.reduce((total, item) => {
        if (
          typeof item === 'object'
          && item !== null
          && 'count' in item
          && typeof item.count === 'number'
        ) {
          return total + item.count;
        }
        return total;
      }, 0);
    }
  } catch {
    redactionCount = 0;
  }
  const eventCategory = observation.eventType === 'USER_PROMPT'
    ? 'prompt'
    : observation.eventType === 'TOOL_RESULT'
      ? observation.outcome === 'failed' || observation.outcome === 'error'
        ? 'error'
        : 'result'
      : 'lifecycle';
  return {
    id: observation.id,
    event_id: observation.eventId,
    event_type: observation.eventType,
    session_id: observation.sessionId,
    sequence_no: observation.sequenceNo,
    tool_name: observation.toolName,
    outcome: observation.outcome,
    status: observation.status,
    drop_reason: observation.dropReason,
    late_arrival: observation.lateArrival,
    occurred_at: observation.occurredAt,
    received_at: observation.receivedAt,
    expires_at: observation.expiresAt,
    event_category: eventCategory,
    redaction_count: redactionCount,
    has_payload: observation.payloadJson !== null,
  };
}

function exportObservationDto(observation: AgentObservation) {
  return {
    ...observationDto(observation),
    payload_json: observation.payloadJson,
    payload_sha256: observation.payloadSha256,
    redaction_metadata_json: observation.redactionMetadataJson,
  };
}

function provenanceDto(provenance: MemoryProvenance) {
  return {
    id: provenance.id,
    memory_id: provenance.memoryId,
    session_id: provenance.sessionId,
    observation_id: provenance.observationId,
    derivation_type: provenance.derivationType,
    source_deleted: provenance.sourceDeleted,
    created_at: provenance.createdAt,
  };
}

function injectionDto(bundle: AgentContextInjectionBundle): InjectionBundle {
  return {
    bundle_version: bundle.bundleVersion,
    injection_id: bundle.injectionId,
    trigger: bundle.trigger,
    status: bundle.status,
    generated_at: bundle.generatedAt,
    query: bundle.query,
    context_text: bundle.contextText,
    items: bundle.selected.map(item => ({
      memory_id: item.id,
      content: item.content,
      memory_type: item.type,
      score: item.score,
      scope_level: item.scopeLevel,
      token_estimate: item.tokenEstimate,
      selection_reason: item.selectionReason,
    })),
    exclusions: bundle.excluded.map(item => ({
      memory_id: item.id,
      reason: item.reason,
      score: item.score,
      token_estimate: item.tokenEstimate,
      ...(item.duplicateOf ? { duplicate_of: item.duplicateOf } : {}),
    })),
    token_usage: bundle.tokenUsage,
    degraded_reasons: bundle.degradedReasons,
    ...(bundle.failureReason ? { failure_reason: bundle.failureReason } : {}),
  };
}

function parsePayload(prepared: PersistedAgentEventInput): Record<string, unknown> {
  if (!prepared.payloadJson) return {};
  try {
    const parsed: unknown = JSON.parse(prepared.payloadJson);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function initialInjectionQuery(prepared: PersistedAgentEventInput): string {
  const payload = parsePayload(prepared);
  if (typeof payload.initial_context === 'string' && payload.initial_context.trim()) {
    return payload.initial_context.trim();
  }
  if (typeof payload.working_directory === 'string' && payload.working_directory.trim()) {
    return payload.working_directory.trim();
  }
  return prepared.scope.processId ?? prepared.scope.projectId ?? 'session start';
}

function injectionScope(prepared: PersistedAgentEventInput) {
  return {
    ownerId: prepared.scope.ownerId ?? '',
    projectId: prepared.scope.projectId,
    processId: prepared.scope.processId,
    sessionId: prepared.sessionId,
  };
}

interface AgentRouterOptions extends AgentLifecycleServiceOptions {
  contextInjectionService?: Pick<AgentContextInjectionService, 'build'>;
  initialInjectionTokenBudget?: number;
}

function percentile(sorted: number[], ratio: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.max(0, index)]!;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function boundedStatusLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 20;
}

function boundedStatusSince(value: unknown, now = new Date()): string {
  const maximumWindowMs = 7 * 24 * 60 * 60 * 1_000;
  const fallback = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  if (typeof value !== 'string') return fallback.toISOString();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed > now) return fallback.toISOString();
  return new Date(Math.max(parsed.getTime(), now.getTime() - maximumWindowMs)).toISOString();
}

function safeTelemetrySessionId(extraData: string | null): string | null {
  try {
    const parsed = JSON.parse(extraData ?? '{}') as Record<string, unknown>;
    return typeof parsed.session_id === 'string' ? parsed.session_id : null;
  } catch {
    return null;
  }
}

function promotionCandidateDto(candidate: AgentMemoryPromotionCandidate) {
  return {
    id: candidate.id,
    session_id: candidate.sessionId,
    summary_memory_id: candidate.summaryMemoryId,
    target_type: candidate.targetType,
    category: candidate.category,
    content: candidate.content,
    confidence: candidate.confidence,
    evidence_observation_ids: candidate.evidenceObservationIds,
    merge_target_memory_id: candidate.mergeTargetMemoryId,
    status: candidate.status,
    memory_id: candidate.memoryId,
    rejection_reason: candidate.rejectionReason,
    created_at: candidate.createdAt,
    updated_at: candidate.updatedAt,
    reviewed_at: candidate.reviewedAt,
  };
}

function writeError(res: Response, error: unknown): Response {
  if (error instanceof AgentIntegrationError) {
    return res.status(error.httpStatus).json({
      status: error.httpStatus,
      reason_code: error.reasonCode,
      message: error.message,
      retryable: error.retryable,
      ...(error instanceof AgentTranscriptImportError && error.line
        ? { line: error.line }
        : {}),
    });
  }
  return res.status(500).json({
    status: 500,
    reason_code: 'INTERNAL_ERROR',
    message: 'Agent integration request failed',
    retryable: false,
  });
}

function safeRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildInjectionDetails(
  db: Database.Database,
  sessionId: string,
): { injections: Array<Record<string, unknown>>; degraded: boolean } {
  const rows = db.prepare(`
    SELECT event_type, created_at, extra_data
    FROM telemetry_events
    WHERE event_type IN ('agent.injection.completed', 'agent.injection.used')
      AND json_extract(extra_data, '$.session_id') = ?
    ORDER BY created_at, id
  `).all(sessionId) as Array<{
    event_type: string;
    created_at: string;
    extra_data: string | null;
  }>;
  const injections = new Map<string, {
    completed?: Record<string, unknown>;
    usedMemoryIds: Set<string>;
    createdAt: string;
  }>();
  let degraded = false;
  for (const row of rows) {
    try {
      const data = safeRecord(JSON.parse(row.extra_data ?? '{}'));
      const injectionId = typeof data.injection_id === 'string' ? data.injection_id : '';
      if (!injectionId) {
        degraded = true;
        continue;
      }
      const entry = injections.get(injectionId) ?? {
        usedMemoryIds: new Set<string>(),
        createdAt: row.created_at,
      };
      if (row.event_type === 'agent.injection.completed') {
        entry.completed = data;
      } else if (Array.isArray(data.used_memory_ids)) {
        for (const memoryId of data.used_memory_ids) {
          if (typeof memoryId === 'string') entry.usedMemoryIds.add(memoryId);
        }
      }
      injections.set(injectionId, entry);
    } catch {
      degraded = true;
    }
  }

  return {
    injections: [...injections.entries()].map(([injectionId, entry]) => {
      const completed = entry.completed ?? {};
      const selected = Array.isArray(completed.selected) ? completed.selected : [];
      const exclusions = Array.isArray(completed.exclusions) ? completed.exclusions : [];
      const candidates = [
        ...selected.map((item) => {
          const candidate = safeRecord(item);
          const memoryId = typeof candidate.memory_id === 'string' ? candidate.memory_id : '';
          return {
            memory_id: memoryId,
            decision: 'selected',
            score: safeNumber(candidate.score),
            token_estimate: safeNumber(candidate.token_estimate),
            reason: typeof candidate.selection_reason === 'string'
              ? candidate.selection_reason
              : null,
            used: entry.usedMemoryIds.has(memoryId),
          };
        }),
        ...exclusions.map((item) => {
          const candidate = safeRecord(item);
          const memoryId = typeof candidate.memory_id === 'string' ? candidate.memory_id : '';
          return {
            memory_id: memoryId,
            decision: 'excluded',
            score: safeNumber(candidate.score),
            token_estimate: safeNumber(candidate.token_estimate),
            reason: typeof candidate.reason === 'string' ? candidate.reason : null,
            used: entry.usedMemoryIds.has(memoryId),
          };
        }),
      ];
      return {
        injection_id: injectionId,
        session_id: sessionId,
        trigger: typeof completed.trigger === 'string' ? completed.trigger : null,
        status: Array.isArray(completed.degraded_reasons)
          && completed.degraded_reasons.length > 0
          ? 'degraded'
          : candidates.length > 0 ? 'ok' : 'empty',
        created_at: entry.createdAt,
        token_budget: safeNumber(completed.token_budget),
        token_used: safeNumber(completed.token_used),
        degraded_reasons: Array.isArray(completed.degraded_reasons)
          ? completed.degraded_reasons.filter((item): item is string => typeof item === 'string')
          : [],
        candidates,
      };
    }),
    degraded,
  };
}

export function createAgentRouter(
  db: Database.Database | null,
  options: AgentRouterOptions = {},
): Router {
  const router = Router();
  const repository = db ? new SqliteAgentIntegrationRepository(db) : null;
  const telemetryRepository = db ? new TelemetryRepository(db) : null;
  const promotionService = repository
    ? new AgentMemoryPromotionService(repository, {
        now: options.now,
        recordTelemetry: event => {
          const sessionId = event.action === 'extracted' ? event.sessionId : null;
          const session = sessionId ? repository.getSession(sessionId) : null;
          const eventType = {
            extracted: 'agent.promotion.extracted',
            approved: 'agent.promotion.approved',
            rejected: 'agent.promotion.rejected',
            usage: 'agent.promotion.usage',
          } as const;
          const outcome = event.action === 'rejected'
            || (event.action === 'usage' && event.usageOutcome === 'negative')
            ? 'failure'
            : event.action === 'usage' && event.usageOutcome === 'unused'
              ? 'empty'
              : 'success';
          telemetryRepository?.insertEventSync({
            eventType: eventType[event.action],
            requestId: event.action === 'extracted'
              ? `agent-promotion:${event.sessionId}`
              : event.action === 'usage'
                ? `agent-promotion-usage:${event.memoryId}`
                : `agent-promotion-review:${event.candidateId}`,
            ownerId: session?.ownerId ?? null,
            outcome,
            extraData: { ...event },
          });
        },
      })
    : null;
  const summaryService = repository
    ? new AgentSessionSummaryService(repository, {
        now: options.now,
        recordTelemetry: event => {
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
            outcome: event.outcome,
            errorCode: event.reason,
            extraData: {
              session_id: event.sessionId,
              observation_count: event.observationCount,
              ...(event.reason ? { reason: event.reason } : {}),
            },
          });
        },
      })
    : null;
  const summarizer = summaryService
    ? {
        summarize(sessionId: string) {
          const result = summaryService.summarize(sessionId);
          if (result.status !== 'SKIPPED') {
            promotionService?.extractCandidates(sessionId);
          }
          return result;
        },
      }
    : null;
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
  const initialInjectionTokenBudget = Number.isSafeInteger(options.initialInjectionTokenBudget)
    ? Math.min(32_768, Math.max(1, options.initialInjectionTokenBudget!))
    : 2_048;

  const recordInjection = (
    bundle: AgentContextInjectionBundle,
    ownerId: string | null,
    sessionId: string,
  ) => {
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
        extraData: {
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
        },
      });
    } catch {
      return;
    }
  };
  const buildInjection = async (
    request: AgentContextInjectionRequest,
  ): Promise<AgentContextInjectionBundle | null> => {
    try {
      return await injectionService?.build(request) ?? null;
    } catch {
      return null;
    }
  };

  router.get('/capabilities', (_req, res) => {
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
        pre_compact_injection: injectionService !== undefined,
      },
      schema_ready: service?.schemaReady() ?? false,
    });
  });

  router.get('/sessions', (req, res) => {
    try {
      if (!service) {
        throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
      }
      const page = service.listSessions({
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        status: typeof req.query.status === 'string'
          ? req.query.status as AgentSession['status']
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
  });

  router.get('/sessions/aggregate', (_req, res) => {
    try {
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
  });

  router.get('/operations/status', (req, res) => {
    try {
      if (!service || !db) {
        throw new AgentIntegrationError(
          'Database unavailable',
          'SCHEMA_NOT_READY',
          503,
          true,
        );
      }
      const generatedAt = (options.now ?? (() => new Date()))().toISOString();
      const since = boundedStatusSince(req.query.since, new Date(generatedAt));
      const limit = boundedStatusLimit(req.query.limit);
      const observationRows = db.prepare(`
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
      `).all(since, limit) as Array<{
        occurred_at: string;
        status: string;
        drop_reason: string | null;
        session_id: string;
        adapter_name: string;
        event_type: string;
      }>;
      const injectionRows = db.prepare(`
        SELECT created_at, outcome, error_code, extra_data
        FROM telemetry_events
        WHERE event_type = 'agent.injection.completed'
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(since, limit) as Array<{
        created_at: string;
        outcome: string;
        error_code: string | null;
        extra_data: string | null;
      }>;
      const observationCounts = db.prepare(`
        SELECT
          COUNT(*) AS captures,
          SUM(CASE WHEN status = 'DROPPED' THEN 1 ELSE 0 END) AS dropped,
          SUM(CASE WHEN status = 'DEGRADED' THEN 1 ELSE 0 END) AS degraded
        FROM agent_observation
        WHERE received_at >= ?
      `).get(since) as { captures: number; dropped: number | null; degraded: number | null };
      const injectionCounts = db.prepare(`
        SELECT
          COUNT(*) AS injections,
          SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS degraded
        FROM telemetry_events
        WHERE event_type = 'agent.injection.completed'
          AND created_at >= ?
      `).get(since) as { injections: number; degraded: number | null };
      const recentEvents = [
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

      return res.json({
        generated_at: generatedAt,
        window: { since, limit },
        counts: {
          captures: observationCounts.captures,
          injections: injectionCounts.injections,
          dropped: observationCounts.dropped ?? 0,
          degraded: (observationCounts.degraded ?? 0) + (injectionCounts.degraded ?? 0),
        },
        recent_events: recentEvents,
      });
    } catch (error) {
      return writeError(res, error);
    }
  });

  router.post('/sessions', async (req, res) => {
    try {
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
  });

  router.post('/observations:ingest', (req, res) => {
    try {
      if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
      const events = Array.isArray(req.body?.events) ? req.body.events : [];
      if (events.length > BATCH_EVENTS) {
        throw new AgentIntegrationError(
          'Agent event batch exceeds configured limits',
          'BATCH_TOO_LARGE',
          413,
        );
      }
      const preparedEvents = events.map((item: unknown) => {
        try {
          return { prepared: prepareEvent(item) };
        } catch (error) {
          const eventId =
            item && typeof item === 'object' && 'event_id' in item
            && typeof (item as { event_id?: unknown }).event_id === 'string'
              ? (item as { event_id: string }).event_id
              : '';
          if (error instanceof AgentIntegrationError) {
            return {
              errorResult: {
                event_id: eventId,
                status: 'INVALID',
                reason_code: error.reasonCode,
                late_arrival: false,
              },
            };
          }
          return {
            errorResult: {
              event_id: eventId,
              status: 'DEGRADED',
              reason_code: 'INTERNAL_ERROR',
              late_arrival: false,
            },
          };
        }
      });
      const safeBatchBytes = Buffer.byteLength(
        JSON.stringify(preparedEvents.flatMap(item =>
          item.prepared ? [item.prepared] : [])),
        'utf8',
      );
      if (safeBatchBytes > BATCH_PAYLOAD_BYTES) {
        throw new AgentIntegrationError(
          'Agent event batch exceeds configured limits',
          'BATCH_TOO_LARGE',
          413,
        );
      }
      const results = preparedEvents.map((item) => {
        if (!item.prepared) return item.errorResult;
        try {
          const result = service.capture(item.prepared);
          return {
            event_id: result.eventId,
            status: result.status,
            reason_code: result.reasonCode,
            observation_id: result.observationId,
            late_arrival: result.lateArrival,
          };
        } catch (error) {
          if (
            error instanceof AgentIntegrationError
            && error.reasonCode === 'IDEMPOTENCY_CONFLICT'
          ) {
            throw error;
          }
          if (error instanceof AgentIntegrationError) {
            return {
              event_id: item.prepared.eventId,
              status: 'INVALID',
              reason_code: error.reasonCode,
              late_arrival: false,
            };
          }
          return {
            event_id: item.prepared.eventId,
            status: 'DEGRADED',
            reason_code: 'INTERNAL_ERROR',
            late_arrival: false,
          };
        }
      });
      return res.json({ results });
    } catch (error) {
      return writeError(res, error);
    }
  });

  router.post('/transcripts/import', (req, res) => {
    try {
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
  });

  const captureSessionEvent = (expectedType: 'PRE_COMPACT' | 'STOP') =>
    async (req: Parameters<Parameters<Router['post']>[1]>[0], res: Response) => {
      try {
        if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
        const prepared = prepareEvent({ ...req.body, session_id: req.params.id });
        if (prepared.eventType !== expectedType) {
          throw new AgentIntegrationError(`${expectedType} is required`, 'INTERNAL_ERROR', 400);
        }
        const result = service.capture(prepared);
        const session = service.getSession(prepared.sessionId)!;
        const payload = parsePayload(prepared);
        const requestedTokenBudget = typeof payload.token_budget === 'number'
          ? payload.token_budget
          : initialInjectionTokenBudget;
        const injection = expectedType === 'PRE_COMPACT' && injectionService
          ? await buildInjection({
              trigger: 'pre_compact',
              query: typeof payload.context_summary === 'string'
                ? payload.context_summary
                : '',
              scope: injectionScope(prepared),
              tokenBudget: requestedTokenBudget,
            })
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
    };

  router.post('/sessions/:id\\:pre-compact', captureSessionEvent('PRE_COMPACT'));
  router.post('/sessions/:id\\:stop', captureSessionEvent('STOP'));

  router.post('/sessions/:id/injections/:injectionId/usage', (req, res) => {
    try {
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
  });

  router.get('/injections/metrics', (_req, res) => {
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
  });

  router.get('/sessions/:id/injections', (req, res) => {
    try {
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
  });

  router.get('/sessions/:id', (req, res) => {
    try {
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
  });

  router.get('/sessions/:id/observations', (req, res) => {
    try {
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
  });

  router.post('/provenance', (req, res) => {
    try {
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
  });

  router.get('/provenance', (req, res) => {
    try {
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
  });

  router.get('/provenance/detail', (req, res) => {
    try {
      if (!service || !repository || !db) {
        throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
      }
      const memoryId = typeof req.query.memory_id === 'string'
        ? req.query.memory_id
        : undefined;
      const observationId = typeof req.query.observation_id === 'string'
        ? req.query.observation_id
        : undefined;
      if (!memoryId && !observationId) {
        throw new AgentIntegrationError(
          'memory_id or observation_id is required',
          'INVALID_ENVELOPE',
          400,
        );
      }
      const edges = repository.listProvenance({ memoryId, observationId }).slice(0, 100);
      const memoryIds = [...new Set(edges.map(edge => edge.memoryId))];
      const observationIds = [...new Set(
        edges.flatMap(edge => edge.observationId ? [edge.observationId] : []),
      )];
      const sessionIds = [...new Set(
        edges.flatMap(edge => edge.sessionId ? [edge.sessionId] : []),
      )];
      const memoryStatement = db.prepare(`
        SELECT id, type, substr(content, 1, 240) AS content_preview, created_at
        FROM memory_item
        WHERE id = ?
      `);
      const memories = memoryIds.flatMap((id) => {
        const row = memoryStatement.get(id) as {
          id: string;
          type: string;
          content_preview: string;
          created_at: string | null;
        } | undefined;
        return row ? [{
          ...row,
          source_deleted: edges.some(edge => edge.memoryId === id && edge.sourceDeleted),
        }] : [];
      });
      const observations = observationIds.flatMap((id) => {
        const observation = repository.getObservation(id);
        return observation ? [observationDto(observation)] : [];
      });
      const sessions = sessionIds.flatMap((id) => {
        const session = service.getSession(id);
        return session ? [sessionDto(session)] : [];
      });
      return res.json({
        edges: edges.map(provenanceDto),
        memories,
        observations,
        sessions,
        truncated: edges.length === 100,
      });
    } catch (error) {
      return writeError(res, error);
    }
  });

  router.get('/memory/promotion-candidates', (req, res) => {
    try {
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
  });

  router.post('/memory/promotion-candidates/:id\\:approve', (req, res) => {
    try {
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
  });

  router.post('/memory/promotion-candidates/:id\\:reject', (req, res) => {
    try {
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
  });

  router.post('/retention:enforce', (_req, res) => {
    try {
      if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
      const abandonedSessions = service.abandonExpiredSessions();
      return res.json({
        ...service.enforceRetention(),
        abandonedSessions,
      });
    } catch (error) {
      return writeError(res, error);
    }
  });

  router.get('/sessions/:id/export', (req, res) => {
    try {
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
  });

  router.delete('/sessions/:id', (req, res) => {
    try {
      if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
      if (!service.deleteSession(req.params.id)) {
        throw new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
      }
      return res.status(204).send();
    } catch (error) {
      return writeError(res, error);
    }
  });

  return router;
}
