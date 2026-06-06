export const AGENT_EVENT_TYPES = [
  'SESSION_START',
  'USER_PROMPT',
  'TOOL_RESULT',
  'PRE_COMPACT',
  'STOP',
] as const;

export type AgentEventType = typeof AGENT_EVENT_TYPES[number];
export type ToolOutcome = 'success' | 'error' | 'cancelled' | 'timeout';
export type StopOutcome = 'completed' | 'cancelled' | 'failed' | 'abandoned';

export interface AgentEventScope {
  owner_id?: string;
  project_id?: string;
  process_id?: string;
}

export interface SessionStartPayload {
  client_version: string;
  model?: string;
  working_directory?: string;
  initial_context?: unknown;
  extensions?: Record<string, unknown>;
}

export interface UserPromptPayload {
  content: string;
  content_format: string;
  attachments?: unknown[];
  extensions?: Record<string, unknown>;
}

export interface ToolResultPayload {
  tool_name: string;
  outcome: ToolOutcome;
  duration_ms?: number;
  input?: unknown;
  output?: unknown;
  file_changes?: string[];
  extensions?: Record<string, unknown>;
}

export interface PreCompactPayload {
  context_summary: string;
  token_budget: number;
  extensions?: Record<string, unknown>;
}

export interface StopPayload {
  outcome: StopOutcome;
  summary?: string;
  error?: unknown;
  extensions?: Record<string, unknown>;
}

export interface AgentEventPayloadMap {
  SESSION_START: SessionStartPayload;
  USER_PROMPT: UserPromptPayload;
  TOOL_RESULT: ToolResultPayload;
  PRE_COMPACT: PreCompactPayload;
  STOP: StopPayload;
}

export interface AgentEventEnvelope<TType extends AgentEventType = AgentEventType> {
  contract_version: 1;
  event_id: string;
  event_type: TType;
  occurred_at: string;
  adapter_name: string;
  adapter_version: string;
  session_id: string;
  sequence_no: number;
  scope: AgentEventScope;
  payload: AgentEventPayloadMap[TType];
}

export type CaptureStatus =
  | 'ACCEPTED'
  | 'REDACTED'
  | 'DUPLICATE'
  | 'DROPPED'
  | 'DEGRADED'
  | 'INVALID';

export type CaptureReason =
  | 'NONE'
  | 'AUTH_FAILED'
  | 'SERVER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'QUEUE_OVERFLOW'
  | 'INVALID_ENVELOPE'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_CONTRACT_VERSION'
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'SESSION_NOT_STARTED'
  | 'INVALID_SESSION_STATE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SENSITIVE_PATH'
  | 'BINARY_CONTENT'
  | 'PRIVATE_KEY_MATERIAL'
  | 'PAYLOAD_TOO_LARGE'
  | 'BATCH_TOO_LARGE'
  | 'SCHEMA_NOT_READY'
  | 'INTERNAL_ERROR';

export interface RedactionCount {
  rule: RedactionRule;
  count: number;
}

export type RedactionRule =
  | 'API_KEY'
  | 'TOKEN'
  | 'PASSWORD'
  | 'CREDENTIAL'
  | 'EMAIL'
  | 'PHONE'
  | 'PRIVATE_KEY_MATERIAL'
  | 'SENSITIVE_PATH'
  | 'BINARY_CONTENT'
  | 'HIGH_ENTROPY_SECRET';

export interface CaptureResult {
  status: CaptureStatus;
  reason: CaptureReason;
  event_id?: string;
  redactions?: RedactionCount[];
}

export interface DispatchResult {
  status: 'ACCEPTED' | 'DEGRADED';
  reason: CaptureReason;
  attempts: number;
  event_count: number;
}

export interface CaptureTelemetry {
  phase: 'capture' | 'dispatch';
  status: CaptureStatus;
  reason: CaptureReason;
  latency_ms: number;
  event_type?: AgentEventType;
  event_count?: number;
  attempts?: number;
  queue_size: number;
}

export interface TransportResponse {
  ok: boolean;
  reason?: CaptureReason;
}

export type Transport = (
  events: readonly AgentEventEnvelope[],
  signal: AbortSignal,
) => Promise<TransportResponse>;
