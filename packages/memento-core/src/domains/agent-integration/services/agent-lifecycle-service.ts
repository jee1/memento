import { randomUUID } from 'crypto';
import type { AgentIntegrationRepository } from '../repositories/agent-integration-repository.js';
import type {
  AgentDashboardAggregate,
  AgentSession,
  AgentSessionPage,
  CaptureResult,
  MemoryProvenance,
  ObservationPage,
  PersistedAgentEventInput,
  ProvenanceTrace,
} from '../types.js';

export type AgentIntegrationReasonCode =
  | 'NONE'
  | 'AUTH_FAILED'
  | 'SERVER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'QUEUE_OVERFLOW'
  | 'INVALID_ENVELOPE'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_CONTRACT_VERSION'
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'SCHEMA_NOT_READY'
  | 'SESSION_NOT_STARTED'
  | 'INVALID_SESSION_STATE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SENSITIVE_PATH'
  | 'BINARY_CONTENT'
  | 'PRIVATE_KEY_MATERIAL'
  | 'PAYLOAD_TOO_LARGE'
  | 'BATCH_TOO_LARGE'
  | 'INTERNAL_ERROR';

export class AgentIntegrationError extends Error {
  constructor(
    message: string,
    readonly reasonCode: AgentIntegrationReasonCode,
    readonly httpStatus: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AgentIntegrationError';
  }
}

export interface AgentLifecycleServiceOptions {
  retentionDays?: number;
  abandonedTtlMs?: number;
  terminalGraceMs?: number;
  now?: () => Date;
}

export interface AgentSessionSummarizer {
  summarize(sessionId: string): unknown;
}

const TERMINAL_STATUSES = new Set<AgentSession['status']>([
  'COMPLETED',
  'DEGRADED',
  'ABANDONED',
]);

function boundedNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export class AgentLifecycleService {
  private readonly retentionDays: number;
  private readonly abandonedTtlMs: number;
  private readonly terminalGraceMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: AgentIntegrationRepository,
    options: AgentLifecycleServiceOptions = {},
    private readonly sessionSummarizer?: AgentSessionSummarizer,
  ) {
    this.retentionDays = boundedNumber(options.retentionDays, 30, 1, 90);
    this.abandonedTtlMs = boundedNumber(
      options.abandonedTtlMs,
      24 * 60 * 60 * 1000,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    this.terminalGraceMs = boundedNumber(
      options.terminalGraceMs,
      5 * 60 * 1000,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    this.now = options.now ?? (() => new Date());
  }

  schemaReady(): boolean {
    return this.repository.schemaReady();
  }

  capture(event: PersistedAgentEventInput): CaptureResult {
    if (!this.schemaReady()) {
      throw new AgentIntegrationError(
        'Agent integration schema is not ready',
        'SCHEMA_NOT_READY',
        503,
        true,
      );
    }

    const receivedAt = this.now().toISOString();
    const abandonedCutoff = new Date(
      Date.parse(receivedAt) - this.abandonedTtlMs,
    ).toISOString();
    const abandonedSessionIds = this.repository.markExpiredSessionsAbandoned(
      abandonedCutoff,
      receivedAt,
    );
    for (const sessionId of abandonedSessionIds) {
      this.trySummarize(sessionId);
    }

    const result: CaptureResult = this.repository.runInTransaction(() => {
      const existing = this.repository.findObservationByIdempotencyKey(
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

      let session = this.repository.getSession(event.sessionId);
      if (!session) {
        if (event.eventType !== 'SESSION_START') {
          throw new AgentIntegrationError(
            'Agent session has not been started',
            'SESSION_NOT_STARTED',
            404,
          );
        }
        session = this.repository.createSession(event, receivedAt);
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
        if (!Number.isFinite(terminalAt) || Date.parse(receivedAt) > terminalAt + this.terminalGraceMs) {
          throw new AgentIntegrationError(
            'Agent session no longer accepts lifecycle events',
            'INVALID_SESSION_STATE',
            409,
          );
        }
      }

      const lateArrival = event.sequenceNo < session.maxSequenceNo || TERMINAL_STATUSES.has(session.status);
      const expiresAt = new Date(
        Date.parse(receivedAt) + this.retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const observation = this.repository.createObservation({
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
          session = this.repository.updateSession(event.sessionId, {
            status,
            endedAt: receivedAt,
            lastEventAt: event.occurredAt,
            maxSequenceNo,
            degradedReason: status === 'DEGRADED' ? 'STOP_FAILED' : null,
          }, receivedAt);
        } else {
          session = this.repository.updateSession(event.sessionId, {
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
    });
    if (event.eventType === 'STOP') {
      this.trySummarize(event.sessionId);
    }
    return result;
  }

  getSession(id: string): AgentSession | null {
    return this.repository.getSession(id);
  }

  listSessions(
    query?: Parameters<AgentIntegrationRepository['listSessions']>[0],
  ): AgentSessionPage {
    return this.repository.listSessions(query);
  }

  getDashboardAggregate(): AgentDashboardAggregate {
    return this.repository.getDashboardAggregate();
  }

  listObservations(
    sessionId: string,
    query?: Parameters<AgentIntegrationRepository['listObservations']>[1],
  ): ObservationPage {
    return this.repository.listObservations(sessionId, query);
  }

  abandonExpiredSessions(at = this.now()): number {
    const cutoff = new Date(at.getTime() - this.abandonedTtlMs).toISOString();
    const sessionIds = this.repository.markExpiredSessionsAbandoned(cutoff, at.toISOString());
    for (const sessionId of sessionIds) {
      this.trySummarize(sessionId);
    }
    return sessionIds.length;
  }

  private trySummarize(sessionId: string): void {
    try {
      this.sessionSummarizer?.summarize(sessionId);
    } catch {
      // Summary failures are recorded by the summarizer and retried on duplicate stop or sweep.
    }
  }

  linkProvenance(input: {
    memoryId: string;
    sessionId?: string | null;
    observationId?: string | null;
    derivationType: string;
  }): MemoryProvenance {
    if (!input.sessionId && !input.observationId) {
      throw new AgentIntegrationError(
        'Provenance requires a session or observation source',
        'INTERNAL_ERROR',
        400,
      );
    }
    if (input.sessionId && !this.repository.getSession(input.sessionId)) {
      throw new AgentIntegrationError(
        'Provenance session source was not found',
        'SESSION_NOT_STARTED',
        404,
      );
    }
    if (input.observationId) {
      const observation = this.repository.getObservation(input.observationId);
      if (!observation) {
        throw new AgentIntegrationError(
          'Provenance observation source was not found',
          'SESSION_NOT_STARTED',
          404,
        );
      }
      if (input.sessionId && observation.sessionId !== input.sessionId) {
        throw new AgentIntegrationError(
          'Provenance observation does not belong to the supplied session',
          'INVALID_SESSION_STATE',
          409,
        );
      }
    }
    return this.repository.createProvenance({
      ...input,
      id: randomUUID(),
      createdAt: this.now().toISOString(),
    });
  }

  getProvenance(query: {
    memoryId?: string;
    observationId?: string;
    direction?: 'sources' | 'derived' | 'both';
    maxDepth?: number;
  }): ProvenanceTrace {
    const rows = this.repository.listProvenance(query);
    const nodes = new Map<string, ProvenanceTrace['nodes'][number]>();
    const edges: ProvenanceTrace['edges'] = [];
    const direction = query.direction ?? 'sources';
    const maxDepth = Math.min(Math.max(query.maxDepth ?? 3, 0), 10);
    let truncated = false;

    if (query.memoryId) {
      nodes.set(`memory:${query.memoryId}`, { kind: 'memory', id: query.memoryId });
    }
    if (query.observationId) {
      nodes.set(`observation:${query.observationId}`, {
        kind: 'observation',
        id: query.observationId,
      });
    }

    for (const row of rows) {
      const memoryKey = `memory:${row.memoryId}`;
      const observationKey = row.observationId
        ? `observation:${row.observationId}`
        : null;
      const sessionKey = row.sessionId ? `session:${row.sessionId}` : null;

      if (
        query.observationId
        && (direction === 'derived' || direction === 'both')
      ) {
        if (maxDepth >= 1) {
          nodes.set(memoryKey, { kind: 'memory', id: row.memoryId });
          edges.push({
            from: `observation:${query.observationId}`,
            to: memoryKey,
            type: row.derivationType,
          });
        } else {
          truncated = true;
        }
      }

      if (
        query.observationId
        && sessionKey
        && (direction === 'sources' || direction === 'both')
      ) {
        if (maxDepth >= 1) {
          nodes.set(sessionKey, {
            kind: 'session',
            id: row.sessionId!,
            sourceDeleted: row.sourceDeleted,
          });
          edges.push({
            from: `observation:${query.observationId}`,
            to: sessionKey,
            type: 'observed_in',
          });
        } else {
          truncated = true;
        }
      }

      if (
        query.memoryId
        && (direction === 'sources' || direction === 'both')
        && observationKey
      ) {
        if (maxDepth < 1) {
          truncated = true;
          continue;
        }
        nodes.set(observationKey, {
          kind: 'observation',
          id: row.observationId!,
          sourceDeleted: row.sourceDeleted,
        });
        edges.push({ from: memoryKey, to: observationKey, type: row.derivationType });
        if (sessionKey && maxDepth >= 2) {
          nodes.set(sessionKey, {
            kind: 'session',
            id: row.sessionId!,
            sourceDeleted: row.sourceDeleted,
          });
          edges.push({
            from: observationKey,
            to: sessionKey,
            type: 'observed_in',
          });
        } else if (sessionKey) {
          truncated = true;
        }
      } else if (
        query.memoryId
        && (direction === 'sources' || direction === 'both')
        && sessionKey
      ) {
        if (maxDepth >= 1) {
          nodes.set(sessionKey, {
            kind: 'session',
            id: row.sessionId!,
            sourceDeleted: row.sourceDeleted,
          });
          edges.push({ from: memoryKey, to: sessionKey, type: row.derivationType });
        } else {
          truncated = true;
        }
      }
    }
    return { nodes: [...nodes.values()], edges, truncated };
  }

  enforceRetention(at = this.now()): { payloadsCleared: number } {
    return { payloadsCleared: this.repository.clearExpiredObservationPayloads(at.toISOString()) };
  }

  deleteSession(sessionId: string): boolean {
    return this.repository.runInTransaction(() => this.repository.deleteSession(sessionId));
  }

  exportSession(sessionId: string) {
    return this.repository.exportSession(sessionId);
  }
}
