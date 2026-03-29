/**
 * Observability telemetry types — specs/006-observability-telemetry/data-model.md
 */

export type EventType =
  | 'memory.search.requested'
  | 'memory.search.candidates_retrieved'
  | 'memory.search.reranked'
  | 'memory.search.selected'
  | 'memory.search.empty'
  | 'memory.search.failed'
  | 'memory.write.requested'
  | 'memory.write.completed'
  | 'memory.feedback.positive'
  | 'memory.feedback.negative'
  | 'consolidation.performed'
  | 'telemetry.cleanup.performed';

export type Outcome = 'success' | 'failure' | 'empty';

export type TelemetryPeriod = '24h' | '7d' | '30d';

export interface TelemetryEventInput {
  eventType: EventType;
  requestId: string;
  ownerId: string | null;
  latencyMs?: number;
  outcome: Outcome;
  errorCode?: string;
  extraData?: Record<string, unknown>;
}

export interface TelemetryEventRow {
  id: string;
  event_type: EventType;
  request_id: string;
  owner_id: string | null;
  latency_ms: number | null;
  outcome: Outcome;
  error_code: string | null;
  extra_data: string | null;
  created_at: string;
}

export interface DailyMetricRow {
  id: string;
  date: string;
  event_type: EventType;
  owner_id: string;  // NOT NULL DEFAULT '' — empty string = global bucket
  event_count: number;
  avg_latency_ms: number | null;
  error_count: number;
  updated_at: string;
}

export interface TelemetryEventQueryFilters {
  event_type?: EventType;
  request_id?: string;
  owner_id?: string;
  from?: string;
  to?: string;
  outcome?: Outcome;
  limit: number;
  offset: number;
}
