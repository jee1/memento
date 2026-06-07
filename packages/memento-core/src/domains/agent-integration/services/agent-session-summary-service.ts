import { randomUUID } from 'crypto';
import type { AgentIntegrationRepository } from '../repositories/agent-integration-repository.js';
import type { AgentObservation, AgentSession } from '../types.js';

const MAX_SUMMARY_BYTES = 16 * 1024;
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;"'}]+/gi,
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi,
];

export interface AgentSummaryTelemetryEvent {
  outcome: 'success' | 'failure' | 'empty';
  sessionId: string;
  observationCount: number;
  latencyMs: number;
  reason?: 'NO_USABLE_OBSERVATIONS' | 'SUMMARY_PERSIST_FAILED';
}

export interface AgentSessionSummaryServiceOptions {
  now?: () => Date;
  recordTelemetry?: (event: AgentSummaryTelemetryEvent) => void;
}

export type AgentSessionSummaryResult =
  | {
      status: 'CREATED' | 'EXISTING';
      memoryId: string;
      observationCount: number;
    }
  | {
      status: 'SKIPPED';
      memoryId: null;
      observationCount: 0;
      reason: 'NO_USABLE_OBSERVATIONS';
    };

function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, '[REDACTED]'),
    value,
  );
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) return value;
  return `${buffer.subarray(0, Math.max(0, maxBytes - 32)).toString('utf8')}\n[TRUNCATED]`;
}

function formatPayload(payloadJson: string): string {
  try {
    return JSON.stringify(JSON.parse(payloadJson), null, 2);
  } catch {
    return payloadJson;
  }
}

export function buildAgentSessionSummary(
  session: AgentSession,
  observations: AgentObservation[],
): { content: string; observationIds: string[] } | null {
  const usable = observations.filter(observation =>
    observation.payloadJson !== null
    && (observation.status === 'ACCEPTED' || observation.status === 'REDACTED'),
  );
  if (usable.length === 0) return null;

  const parts = [
    `# Agent session summary: ${session.id}`,
    `status=${session.status}`,
    `started_at=${session.startedAt}`,
    `ended_at=${session.endedAt ?? 'unknown'}`,
    '',
  ];
  const observationIds: string[] = [];
  let usedBytes = Buffer.byteLength(parts.join('\n'), 'utf8');
  for (const observation of usable) {
    const metadata = [
      `event=${observation.eventType}`,
      `sequence=${observation.sequenceNo}`,
      observation.toolName ? `tool=${observation.toolName}` : null,
      observation.outcome ? `outcome=${observation.outcome}` : null,
    ].filter(Boolean).join(' ');
    const remainingBytes = MAX_SUMMARY_BYTES - usedBytes;
    if (remainingBytes <= 64) break;
    const section = truncateUtf8(
      redactSecrets(`## ${metadata}\n${formatPayload(observation.payloadJson!)}`),
      remainingBytes,
    );
    parts.push(section);
    observationIds.push(observation.id);
    usedBytes += Buffer.byteLength(`\n${section}`, 'utf8');
  }

  return {
    content: truncateUtf8(redactSecrets(parts.join('\n')), MAX_SUMMARY_BYTES),
    observationIds,
  };
}

export class AgentSessionSummaryService {
  private readonly now: () => Date;
  private readonly recordTelemetry: (event: AgentSummaryTelemetryEvent) => void;

  constructor(
    private readonly repository: AgentIntegrationRepository,
    options: AgentSessionSummaryServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.recordTelemetry = options.recordTelemetry ?? (() => undefined);
  }

  summarize(sessionId: string): AgentSessionSummaryResult {
    const startedAt = Date.now();
    const session = this.repository.getSession(sessionId);
    if (!session) throw new Error(`Agent session not found: ${sessionId}`);

    const observations = this.repository.listAllObservations(sessionId);
    const summary = buildAgentSessionSummary(session, observations);
    if (!summary) {
      this.safeRecordTelemetry({
        outcome: 'empty',
        sessionId,
        observationCount: 0,
        latencyMs: Date.now() - startedAt,
        reason: 'NO_USABLE_OBSERVATIONS',
      });
      return {
        status: 'SKIPPED',
        memoryId: null,
        observationCount: 0,
        reason: 'NO_USABLE_OBSERVATIONS',
      };
    }

    try {
      const persisted = this.repository.persistSessionSummary({
        memoryId: randomUUID(),
        session,
        content: summary.content,
        observationIds: summary.observationIds,
        createdAt: this.now().toISOString(),
      });
      this.safeRecordTelemetry({
        outcome: 'success',
        sessionId,
        observationCount: summary.observationIds.length,
        latencyMs: Date.now() - startedAt,
      });
      return {
        status: persisted.created ? 'CREATED' : 'EXISTING',
        memoryId: persisted.memoryId,
        observationCount: summary.observationIds.length,
      };
    } catch (error) {
      this.safeRecordTelemetry({
        outcome: 'failure',
        sessionId,
        observationCount: summary.observationIds.length,
        latencyMs: Date.now() - startedAt,
        reason: 'SUMMARY_PERSIST_FAILED',
      });
      throw error;
    }
  }

  private safeRecordTelemetry(event: AgentSummaryTelemetryEvent): void {
    try {
      this.recordTelemetry(event);
    } catch {
      // Telemetry must never change summary persistence or retry semantics.
    }
  }
}
