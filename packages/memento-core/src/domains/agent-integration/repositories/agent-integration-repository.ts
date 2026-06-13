import type {
  AgentDashboardAggregate,
  AgentMemoryPromotionCandidate,
  AgentObservation,
  AgentSession,
  AgentSessionPage,
  MemoryProvenance,
  ObservationPage,
  PersistedAgentEventInput,
} from '../types.js';

export interface CreateObservationInput extends PersistedAgentEventInput {
  id: string;
  lateArrival: boolean;
  receivedAt: string;
  expiresAt: string | null;
}

export interface CreateAgentMemoryPromotionCandidateInput {
  id: string;
  fingerprint: string;
  sessionId: string;
  summaryMemoryId: string;
  targetType: AgentMemoryPromotionCandidate['targetType'];
  category: AgentMemoryPromotionCandidate['category'];
  content: string;
  confidence: number;
  evidenceObservationIds: string[];
  mergeTargetMemoryId: string | null;
  createdAt: string;
}

export interface AgentIntegrationRepository {
  runInTransaction<T>(operation: () => T): T;
  schemaReady(): boolean;
  createSession(event: PersistedAgentEventInput, now: string): AgentSession;
  getSession(id: string): AgentSession | null;
  listSessions(query?: {
    cursor?: string;
    limit?: number;
    status?: AgentSession['status'];
    adapterName?: string;
    ownerId?: string;
    projectId?: string;
  }): AgentSessionPage;
  getDashboardAggregate(): AgentDashboardAggregate;
  updateSession(
    id: string,
    patch: Partial<Pick<
      AgentSession,
      'status' | 'endedAt' | 'lastEventAt' | 'maxSequenceNo' | 'degradedReason'
    >>,
    now: string,
  ): AgentSession;
  findObservationByIdempotencyKey(adapterName: string, eventId: string): AgentObservation | null;
  createObservation(input: CreateObservationInput): AgentObservation;
  getObservation(id: string): AgentObservation | null;
  countObservations(sessionId: string): number;
  listObservations(
    sessionId: string,
    query?: {
      cursor?: string;
      limit?: number;
      eventType?: string;
      status?: string;
      from?: string;
      to?: string;
    },
  ): ObservationPage;
  listAllObservations(sessionId: string): AgentObservation[];
  findPromotionCandidateByFingerprint(
    fingerprint: string,
  ): AgentMemoryPromotionCandidate | null;
  createPromotionCandidate(
    input: CreateAgentMemoryPromotionCandidateInput,
  ): AgentMemoryPromotionCandidate;
  listPromotionCandidates(query?: {
    sessionId?: string;
    status?: AgentMemoryPromotionCandidate['status'];
  }): AgentMemoryPromotionCandidate[];
  findScopedMemoryByContent(input: {
    targetType: AgentMemoryPromotionCandidate['targetType'];
    content: string;
    ownerId: string | null;
    projectId: string | null;
    processId: string | null;
  }): string | null;
  approvePromotionCandidate(
    candidateId: string,
    memoryId: string,
    now: string,
  ): AgentMemoryPromotionCandidate;
  rejectPromotionCandidate(
    candidateId: string,
    reason: string,
    now: string,
  ): AgentMemoryPromotionCandidate;
  persistSessionSummary(input: {
    memoryId: string;
    session: AgentSession;
    content: string;
    observationIds: string[];
    createdAt: string;
  }): { memoryId: string; created: boolean };
  markExpiredSessionsAbandoned(cutoff: string, now: string): string[];
  clearExpiredObservationPayloads(cutoff: string): number;
  createProvenance(input: {
    id: string;
    memoryId: string;
    sessionId?: string | null;
    observationId?: string | null;
    derivationType: string;
    createdAt: string;
  }): MemoryProvenance;
  listProvenance(query: {
    memoryId?: string;
    observationId?: string;
  }): MemoryProvenance[];
  markProvenanceSourceDeleted(sessionId: string): number;
  deleteSession(sessionId: string): boolean;
  exportSession(sessionId: string): {
    session: AgentSession;
    observations: AgentObservation[];
    provenance: MemoryProvenance[];
  } | null;
}
