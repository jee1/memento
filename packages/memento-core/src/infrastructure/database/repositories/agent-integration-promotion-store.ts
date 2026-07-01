import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { CreateAgentMemoryPromotionCandidateInput } from '../../../domains/agent-integration/repositories/agent-integration-repository.js';
import type {
  AgentMemoryPromotionCandidate,
  AgentSession,
} from '../../../domains/agent-integration/types.js';
import {
  mapPromotionCandidate,
  normalizePromotionContent,
  type PromotionCandidateRow,
} from './agent-integration-row-utils.js';

export class AgentIntegrationPromotionStore {
  constructor(
    private readonly db: Database.Database,
    private readonly getSession: (id: string) => AgentSession | null,
    private readonly runInTransaction: <T>(operation: () => T) => T,
  ) {}

  findByFingerprint(fingerprint: string): AgentMemoryPromotionCandidate | null {
    const row = this.db.prepare(`
      SELECT * FROM agent_memory_promotion_candidate WHERE fingerprint = ?
    `).get(fingerprint) as PromotionCandidateRow | undefined;
    return row ? mapPromotionCandidate(row) : null;
  }

  create(input: CreateAgentMemoryPromotionCandidateInput): AgentMemoryPromotionCandidate {
    this.db.prepare(`
      INSERT INTO agent_memory_promotion_candidate (
        id, fingerprint, session_id, summary_memory_id, target_type, category,
        content, confidence, evidence_observation_ids_json, merge_target_memory_id,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      input.id,
      input.fingerprint,
      input.sessionId,
      input.summaryMemoryId,
      input.targetType,
      input.category,
      input.content,
      input.confidence,
      JSON.stringify(input.evidenceObservationIds),
      input.mergeTargetMemoryId,
      input.createdAt,
      input.createdAt,
    );
    return this.findByFingerprint(input.fingerprint)!;
  }

  list(query: {
    sessionId?: string;
    status?: AgentMemoryPromotionCandidate['status'];
  } = {}): AgentMemoryPromotionCandidate[] {
    const conditions: string[] = [];
    const parameters: string[] = [];
    if (query.sessionId) {
      conditions.push('session_id = ?');
      parameters.push(query.sessionId);
    }
    if (query.status) {
      conditions.push('status = ?');
      parameters.push(query.status);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return (
      this.db.prepare(`
        SELECT * FROM agent_memory_promotion_candidate
        ${where}
        ORDER BY confidence DESC, created_at, id
      `).all(...parameters) as PromotionCandidateRow[]
    ).map(mapPromotionCandidate);
  }

  findScopedMemoryByContent(input: {
    targetType: AgentMemoryPromotionCandidate['targetType'];
    content: string;
    ownerId: string | null;
    projectId: string | null;
    processId: string | null;
  }): string | null {
    const rows = this.db.prepare(`
      SELECT id, content FROM memory_item
      WHERE type = ?
        AND owner_id IS ?
        AND project_id IS ?
        AND process_id IS ?
    `).all(
      input.targetType,
      input.ownerId,
      input.projectId,
      input.processId,
    ) as Array<{ id: string; content: string }>;
    const normalized = normalizePromotionContent(input.content);
    return rows.find(row => normalizePromotionContent(row.content) === normalized)?.id ?? null;
  }

  approve(
    candidateId: string,
    memoryId: string,
    now: string,
  ): AgentMemoryPromotionCandidate {
    return this.runInTransaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM agent_memory_promotion_candidate WHERE id = ?
      `).get(candidateId) as PromotionCandidateRow | undefined;
      if (!row) throw new Error(`Agent memory promotion candidate not found: ${candidateId}`);
      const candidate = mapPromotionCandidate(row);
      if (candidate.status !== 'pending') return candidate;
      const session = this.getSession(candidate.sessionId);
      if (!session) throw new Error(`Agent session not found: ${candidate.sessionId}`);

      const targetExists = Boolean(
        this.db.prepare('SELECT 1 FROM memory_item WHERE id = ?').get(memoryId),
      );
      if (!targetExists) {
        this.db.prepare(`
          INSERT INTO memory_item (
            id, type, content, importance, privacy_scope, tags, source, origin_source,
            owner_id, process_id, session_id, project_id, source_session_id,
            confidence, created_at
          ) VALUES (?, ?, ?, ?, 'private', ?, 'agent_memory_promotion', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          memoryId,
          candidate.targetType,
          candidate.content,
          candidate.confidence,
          JSON.stringify(['agent-memory', 'promotion', candidate.category]),
          JSON.stringify({
            tool: 'agent-memory-promotion',
            caller: 'review',
            timestamp: now,
          }),
          session.ownerId,
          session.processId,
          session.id,
          session.projectId,
          session.id,
          candidate.confidence,
          now,
        );
      }
      this.db.prepare(`
        INSERT OR IGNORE INTO memory_link (
          source_id, target_id, relation_type, created_at
        ) VALUES (?, ?, 'derived_from', ?)
      `).run(memoryId, candidate.summaryMemoryId, now);
      const insertProvenance = this.db.prepare(`
        INSERT OR IGNORE INTO memory_provenance (
          id, memory_id, session_id, observation_id, derivation_type, created_at
        ) VALUES (?, ?, ?, ?, 'promotion', ?)
      `);
      for (const observationId of candidate.evidenceObservationIds) {
        insertProvenance.run(randomUUID(), memoryId, candidate.sessionId, observationId, now);
      }
      this.db.prepare(`
        UPDATE agent_memory_promotion_candidate
        SET status = 'approved', memory_id = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(memoryId, now, now, candidateId);
      return mapPromotionCandidate(
        this.db.prepare(`
          SELECT * FROM agent_memory_promotion_candidate WHERE id = ?
        `).get(candidateId) as PromotionCandidateRow,
      );
    });
  }

