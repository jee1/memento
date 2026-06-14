import type { PersistedAgentEventInput } from '@memento/core';
import type Database from 'better-sqlite3';
import { parsePayload, safeNumber, safeRecord } from './agent.routes.utils.js';

export function initialInjectionQuery(prepared: PersistedAgentEventInput): string {
  const payload = parsePayload(prepared);
  if (typeof payload.initial_context === 'string' && payload.initial_context.trim()) {
    return payload.initial_context.trim();
  }
  if (typeof payload.working_directory === 'string' && payload.working_directory.trim()) {
    return payload.working_directory.trim();
  }
  return prepared.scope.processId ?? prepared.scope.projectId ?? 'session start';
}

export function injectionScope(prepared: PersistedAgentEventInput) {
  return {
    ownerId: prepared.scope.ownerId ?? '',
    projectId: prepared.scope.projectId,
    processId: prepared.scope.processId,
    sessionId: prepared.sessionId,
  };
}

export function buildInjectionDetails(
  db: Database.Database,
  sessionId: string,
): { injections: Array<Record<string, unknown>>; degraded: boolean } {
  const rows = db.prepare(`
    SELECT event_type, created_at, extra_data
    FROM telemetry_events
    WHERE event_type IN ('agent.injection.completed', 'agent.injection.used')
      AND json_extract(extra_data, '$.session_id') = ?
    ORDER BY created_at, id
  `).all(sessionId) as Array<{
    event_type: string;
    created_at: string;
    extra_data: string | null;
  }>;
  const injections = new Map<string, {
    completed?: Record<string, unknown>;
    usedMemoryIds: Set<string>;
    createdAt: string;
  }>();
  let degraded = false;
  for (const row of rows) {
    try {
      const data = safeRecord(JSON.parse(row.extra_data ?? '{}'));
      const injectionId = typeof data.injection_id === 'string' ? data.injection_id : '';
      if (!injectionId) {
        degraded = true;
        continue;
      }
      const entry = injections.get(injectionId) ?? {
        usedMemoryIds: new Set<string>(),
        createdAt: row.created_at,
      };
      if (row.event_type === 'agent.injection.completed') {
        entry.completed = data;
      } else if (Array.isArray(data.used_memory_ids)) {
        for (const memoryId of data.used_memory_ids) {
          if (typeof memoryId === 'string') entry.usedMemoryIds.add(memoryId);
        }
      }
      injections.set(injectionId, entry);
    } catch {
      degraded = true;
    }
  }

  return {
    injections: [...injections.entries()].map(([injectionId, entry]) => {
      const completed = entry.completed ?? {};
      const selected = Array.isArray(completed.selected) ? completed.selected : [];
      const exclusions = Array.isArray(completed.exclusions) ? completed.exclusions : [];
      const candidates = [
        ...selected.map((item) => {
          const candidate = safeRecord(item);
          const memoryId = typeof candidate.memory_id === 'string' ? candidate.memory_id : '';
          return {
            memory_id: memoryId,
            decision: 'selected',
            score: safeNumber(candidate.score),
            token_estimate: safeNumber(candidate.token_estimate),
            reason: typeof candidate.selection_reason === 'string'
              ? candidate.selection_reason
              : null,
            used: entry.usedMemoryIds.has(memoryId),
          };
        }),
        ...exclusions.map((item) => {
          const candidate = safeRecord(item);
          const memoryId = typeof candidate.memory_id === 'string' ? candidate.memory_id : '';
          return {
            memory_id: memoryId,
            decision: 'excluded',
            score: safeNumber(candidate.score),
            token_estimate: safeNumber(candidate.token_estimate),
            reason: typeof candidate.reason === 'string' ? candidate.reason : null,
            used: entry.usedMemoryIds.has(memoryId),
          };
        }),
      ];
      return {
        injection_id: injectionId,
        session_id: sessionId,
        trigger: typeof completed.trigger === 'string' ? completed.trigger : null,
        status: Array.isArray(completed.degraded_reasons)
          && completed.degraded_reasons.length > 0
          ? 'degraded'
          : candidates.length > 0 ? 'ok' : 'empty',
        created_at: entry.createdAt,
        token_budget: safeNumber(completed.token_budget),
        token_used: safeNumber(completed.token_used),
        degraded_reasons: Array.isArray(completed.degraded_reasons)
          ? completed.degraded_reasons.filter((item): item is string => typeof item === 'string')
          : [],
        candidates,
      };
    }),
    degraded,
  };
}
