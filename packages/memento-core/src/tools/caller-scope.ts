/**
 * Caller scope for token-bound agents (#1094).
 *
 * Scope derives only from ToolContext.boundAgentId (the API-token binding) —
 * never from client params or the self-declared agentId (header/env). Unbound
 * callers keep legacy unscoped access. A memory the caller does not own is
 * reported exactly like a missing one, so other owners' ids cannot be probed.
 */

import type { ToolContext } from './types.js';

type ScopeContext = Pick<ToolContext, 'boundAgentId'>;

/** `AND <column> IS ?` for bound callers, empty for unbound ones. */
export function callerOwnerClause(
  context: ScopeContext,
  column = 'owner_id',
): { sql: string; params: string[] } {
  return context.boundAgentId
    ? { sql: ` AND ${column} IS ?`, params: [context.boundAgentId] }
    : { sql: '', params: [] };
}

/** The subset of `ids` the caller owns. Unbound callers own every id. */
export function filterCallerOwnedIds(
  context: Pick<ToolContext, 'boundAgentId' | 'db'>,
  ids: readonly string[],
): Set<string> {
  const unique = [...new Set(ids)];
  if (!context.boundAgentId || unique.length === 0) return new Set(unique);
  const rows = context.db
    .prepare(`SELECT id FROM memory_item WHERE owner_id IS ? AND id IN (${unique.map(() => '?').join(',')})`)
    .all(context.boundAgentId, ...unique) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/**
 * Agent slot (anchors, attribution) the caller may act as. Bound callers are
 * pinned to their own agent; `'default'` is the schemas' fallback value and
 * maps to the bound agent.
 */
export function resolveCallerAgentId(context: ScopeContext, requested: string): string;
export function resolveCallerAgentId(context: ScopeContext, requested: string | undefined): string | undefined;
export function resolveCallerAgentId(context: ScopeContext, requested: string | undefined): string | undefined {
  if (!context.boundAgentId) return requested;
  if (requested && requested !== 'default' && requested !== context.boundAgentId) {
    throw new Error(`agent_id '${requested}' does not match the token-bound agent`);
  }
  return context.boundAgentId;
}
