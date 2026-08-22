import { randomUUID } from 'crypto';
import { DAY_MS } from '../../../shared/utils/date.js';
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
import { executeAgentCaptureTransaction } from './agent-capture-transaction.js';
import {
  AgentIntegrationError,
  type AgentIntegrationReasonCode,
} from './agent-integration-error.js';
import { buildProvenanceTrace } from './agent-provenance-graph.js';

export type { AgentIntegrationReasonCode };
export { AgentIntegrationError };

export interface AgentLifecycleServiceOptions {
  retentionDays?: number;
  abandonedTtlMs?: number;
  terminalGraceMs?: number;
  now?: () => Date;
}

export interface AgentSessionSummarizer {
  summarize(sessionId: string): unknown;
}

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
      DAY_MS,
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

    const result: CaptureResult = this.repository.runInTransaction(() =>
      executeAgentCaptureTransaction(
        this.repository,
        {
          retentionDays: this.retentionDays,
          terminalGraceMs: this.terminalGraceMs,
        },
        event,
        receivedAt,
      ),
    );
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
    return buildProvenanceTrace(rows, query);
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
