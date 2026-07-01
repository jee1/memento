import type {
  AgentMemoryPromotionCandidate,
  AgentObservation,
  AgentSession,
  MemoryProvenance,
} from '../../../domains/agent-integration/types.js';

export type SessionRow = {
  id: string;
  adapter_name: string;
  adapter_version: string;
  contract_version: number;
  owner_id: string | null;
  project_id: string | null;
  process_id: string | null;
  status: AgentSession['status'];
  started_at: string;
  ended_at: string | null;
  last_event_at: string;
  max_sequence_no: number;
  agent_metadata_json: string | null;
  summary_memory_id: string | null;
  degraded_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ObservationRow = {
  id: string;
  adapter_name: string;
  event_id: string;
  session_id: string;
  event_type: AgentObservation['eventType'];
  sequence_no: number;
  tool_name: string | null;
  outcome: string | null;
  payload_json: string | null;
  payload_sha256: string;
  redaction_metadata_json: string;
  status: AgentObservation['status'];
  drop_reason: string | null;
  late_arrival: number;
  occurred_at: string;
  received_at: string;
  expires_at: string | null;
};

export type ProvenanceRow = {
  id: string;
  memory_id: string;
  session_id: string | null;
  observation_id: string | null;
  derivation_type: string;
  source_deleted: number;
  created_at: string;
};

export type PromotionCandidateRow = {
  id: string;
  fingerprint: string;
  session_id: string;
  summary_memory_id: string;
  target_type: AgentMemoryPromotionCandidate['targetType'];
  category: AgentMemoryPromotionCandidate['category'];
  content: string;
  confidence: number;
  evidence_observation_ids_json: string;
  merge_target_memory_id: string | null;
  status: AgentMemoryPromotionCandidate['status'];
  memory_id: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

export function mapSession(row: SessionRow): AgentSession {
  return {
    id: row.id,
    adapterName: row.adapter_name,
    adapterVersion: row.adapter_version,
    contractVersion: row.contract_version,
    ownerId: row.owner_id,
    projectId: row.project_id,
    processId: row.process_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastEventAt: row.last_event_at,
    maxSequenceNo: row.max_sequence_no,
    agentMetadataJson: row.agent_metadata_json,
    summaryMemoryId: row.summary_memory_id,
    degradedReason: row.degraded_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapObservation(row: ObservationRow): AgentObservation {
  return {
    id: row.id,
    adapterName: row.adapter_name,
    eventId: row.event_id,
    sessionId: row.session_id,
    eventType: row.event_type,
    sequenceNo: row.sequence_no,
    toolName: row.tool_name,
    outcome: row.outcome,
    payloadJson: row.payload_json,
    payloadSha256: row.payload_sha256,
    redactionMetadataJson: row.redaction_metadata_json,
    status: row.status,
    dropReason: row.drop_reason,
    lateArrival: row.late_arrival === 1,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    expiresAt: row.expires_at,
  };
}

export function mapProvenance(row: ProvenanceRow): MemoryProvenance {
  return {
    id: row.id,
    memoryId: row.memory_id,
    sessionId: row.session_id,
    observationId: row.observation_id,
    derivationType: row.derivation_type,
    sourceDeleted: row.source_deleted === 1,
    createdAt: row.created_at,
  };
}

export function mapPromotionCandidate(row: PromotionCandidateRow): AgentMemoryPromotionCandidate {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    sessionId: row.session_id,
    summaryMemoryId: row.summary_memory_id,
    targetType: row.target_type,
    category: row.category,
    content: row.content,
    confidence: row.confidence,
    evidenceObservationIds: JSON.parse(row.evidence_observation_ids_json) as string[],
    mergeTargetMemoryId: row.merge_target_memory_id,
    status: row.status,
    memoryId: row.memory_id,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
  };
}

export function normalizePromotionContent(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
