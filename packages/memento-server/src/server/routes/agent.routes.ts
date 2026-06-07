import {
  AgentIntegrationError,
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
  type CaptureReason,
} from '@memento/agent-integration';
import type Database from 'better-sqlite3';
import { Router, type Response } from 'express';

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
    });
  }
  return res.status(500).json({
    status: 500,
    reason_code: 'INTERNAL_ERROR',
    message: 'Agent integration request failed',
    retryable: false,
  });
}

export function createAgentRouter(
  db: Database.Database | null,
  options: AgentLifecycleServiceOptions = {},
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
        pre_compact_injection: false,
      },
      schema_ready: service?.schemaReady() ?? false,
    });
  });

  router.post('/sessions', (req, res) => {
    try {
      if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
      const prepared = prepareEvent(req.body);
      if (prepared.eventType !== 'SESSION_START') {
        throw new AgentIntegrationError('SESSION_START is required', 'INTERNAL_ERROR', 400);
      }
      const result = service.capture(prepared);
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
        initial_injection: null,
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

  const captureSessionEvent = (expectedType: 'PRE_COMPACT' | 'STOP') =>
    (req: Parameters<Parameters<Router['post']>[1]>[0], res: Response) => {
      try {
        if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
        const prepared = prepareEvent({ ...req.body, session_id: req.params.id });
        if (prepared.eventType !== expectedType) {
          throw new AgentIntegrationError(`${expectedType} is required`, 'INTERNAL_ERROR', 400);
        }
        const result = service.capture(prepared);
        const session = service.getSession(prepared.sessionId)!;
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
            ? { injection: null }
            : { summary_job_id: session.summaryMemoryId }),
        });
      } catch (error) {
        return writeError(res, error);
      }
    };

  router.post('/sessions/:id\\:pre-compact', captureSessionEvent('PRE_COMPACT'));
  router.post('/sessions/:id\\:stop', captureSessionEvent('STOP'));

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
