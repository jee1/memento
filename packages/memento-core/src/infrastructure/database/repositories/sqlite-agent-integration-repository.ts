import type Database from 'better-sqlite3';
import type {
  AgentIntegrationRepository,
  CreateObservationInput,
} from '../../../domains/agent-integration/repositories/agent-integration-repository.js';
import type {
  AgentObservation,
  AgentSession,
  MemoryProvenance,
  ObservationPage,
  PersistedAgentEventInput,
} from '../../../domains/agent-integration/types.js';

type SessionRow = {
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

type ObservationRow = {
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

type ProvenanceRow = {
  id: string;
  memory_id: string;
  session_id: string | null;
  observation_id: string | null;
  derivation_type: string;
  source_deleted: number;
  created_at: string;
};

function mapSession(row: SessionRow): AgentSession {
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

function mapObservation(row: ObservationRow): AgentObservation {
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

function mapProvenance(row: ProvenanceRow): MemoryProvenance {
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

function encodeCursor(item: AgentObservation): string {
  return Buffer.from(JSON.stringify([
    item.sequenceNo,
    item.occurredAt,
    item.receivedAt,
    item.id,
  ])).toString('base64url');
}

function decodeCursor(cursor: string): [number, string, string, string] {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 4) {
    throw new Error('Invalid observation cursor');
  }
  return parsed as [number, string, string, string];
}

export class SqliteAgentIntegrationRepository implements AgentIntegrationRepository {
  constructor(private readonly db: Database.Database) {}

  runInTransaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  schemaReady(): boolean {
    const rows = this.db
      .prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('agent_session', 'agent_observation', 'memory_provenance')
      `)
      .all() as Array<{ name: string }>;
    return rows.length === 3;
  }

  createSession(event: PersistedAgentEventInput, now: string): AgentSession {
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
    return this.getSession(event.sessionId)!;
  }

  getSession(id: string): AgentSession | null {
    const row = this.db.prepare('SELECT * FROM agent_session WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ? mapSession(row) : null;
  }

  updateSession(
    id: string,
    patch: Partial<Pick<
      AgentSession,
      'status' | 'endedAt' | 'lastEventAt' | 'maxSequenceNo' | 'degradedReason'
    >>,
    now: string,
  ): AgentSession {
    const current = this.getSession(id);
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
    return this.getSession(id)!;
  }

  findObservationByIdempotencyKey(
    adapterName: string,
    eventId: string,
  ): AgentObservation | null {
    const row = this.db
      .prepare('SELECT * FROM agent_observation WHERE adapter_name = ? AND event_id = ?')
      .get(adapterName, eventId) as ObservationRow | undefined;
    return row ? mapObservation(row) : null;
  }

  createObservation(input: CreateObservationInput): AgentObservation {
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
    return this.getObservation(input.id)!;
  }

  getObservation(id: string): AgentObservation | null {
    const row = this.db.prepare('SELECT * FROM agent_observation WHERE id = ?').get(id) as
      | ObservationRow
      | undefined;
    return row ? mapObservation(row) : null;
  }

  countObservations(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM agent_observation WHERE session_id = ?')
      .get(sessionId) as { count: number };
    return row.count;
  }

  listObservations(
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

  markExpiredSessionsAbandoned(cutoff: string, now: string): number {
    return this.db.prepare(`
      UPDATE agent_session
      SET status = 'ABANDONED', ended_at = last_event_at, updated_at = ?
      WHERE (
          status IN ('ACTIVE', 'COMPACTING')
          OR (status = 'DEGRADED' AND ended_at IS NULL)
        )
        AND last_event_at < ?
    `).run(now, cutoff).changes;
  }

  clearExpiredObservationPayloads(cutoff: string): number {
    return this.db.prepare(`
      UPDATE agent_observation
      SET payload_json = NULL
      WHERE expires_at IS NOT NULL
        AND expires_at < ?
        AND payload_json IS NOT NULL
    `).run(cutoff).changes;
  }

  createProvenance(input: {
    id: string;
    memoryId: string;
    sessionId?: string | null;
    observationId?: string | null;
    derivationType: string;
    createdAt: string;
  }): MemoryProvenance {
    this.db.prepare(`
      INSERT INTO memory_provenance (
        id, memory_id, session_id, observation_id, derivation_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.memoryId,
      input.sessionId ?? null,
      input.observationId ?? null,
      input.derivationType,
      input.createdAt,
    );
    const row = this.db.prepare('SELECT * FROM memory_provenance WHERE id = ?').get(input.id) as
      ProvenanceRow;
    return mapProvenance(row);
  }

  listProvenance(query: {
    memoryId?: string;
    observationId?: string;
  }): MemoryProvenance[] {
    const conditions: string[] = [];
    const parameters: string[] = [];
    if (query.memoryId) {
      conditions.push('memory_id = ?');
      parameters.push(query.memoryId);
    }
    if (query.observationId) {
      conditions.push('observation_id = ?');
      parameters.push(query.observationId);
    }
    if (conditions.length === 0) return [];
    return (
      this.db
        .prepare(`SELECT * FROM memory_provenance WHERE ${conditions.join(' OR ')}`)
        .all(...parameters) as ProvenanceRow[]
    ).map(mapProvenance);
  }

  markProvenanceSourceDeleted(sessionId: string): number {
    return this.db.prepare(`
      UPDATE memory_provenance
      SET source_deleted = 1
      WHERE session_id = ?
         OR observation_id IN (
           SELECT id FROM agent_observation WHERE session_id = ?
         )
    `).run(sessionId, sessionId).changes;
  }

  deleteSession(sessionId: string): boolean {
    this.markProvenanceSourceDeleted(sessionId);
    return this.db.prepare('DELETE FROM agent_session WHERE id = ?').run(sessionId).changes > 0;
  }

  exportSession(sessionId: string): {
    session: AgentSession;
    observations: AgentObservation[];
    provenance: MemoryProvenance[];
  } | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const observations: AgentObservation[] = [];
    let cursor: string | undefined;
    do {
      const page = this.listObservations(sessionId, { limit: 100, cursor });
      observations.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const provenance = (
      this.db.prepare(`
        SELECT * FROM memory_provenance
        WHERE session_id = ?
           OR observation_id IN (
             SELECT id FROM agent_observation WHERE session_id = ?
           )
      `).all(sessionId, sessionId) as
        ProvenanceRow[]
    ).map(mapProvenance);
    return { session, observations, provenance };
  }
}
