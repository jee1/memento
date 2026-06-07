import type {
  AgentObservation,
  AgentSession,
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

export interface AgentIntegrationRepository {
  runInTransaction<T>(operation: () => T): T;
  schemaReady(): boolean;
  createSession(event: PersistedAgentEventInput, now: string): AgentSession;
  getSession(id: string): AgentSession | null;
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
