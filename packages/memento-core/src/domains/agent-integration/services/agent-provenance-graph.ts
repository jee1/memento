import type { MemoryProvenance, ProvenanceTrace } from '../types.js';

export type ProvenanceGraphQuery = {
  memoryId?: string;
  observationId?: string;
  direction?: 'sources' | 'derived' | 'both';
  maxDepth?: number;
};

export function buildProvenanceTrace(
  rows: MemoryProvenance[],
  query: ProvenanceGraphQuery,
): ProvenanceTrace {
  const nodes = new Map<string, ProvenanceTrace['nodes'][number]>();
  const edges: ProvenanceTrace['edges'] = [];
  const direction = query.direction ?? 'sources';
  const maxDepth = Math.min(Math.max(query.maxDepth ?? 3, 0), 10);
  let truncated = false;

  if (query.memoryId) {
    nodes.set(`memory:${query.memoryId}`, { kind: 'memory', id: query.memoryId });
  }
  if (query.observationId) {
    nodes.set(`observation:${query.observationId}`, {
      kind: 'observation',
      id: query.observationId,
    });
  }

  for (const row of rows) {
    const memoryKey = `memory:${row.memoryId}`;
    const observationKey = row.observationId
      ? `observation:${row.observationId}`
      : null;
    const sessionKey = row.sessionId ? `session:${row.sessionId}` : null;

    if (
      query.observationId
      && (direction === 'derived' || direction === 'both')
    ) {
      if (maxDepth >= 1) {
        nodes.set(memoryKey, { kind: 'memory', id: row.memoryId });
        edges.push({
          from: `observation:${query.observationId}`,
          to: memoryKey,
          type: row.derivationType,
        });
      } else {
        truncated = true;
      }
    }

    if (
      query.observationId
      && sessionKey
      && (direction === 'sources' || direction === 'both')
    ) {
      if (maxDepth >= 1) {
        nodes.set(sessionKey, {
          kind: 'session',
          id: row.sessionId!,
          sourceDeleted: row.sourceDeleted,
        });
        edges.push({
          from: `observation:${query.observationId}`,
          to: sessionKey,
          type: 'observed_in',
        });
      } else {
        truncated = true;
      }
    }

    if (
      query.memoryId
      && (direction === 'sources' || direction === 'both')
      && observationKey
    ) {
      if (maxDepth < 1) {
        truncated = true;
        continue;
      }
      nodes.set(observationKey, {
        kind: 'observation',
        id: row.observationId!,
        sourceDeleted: row.sourceDeleted,
      });
      edges.push({ from: memoryKey, to: observationKey, type: row.derivationType });
      if (sessionKey && maxDepth >= 2) {
        nodes.set(sessionKey, {
          kind: 'session',
          id: row.sessionId!,
          sourceDeleted: row.sourceDeleted,
        });
        edges.push({
          from: observationKey,
          to: sessionKey,
          type: 'observed_in',
        });
      } else if (sessionKey) {
        truncated = true;
      }
    } else if (
      query.memoryId
      && (direction === 'sources' || direction === 'both')
      && sessionKey
    ) {
      if (maxDepth >= 1) {
        nodes.set(sessionKey, {
          kind: 'session',
          id: row.sessionId!,
          sourceDeleted: row.sourceDeleted,
        });
        edges.push({ from: memoryKey, to: sessionKey, type: row.derivationType });
      } else {
        truncated = true;
      }
    }
  }
  return { nodes: [...nodes.values()], edges, truncated };
}
