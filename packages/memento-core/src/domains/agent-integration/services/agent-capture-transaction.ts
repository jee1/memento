import { randomUUID } from 'crypto';
import type { AgentIntegrationRepository } from '../repositories/agent-integration-repository.js';
import type {
  AgentSession,
  CaptureResult,
  PersistedAgentEventInput,
} from '../types.js';
import { AgentIntegrationError } from './agent-integration-error.js';

const TERMINAL_STATUSES = new Set<AgentSession['status']>([
  'COMPLETED',
  'DEGRADED',
  'ABANDONED',
]);

export type AgentCaptureTransactionOptions = {
  retentionDays: number;
  terminalGraceMs: number;
};

export function executeAgentCaptureTransaction(
  repository: AgentIntegrationRepository,
  options: AgentCaptureTransactionOptions,
  event: PersistedAgentEventInput,
  receivedAt: string,
): CaptureResult {
  const existing = repository.findObservationByIdempotencyKey(
    event.adapterName,
    event.eventId,
  );
  if (existing) {
    if (existing.payloadSha256 !== event.payloadSha256) {
      throw new AgentIntegrationError(
        'The idempotency key already exists with a different payload hash',
        'IDEMPOTENCY_CONFLICT',
        409,
      );
    }
    return {
      eventId: event.eventId,
      status: 'DUPLICATE',
      reasonCode: 'NONE',
      observationId: existing.id,
      lateArrival: existing.lateArrival,
    };
  }

  let session = repository.getSession(event.sessionId);
  if (!session) {
    if (event.eventType !== 'SESSION_START') {
      throw new AgentIntegrationError(
        'Agent session has not been started',
        'SESSION_NOT_STARTED',
        404,
      );
    }
    session = repository.createSession(event, receivedAt);
  } else if (event.eventType === 'SESSION_START') {
    throw new AgentIntegrationError(
      'Agent session is already active',
      'INVALID_SESSION_STATE',
      409,
    );
  }

  if (
    session.adapterName !== event.adapterName
    || session.adapterVersion !== event.adapterVersion
    || session.contractVersion !== event.contractVersion
    || session.ownerId !== (event.scope.ownerId ?? null)
    || session.projectId !== (event.scope.projectId ?? null)
    || session.processId !== (event.scope.processId ?? null)
  ) {
    throw new AgentIntegrationError(
      'Agent event identity does not match the existing session',
      'INVALID_SESSION_STATE',
      409,
    );
  }

  if (TERMINAL_STATUSES.has(session.status)) {
    const terminalAt = session.endedAt ? Date.parse(session.endedAt) : Number.NaN;
    if (!Number.isFinite(terminalAt) || Date.parse(receivedAt) > terminalAt + options.terminalGraceMs) {
      throw new AgentIntegrationError(
        'Agent session no longer accepts lifecycle events',
        'INVALID_SESSION_STATE',
        409,
      );
    }
  }

  const lateArrival = event.sequenceNo < session.maxSequenceNo || TERMINAL_STATUSES.has(session.status);
  const expiresAt = new Date(
    Date.parse(receivedAt) + options.retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const observation = repository.createObservation({
    ...event,
    id: randomUUID(),
    lateArrival,
    receivedAt,
    expiresAt,
  });

  if (!TERMINAL_STATUSES.has(session.status)) {
    const maxSequenceNo = Math.max(session.maxSequenceNo, event.sequenceNo);
    if (event.eventType === 'STOP') {
      const status =
        event.outcome === 'failed'
          ? 'DEGRADED'
          : event.outcome === 'abandoned'
            ? 'ABANDONED'
            : 'COMPLETED';
      session = repository.updateSession(event.sessionId, {
        status,
        endedAt: receivedAt,
        lastEventAt: event.occurredAt,
        maxSequenceNo,
        degradedReason: status === 'DEGRADED' ? 'STOP_FAILED' : null,
      }, receivedAt);
    } else {
      session = repository.updateSession(event.sessionId, {
        status: event.eventType === 'PRE_COMPACT'
          ? (session.status === 'DEGRADED' ? 'DEGRADED' : 'ACTIVE')
          : session.status,
        lastEventAt: event.occurredAt,
        maxSequenceNo,
      }, receivedAt);
    }
  }

  return {
    eventId: event.eventId,
    status: observation.status,
    reasonCode: observation.dropReason ?? 'NONE',
    observationId: observation.id,
    lateArrival: observation.lateArrival,
  };
}
