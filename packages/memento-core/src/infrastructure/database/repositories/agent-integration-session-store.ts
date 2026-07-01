import type Database from 'better-sqlite3';
import type {
  AgentDashboardAggregate,
  AgentSession,
  AgentSessionObservationAggregate,
  AgentSessionPage,
  PersistedAgentEventInput,
} from '../../../domains/agent-integration/types.js';
import {
  decodeSessionCursor,
  emptySessionObservationAggregate,
  encodeSessionCursor,
} from './agent-integration-cursor-utils.js';
import { mapSession, type SessionRow } from './agent-integration-row-utils.js';

export class AgentIntegrationSessionStore {
  constructor(private readonly db: Database.Database) {}

  create(event: PersistedAgentEventInput, now: string): AgentSession {
    this.db.prepare(`
      INSERT INTO agent_session (
        id, adapter_name, adapter_version, contract_version,
        owner_id, project_id, process_id, status,
        started_at, last_event_at, max_sequence_no,
        agent_metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)
    `).run(
      event.sessionId,
      event.adapterName,
      event.adapterVersion,
      event.contractVersion,
      event.scope.ownerId ?? null,
      event.scope.projectId ?? null,
      event.scope.processId ?? null,
      event.occurredAt,
      event.occurredAt,
      event.sequenceNo,
      event.payloadJson,
      now,
      now,
    );
    return this.get(event.sessionId)!;
  }

