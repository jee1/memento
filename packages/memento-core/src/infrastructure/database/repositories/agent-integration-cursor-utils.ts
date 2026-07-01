import type {
  AgentObservation,
  AgentSession,
  AgentSessionObservationAggregate,
} from '../../../domains/agent-integration/types.js';

export function encodeCursor(item: AgentObservation): string {
  return Buffer.from(JSON.stringify([
    item.sequenceNo,
    item.occurredAt,
    item.receivedAt,
    item.id,
  ])).toString('base64url');
}

export function decodeCursor(cursor: string): [number, string, string, string] {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 4) {
    throw new Error('Invalid observation cursor');
  }
  return parsed as [number, string, string, string];
}

export function encodeSessionCursor(session: AgentSession): string {
  return Buffer.from(JSON.stringify([session.lastEventAt, session.id])).toString('base64url');
}

export function decodeSessionCursor(cursor: string): [string, string] {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
  if (
    !Array.isArray(parsed)
    || parsed.length !== 2
    || typeof parsed[0] !== 'string'
    || typeof parsed[1] !== 'string'
  ) {
    throw new Error('Invalid session cursor');
  }
  return [parsed[0], parsed[1]];
}

export function emptySessionObservationAggregate(): AgentSessionObservationAggregate {
  return {
    total: 0,
    late: 0,
    byEventType: {},
    byStatus: {},
    redacted: 0,
    dropped: 0,
    degraded: 0,
  };
}
