import type Database from 'better-sqlite3';
import type { CreateObservationInput } from '../../../domains/agent-integration/repositories/agent-integration-repository.js';
import type {
  AgentObservation,
  ObservationPage,
} from '../../../domains/agent-integration/types.js';
import { decodeCursor, encodeCursor } from './agent-integration-cursor-utils.js';
import { mapObservation, type ObservationRow } from './agent-integration-row-utils.js';

export class AgentIntegrationObservationStore {
  constructor(private readonly db: Database.Database) {}

  findByIdempotencyKey(adapterName: string, eventId: string): AgentObservation | null {
    const row = this.db
      .prepare('SELECT * FROM agent_observation WHERE adapter_name = ? AND event_id = ?')
      .get(adapterName, eventId) as ObservationRow | undefined;
    return row ? mapObservation(row) : null;
  }

  create(input: CreateObservationInput): AgentObservation {
    this.db.prepare(`
      INSERT INTO agent_observation (
        id, adapter_name, event_id, session_id, event_type, sequence_no,
        tool_name, outcome, payload_json, payload_sha256,
        redaction_metadata_json, status, drop_reason, late_arrival,
        occurred_at, received_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.adapterName,
      input.eventId,
      input.sessionId,
      input.eventType,
      input.sequenceNo,
      input.toolName ?? null,
      input.outcome ?? null,
      input.payloadJson,
      input.payloadSha256,
      input.redactionMetadataJson,
      input.captureStatus,
      input.dropReason ?? null,
      input.lateArrival ? 1 : 0,
      input.occurredAt,
      input.receivedAt,
      input.expiresAt,
    );
    return this.get(input.id)!;
  }

  get(id: string): AgentObservation | null {
    const row = this.db.prepare('SELECT * FROM agent_observation WHERE id = ?').get(id) as
      | ObservationRow
      | undefined;
    return row ? mapObservation(row) : null;
  }

  count(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM agent_observation WHERE session_id = ?')
      .get(sessionId) as { count: number };
    return row.count;
  }

  list(
    sessionId: string,
    query: {
      cursor?: string;
      limit?: number;
      eventType?: string;
      status?: string;
      from?: string;
      to?: string;
    } = {},
  ): ObservationPage {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const conditions = ['session_id = ?'];
    const parameters: unknown[] = [sessionId];
    if (query.eventType) {
      conditions.push('event_type = ?');
      parameters.push(query.eventType);
    }
    if (query.status) {
      conditions.push('status = ?');
      parameters.push(query.status);
    }
    if (query.from) {
      conditions.push('occurred_at >= ?');
      parameters.push(query.from);
    }
    if (query.to) {
      conditions.push('occurred_at <= ?');
      parameters.push(query.to);
    }
    if (query.cursor) {
      const [sequenceNo, occurredAt, receivedAt, id] = decodeCursor(query.cursor);
      conditions.push(`
        (sequence_no > ?)
        OR (sequence_no = ? AND occurred_at > ?)
        OR (sequence_no = ? AND occurred_at = ? AND received_at > ?)
        OR (sequence_no = ? AND occurred_at = ? AND received_at = ? AND id > ?)
      `);
      parameters.push(
        sequenceNo,
        sequenceNo, occurredAt,
        sequenceNo, occurredAt, receivedAt,
        sequenceNo, occurredAt, receivedAt, id,
      );
    }

    const where = conditions.map(condition => `(${condition})`).join(' AND ');
    const rows = this.db
      .prepare(`
        SELECT * FROM agent_observation
        WHERE ${where}
        ORDER BY sequence_no, occurred_at, received_at, id
        LIMIT ?
      `)
      .all(...parameters, limit + 1) as ObservationRow[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapObservation);
    const aggregateRows = this.db
      .prepare(`
        SELECT event_type, status, late_arrival, COUNT(*) AS count
        FROM agent_observation
        WHERE session_id = ?
        GROUP BY event_type, status, late_arrival
      `)
      .all(sessionId) as Array<{
        event_type: string;
        status: string;
        late_arrival: number;
        count: number;
      }>;
    const aggregate = {
      total: 0,
      late: 0,
      byEventType: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
    };
    for (const row of aggregateRows) {
      aggregate.total += row.count;
      if (row.late_arrival === 1) aggregate.late += row.count;
      aggregate.byEventType[row.event_type] =
        (aggregate.byEventType[row.event_type] ?? 0) + row.count;
      aggregate.byStatus[row.status] = (aggregate.byStatus[row.status] ?? 0) + row.count;
    }

    return {
      items,
      nextCursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]!) : null,
      aggregate,
    };
  }

  listAll(sessionId: string): AgentObservation[] {
    return (
      this.db.prepare(`
        SELECT * FROM agent_observation
        WHERE session_id = ?
        ORDER BY sequence_no, occurred_at, received_at, id
      `).all(sessionId) as ObservationRow[]
    ).map(mapObservation);
  }

  clearExpiredPayloads(cutoff: string): number {
    return this.db.prepare(`
      UPDATE agent_observation
      SET payload_json = NULL
      WHERE expires_at IS NOT NULL
        AND expires_at < ?
        AND payload_json IS NOT NULL
    `).run(cutoff).changes;
  }
}