  get(id: string): AgentSession | null {
    const row = this.db.prepare('SELECT * FROM agent_session WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ? mapSession(row) : null;
  }

  list(
    query: {
      cursor?: string;
      limit?: number;
      status?: AgentSession['status'];
      adapterName?: string;
      ownerId?: string;
      projectId?: string;
    } = {},
  ): AgentSessionPage {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    if (query.status) {
      conditions.push('status = ?');
      parameters.push(query.status);
    }
    if (query.adapterName) {
      conditions.push('adapter_name = ?');
      parameters.push(query.adapterName);
    }
    if (query.ownerId) {
      conditions.push('owner_id = ?');
      parameters.push(query.ownerId);
    }
    if (query.projectId) {
      conditions.push('project_id = ?');
      parameters.push(query.projectId);
    }
    if (query.cursor) {
      const [lastEventAt, id] = decodeSessionCursor(query.cursor);
      conditions.push('(last_event_at < ? OR (last_event_at = ? AND id < ?))');
      parameters.push(lastEventAt, lastEventAt, id);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.map(condition => `(${condition})`).join(' AND ')}`
      : '';
    const rows = this.db
      .prepare(`
        SELECT * FROM agent_session
        ${where}
        ORDER BY last_event_at DESC, id DESC
        LIMIT ?
      `)
      .all(...parameters, limit + 1) as SessionRow[];
    const hasMore = rows.length > limit;
    const sessions = rows.slice(0, limit).map(mapSession);
    const aggregateBySession = new Map<string, AgentSessionObservationAggregate>(
      sessions.map(session => [session.id, emptySessionObservationAggregate()]),
    );

    if (sessions.length > 0) {
      const placeholders = sessions.map(() => '?').join(', ');
      const aggregateRows = this.db
        .prepare(`
          SELECT session_id, event_type, status, late_arrival, COUNT(*) AS count
          FROM agent_observation
          WHERE session_id IN (${placeholders})
          GROUP BY session_id, event_type, status, late_arrival
        `)
        .all(...sessions.map(session => session.id)) as Array<{
          session_id: string;
          event_type: string;
          status: string;
          late_arrival: number;
          count: number;
        }>;
      for (const row of aggregateRows) {
        const aggregate = aggregateBySession.get(row.session_id)!;
        aggregate.total += row.count;
        if (row.late_arrival === 1) aggregate.late += row.count;
        aggregate.byEventType[row.event_type] =
          (aggregate.byEventType[row.event_type] ?? 0) + row.count;
        aggregate.byStatus[row.status] = (aggregate.byStatus[row.status] ?? 0) + row.count;
        if (row.status === 'REDACTED') aggregate.redacted += row.count;
        if (row.status === 'DROPPED') aggregate.dropped += row.count;
        if (row.status === 'DEGRADED') aggregate.degraded += row.count;
      }
    }

    return {
      items: sessions.map(session => ({
        session,
        aggregate: aggregateBySession.get(session.id)!,
      })),
      nextCursor: hasMore && sessions.length > 0
        ? encodeSessionCursor(sessions[sessions.length - 1]!)
        : null,
    };
  }

  getDashboardAggregate(): AgentDashboardAggregate {
    const sessionRows = this.db
      .prepare(`
        SELECT status, COUNT(*) AS count
        FROM agent_session
        GROUP BY status
      `)
      .all() as Array<{ status: string; count: number }>;
    const observationRows = this.db
      .prepare(`
        SELECT event_type, status, late_arrival, COUNT(*) AS count
        FROM agent_observation
        GROUP BY event_type, status, late_arrival
      `)
      .all() as Array<{
        event_type: string;
        status: string;
        late_arrival: number;
        count: number;
      }>;
    const aggregate: AgentDashboardAggregate = {
      sessionsTotal: 0,
      sessionsByStatus: {},
      observationsTotal: 0,
      observationsByStatus: {},
      observationsByEventType: {},
      redactedTotal: 0,
      droppedTotal: 0,
      degradedTotal: 0,
      lateTotal: 0,
    };

    for (const row of sessionRows) {
      aggregate.sessionsTotal += row.count;
      aggregate.sessionsByStatus[row.status] = row.count;
    }
    for (const row of observationRows) {
      aggregate.observationsTotal += row.count;
      aggregate.observationsByStatus[row.status] =
        (aggregate.observationsByStatus[row.status] ?? 0) + row.count;
      aggregate.observationsByEventType[row.event_type] =
        (aggregate.observationsByEventType[row.event_type] ?? 0) + row.count;
      if (row.status === 'REDACTED') aggregate.redactedTotal += row.count;
      if (row.status === 'DROPPED') aggregate.droppedTotal += row.count;
      if (row.status === 'DEGRADED') aggregate.degradedTotal += row.count;
      if (row.late_arrival === 1) aggregate.lateTotal += row.count;
    }

    return aggregate;
  }

  update(
    id: string,
    patch: Partial<Pick<
      AgentSession,
      'status' | 'endedAt' | 'lastEventAt' | 'maxSequenceNo' | 'degradedReason'
    >>,
    now: string,
  ): AgentSession {
    const current = this.get(id);
    if (!current) {
      throw new Error(`Agent session not found: ${id}`);
    }
    this.db.prepare(`
      UPDATE agent_session
      SET status = ?,
          ended_at = ?,
          last_event_at = ?,
          max_sequence_no = ?,
          degraded_reason = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      patch.status ?? current.status,
      patch.endedAt === undefined ? current.endedAt : patch.endedAt,
      patch.lastEventAt ?? current.lastEventAt,
      patch.maxSequenceNo ?? current.maxSequenceNo,
      patch.degradedReason === undefined ? current.degradedReason : patch.degradedReason,
      now,
      id,
    );
    return this.get(id)!;
  }

  markExpiredAbandoned(cutoff: string, now: string): string[] {
    const rows = this.db.prepare(`
      UPDATE agent_session
      SET status = 'ABANDONED', ended_at = last_event_at, updated_at = ?
      WHERE (
          status IN ('ACTIVE', 'COMPACTING')
          OR (status = 'DEGRADED' AND ended_at IS NULL)
        )
        AND last_event_at < ?
      RETURNING id
    `).all(now, cutoff) as Array<{ id: string }>;
    return rows.map(row => row.id);
  }

  delete(id: string, markProvenanceSourceDeleted: (sessionId: string) => number): boolean {
    markProvenanceSourceDeleted(id);
    return this.db.prepare('DELETE FROM agent_session WHERE id = ?').run(id).changes > 0;
  }
}