  reject(
    candidateId: string,
    reason: string,
    now: string,
  ): AgentMemoryPromotionCandidate {
    return this.runInTransaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM agent_memory_promotion_candidate WHERE id = ?
      `).get(candidateId) as PromotionCandidateRow | undefined;
      if (!row) throw new Error(`Agent memory promotion candidate not found: ${candidateId}`);
      const candidate = mapPromotionCandidate(row);
      if (candidate.status !== 'pending') return candidate;
      this.db.prepare(`
        UPDATE agent_memory_promotion_candidate
        SET status = 'rejected', rejection_reason = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(reason, now, now, candidateId);
      return mapPromotionCandidate(
        this.db.prepare(`
          SELECT * FROM agent_memory_promotion_candidate WHERE id = ?
        `).get(candidateId) as PromotionCandidateRow,
      );
    });
  }

  persistSessionSummary(input: {
    memoryId: string;
    session: AgentSession;
    content: string;
    observationIds: string[];
    createdAt: string;
  }): { memoryId: string; created: boolean } {
    return this.runInTransaction(() => {
      const current = this.getSession(input.session.id);
      if (!current) throw new Error(`Agent session not found: ${input.session.id}`);
      if (current.summaryMemoryId) {
        return { memoryId: current.summaryMemoryId, created: false };
      }
      if (!['COMPLETED', 'DEGRADED', 'ABANDONED'].includes(current.status)) {
        throw new Error(`Agent session is not terminal: ${input.session.id}`);
      }

      this.db.prepare(`
        INSERT INTO memory_item (
          id, type, content, importance, privacy_scope, tags, source, origin_source,
          owner_id, process_id, session_id, project_id, source_session_id, created_at
        ) VALUES (?, 'episodic', ?, 0.7, 'private', ?, 'agent_session_summary', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.memoryId,
        input.content,
        JSON.stringify(['agent-session', 'summary', current.adapterName]),
        JSON.stringify({
          tool: 'agent-session-summary',
          caller: 'agent-integration',
          timestamp: input.createdAt,
        }),
        current.ownerId,
        current.processId,
        current.id,
        current.projectId,
        current.id,
        input.createdAt,
      );

      const insertProvenance = this.db.prepare(`
        INSERT INTO memory_provenance (
          id, memory_id, session_id, observation_id, derivation_type, created_at
        ) VALUES (?, ?, ?, ?, 'summary', ?)
      `);
      for (const observationId of input.observationIds) {
        insertProvenance.run(
          randomUUID(),
          input.memoryId,
          current.id,
          observationId,
          input.createdAt,
        );
      }

      this.db.prepare(`
        UPDATE agent_session
        SET summary_memory_id = ?, updated_at = ?
        WHERE id = ? AND summary_memory_id IS NULL
      `).run(input.memoryId, input.createdAt, current.id);
      return { memoryId: input.memoryId, created: true };
    });
  }
}
