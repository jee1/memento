import { AgentIntegrationError, SqliteAgentIntegrationRepository } from '@memento/core';
import type Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { observationDto, provenanceDto, sessionDto } from './agent.routes.dto.js';
import type { AgentRouterCtx } from './agent.routes.types.js';
import { requireString, writeError } from './agent.routes.utils.js';

function resolveProvenanceFilter(
  query: Request['query'],
): { memoryId: string | undefined; observationId: string | undefined } {
  return {
    memoryId: typeof query.memory_id === 'string' ? query.memory_id : undefined,
    observationId: typeof query.observation_id === 'string' ? query.observation_id : undefined,
  };
}

function loadProvenanceMemories(
  db: Database.Database,
  edges: ReadonlyArray<{ memoryId: string; sourceDeleted?: boolean | null }>,
) {
  const stmt = db.prepare(`
    SELECT id, type, substr(content, 1, 240) AS content_preview, created_at
    FROM memory_item
    WHERE id = ?
  `);
  const memoryIds = [...new Set(edges.map(e => e.memoryId))];
  return memoryIds.flatMap((id) => {
    const row = stmt.get(id) as {
      id: string; type: string; content_preview: string; created_at: string | null;
    } | undefined;
    return row ? [{ ...row, source_deleted: edges.some(e => e.memoryId === id && e.sourceDeleted) }] : [];
  });
}

function loadProvenanceObservations(
  repository: InstanceType<typeof SqliteAgentIntegrationRepository>,
  edges: ReadonlyArray<{ observationId?: string | null }>,
) {
  const observationIds = [...new Set(edges.flatMap(e => e.observationId ? [e.observationId] : []))];
  return observationIds.flatMap((id) => {
    const observation = repository.getObservation(id);
    return observation ? [observationDto(observation)] : [];
  });
}

function loadProvenanceSessions(
  service: NonNullable<AgentRouterCtx['service']>,
  edges: ReadonlyArray<{ sessionId?: string | null }>,
) {
  const sessionIds = [...new Set(edges.flatMap(e => e.sessionId ? [e.sessionId] : []))];
  return sessionIds.flatMap((id) => {
    const session = service.getSession(id);
    return session ? [sessionDto(session)] : [];
  });
}

export function handlePostProvenance(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const provenance = service.linkProvenance({
      memoryId: requireString(req.body?.memory_id, 'memory_id'),
      sessionId: typeof req.body?.session_id === 'string' ? req.body.session_id : undefined,
      observationId:
        typeof req.body?.observation_id === 'string' ? req.body.observation_id : undefined,
      derivationType: requireString(req.body?.derivation_type, 'derivation_type'),
    });
    return res.status(201).json(provenanceDto(provenance));
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleGetProvenance(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    return res.json(service.getProvenance({
      memoryId: typeof req.query.memory_id === 'string' ? req.query.memory_id : undefined,
      observationId:
        typeof req.query.observation_id === 'string' ? req.query.observation_id : undefined,
      direction:
        req.query.direction === 'derived' || req.query.direction === 'both'
          ? req.query.direction
          : 'sources',
      maxDepth: typeof req.query.max_depth === 'string' ? Number(req.query.max_depth) : undefined,
    }));
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleGetProvenanceDetail(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service, repository, db } = ctx;
    if (!service || !repository || !db) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const { memoryId, observationId } = resolveProvenanceFilter(req.query);
    if (!memoryId && !observationId) {
      throw new AgentIntegrationError('memory_id or observation_id is required', 'INVALID_ENVELOPE', 400);
    }
    const edges = repository.listProvenance({ memoryId, observationId }).slice(0, 100);
    return res.json({
      edges: edges.map(provenanceDto),
      memories: loadProvenanceMemories(db, edges),
      observations: loadProvenanceObservations(repository, edges),
      sessions: loadProvenanceSessions(service, edges),
      truncated: edges.length === 100,
    });
  } catch (error) {
    return writeError(res, error);
  }
}
