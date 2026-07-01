import type Database from 'better-sqlite3';
import type {
  AgentIntegrationRepository,
  CreateAgentMemoryPromotionCandidateInput,
  CreateObservationInput,
} from '../../../domains/agent-integration/repositories/agent-integration-repository.js';
import type {
  AgentDashboardAggregate,
  AgentMemoryPromotionCandidate,
  AgentObservation,
  AgentSession,
  MemoryProvenance,
  ObservationPage,
  PersistedAgentEventInput,
} from '../../../domains/agent-integration/types.js';
import { AgentIntegrationObservationStore } from './agent-integration-observation-store.js';
import { AgentIntegrationPromotionStore } from './agent-integration-promotion-store.js';
import { AgentIntegrationProvenanceStore } from './agent-integration-provenance-store.js';
import { AgentIntegrationSessionStore } from './agent-integration-session-store.js';

export class SqliteAgentIntegrationRepository implements AgentIntegrationRepository {
  private readonly sessions: AgentIntegrationSessionStore;
  private readonly observations: AgentIntegrationObservationStore;
  private readonly provenance: AgentIntegrationProvenanceStore;
  private readonly promotions: AgentIntegrationPromotionStore;

  constructor(private readonly db: Database.Database) {
    this.sessions = new AgentIntegrationSessionStore(db);
    this.observations = new AgentIntegrationObservationStore(db);
    this.provenance = new AgentIntegrationProvenanceStore(db);
    this.promotions = new AgentIntegrationPromotionStore(
      db,
      id => this.sessions.get(id),
      operation => this.runInTransaction(operation),
    );
  }

  runInTransaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  schemaReady(): boolean {
    const rows = this.db
      .prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('agent_session', 'agent_observation', 'memory_provenance')
      `)
      .all() as Array<{ name: string }>;
    return rows.length === 3;
  }

  createSession(event: PersistedAgentEventInput, now: string): AgentSession {
    return this.sessions.create(event, now);
  }

  getSession(id: string): AgentSession | null {
    return this.sessions.get(id);
  }

  listSessions(
    query: {
      cursor?: string;
      limit?: number;
      status?: AgentSession['status'];
      adapterName?: string;
      ownerId?: string;
      projectId?: string;
    } = {},
  ) {
    return this.sessions.list(query);
  }

  getDashboardAggregate(): AgentDashboardAggregate {
    return this.sessions.getDashboardAggregate();
  }

  updateSession(
    id: string,
    patch: Parameters<AgentIntegrationSessionStore['update']>[1],
    now: string,
  ): AgentSession {
    return this.sessions.update(id, patch, now);
  }

  findObservationByIdempotencyKey(
    adapterName: string,
    eventId: string,
  ): AgentObservation | null {
    return this.observations.findByIdempotencyKey(adapterName, eventId);
  }

  createObservation(input: CreateObservationInput): AgentObservation {
    return this.observations.create(input);
  }

  getObservation(id: string): AgentObservation | null {
    return this.observations.get(id);
  }

  countObservations(sessionId: string): number {
    return this.observations.count(sessionId);
  }

  listObservations(
    sessionId: string,
    query: Parameters<AgentIntegrationObservationStore['list']>[1] = {},
  ): ObservationPage {
    return this.observations.list(sessionId, query);
  }

  listAllObservations(sessionId: string): AgentObservation[] {
    return this.observations.listAll(sessionId);
  }

  findPromotionCandidateByFingerprint(
    fingerprint: string,
  ): AgentMemoryPromotionCandidate | null {
    return this.promotions.findByFingerprint(fingerprint);
  }

  createPromotionCandidate(
    input: CreateAgentMemoryPromotionCandidateInput,
  ): AgentMemoryPromotionCandidate {
    return this.promotions.create(input);
  }

  listPromotionCandidates(
    query: Parameters<AgentIntegrationPromotionStore['list']>[0] = {},
  ): AgentMemoryPromotionCandidate[] {
    return this.promotions.list(query);
  }

  findScopedMemoryByContent(
    input: Parameters<AgentIntegrationPromotionStore['findScopedMemoryByContent']>[0],
  ): string | null {
    return this.promotions.findScopedMemoryByContent(input);
  }

  approvePromotionCandidate(
    candidateId: string,
    memoryId: string,
    now: string,
  ): AgentMemoryPromotionCandidate {
    return this.promotions.approve(candidateId, memoryId, now);
  }

  rejectPromotionCandidate(
    candidateId: string,
    reason: string,
    now: string,
  ): AgentMemoryPromotionCandidate {
    return this.promotions.reject(candidateId, reason, now);
  }

  persistSessionSummary(
    input: Parameters<AgentIntegrationPromotionStore['persistSessionSummary']>[0],
  ): { memoryId: string; created: boolean } {
    return this.promotions.persistSessionSummary(input);
  }

  markExpiredSessionsAbandoned(cutoff: string, now: string): string[] {
    return this.sessions.markExpiredAbandoned(cutoff, now);
  }

  clearExpiredObservationPayloads(cutoff: string): number {
    return this.observations.clearExpiredPayloads(cutoff);
  }

  createProvenance(
    input: Parameters<AgentIntegrationProvenanceStore['create']>[0],
  ): MemoryProvenance {
    return this.provenance.create(input);
  }

  listProvenance(
    query: Parameters<AgentIntegrationProvenanceStore['list']>[0],
  ): MemoryProvenance[] {
    return this.provenance.list(query);
  }

  markProvenanceSourceDeleted(sessionId: string): number {
    return this.provenance.markSourceDeleted(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId, id => this.provenance.markSourceDeleted(id));
  }

  exportSession(sessionId: string): {
    session: AgentSession;
    observations: AgentObservation[];
    provenance: MemoryProvenance[];
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const observations: AgentObservation[] = [];
    let cursor: string | undefined;
    do {
      const page = this.observations.list(sessionId, { limit: 100, cursor });
      observations.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return {
      session,
      observations,
      provenance: this.provenance.listForSession(sessionId),
    };
  }
}
