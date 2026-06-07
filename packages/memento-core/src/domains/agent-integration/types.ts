export type AgentEventType =
  | 'SESSION_START'
  | 'USER_PROMPT'
  | 'TOOL_RESULT'
  | 'PRE_COMPACT'
  | 'STOP';

export type AgentSessionStatus =
  | 'ACTIVE'
  | 'COMPACTING'
  | 'STOPPING'
  | 'COMPLETED'
  | 'DEGRADED'
  | 'ABANDONED';

export type AgentCaptureStatus =
  | 'ACCEPTED'
  | 'REDACTED'
  | 'DUPLICATE'
  | 'DROPPED'
  | 'DEGRADED'
  | 'INVALID';

export interface PersistedAgentEventInput {
  contractVersion: number;
  eventId: string;
  eventType: AgentEventType;
  occurredAt: string;
  adapterName: string;
  adapterVersion: string;
  sessionId: string;
  sequenceNo: number;
  scope: {
    ownerId?: string;
    projectId?: string;
    processId?: string;
  };
  payloadJson: string | null;
  payloadSha256: string;
  redactionMetadataJson: string;
  captureStatus: Exclude<AgentCaptureStatus, 'DUPLICATE' | 'INVALID'>;
  dropReason?: string;
  toolName?: string;
  outcome?: string;
}

export interface AgentSession {
  id: string;
  adapterName: string;
  adapterVersion: string;
  contractVersion: number;
  ownerId: string | null;
  projectId: string | null;
  processId: string | null;
  status: AgentSessionStatus;
  startedAt: string;
  endedAt: string | null;
  lastEventAt: string;
  maxSequenceNo: number;
  agentMetadataJson: string | null;
  summaryMemoryId: string | null;
  degradedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentObservation {
  id: string;
  adapterName: string;
  eventId: string;
  sessionId: string;
  eventType: AgentEventType;
  sequenceNo: number;
  toolName: string | null;
  outcome: string | null;
  payloadJson: string | null;
  payloadSha256: string;
  redactionMetadataJson: string;
  status: AgentCaptureStatus;
  dropReason: string | null;
  lateArrival: boolean;
  occurredAt: string;
  receivedAt: string;
  expiresAt: string | null;
}

export interface MemoryProvenance {
  id: string;
  memoryId: string;
  sessionId: string | null;
  observationId: string | null;
  derivationType: string;
  sourceDeleted: boolean;
  createdAt: string;
}

export interface CaptureResult {
  eventId: string;
  status: AgentCaptureStatus;
  reasonCode: string;
  observationId: string;
  lateArrival: boolean;
}

export interface ObservationPage {
  items: AgentObservation[];
  nextCursor: string | null;
  aggregate: {
    total: number;
    late: number;
    byEventType: Record<string, number>;
    byStatus: Record<string, number>;
  };
}

export interface ProvenanceTrace {
  nodes: Array<{ kind: 'memory' | 'observation' | 'session'; id: string; sourceDeleted?: boolean }>;
  edges: Array<{ from: string; to: string; type: string }>;
  truncated: boolean;
}

export type AgentMemoryPromotionTargetType = 'semantic' | 'procedural';
export type AgentMemoryPromotionCategory = 'decision' | 'error_resolution' | 'procedure';
export type AgentMemoryPromotionStatus = 'pending' | 'approved' | 'rejected';

export interface AgentMemoryPromotionCandidate {
  id: string;
  fingerprint: string;
  sessionId: string;
  summaryMemoryId: string;
  targetType: AgentMemoryPromotionTargetType;
  category: AgentMemoryPromotionCategory;
  content: string;
  confidence: number;
  evidenceObservationIds: string[];
  mergeTargetMemoryId: string | null;
  status: AgentMemoryPromotionStatus;
  memoryId: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}
