import type Database from 'better-sqlite3';
import type { MemoryProvenance } from '../../../domains/agent-integration/types.js';
import { mapProvenance, type ProvenanceRow } from './agent-integration-row-utils.js';

export class AgentIntegrationProvenanceStore {
  constructor(private readonly db: Database.Database) {}

  create(input: {
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

  list(query: {
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

  listForSession(sessionId: string): MemoryProvenance[] {
    return (
      this.db.prepare(`
        SELECT * FROM memory_provenance
        WHERE session_id = ?
           OR observation_id IN (
             SELECT id FROM agent_observation WHERE session_id = ?
           )
      `).all(sessionId, sessionId) as ProvenanceRow[]
    ).map(mapProvenance);
  }

  markSourceDeleted(sessionId: string): number {
    return this.db.prepare(`
      UPDATE memory_provenance
      SET source_deleted = 1
      WHERE session_id = ?
         OR observation_id IN (
           SELECT id FROM agent_observation WHERE session_id = ?
         )
    `).run(sessionId, sessionId).changes;
  }
}
