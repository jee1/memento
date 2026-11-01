/**
 * Caller scope for token-bound agents (#1094).
 *
 * Scope derives only from ToolContext.boundAgentId (the API-token binding) —
 * never from client params or the self-declared agentId (header/env). Unbound
 * callers keep legacy unscoped access. A memory the caller does not own is
 * reported exactly like a missing one, so other owners' ids cannot be probed.
 */

import type { ToolContext } from './types.js';
import { buildMemoryFilterSql } from '../shared/utils/memory-filter-sql.js';
import {
  callerMemoryScopeSql,
  selectIdsInScope,
  selectCurrentIdsInScope,
  selectIdsOwnedBy,
  type CallerMemoryScope,
} from '../shared/utils/owned-ids.js';

type ScopeContext = Pick<ToolContext, 'boundAgentId'>;
type ProjectScopeContext = Pick<ToolContext, 'boundProjectId'>;

/** `AND <column> IS ?` for bound callers, empty for unbound ones. */
export function callerOwnerClause(
  context: ScopeContext,
  column = 'owner_id',
): { sql: string; params: string[] } {
  return context.boundAgentId
    ? { sql: ` AND ${column} IS ?`, params: [context.boundAgentId] }
    : { sql: '', params: [] };
}

/** `AND <column> IS ?` for bound project callers, empty for unbound ones (#1094). */
export function callerProjectClause(
  context: ProjectScopeContext,
  column = 'project_id',
): { sql: string; params: string[] } {
  return context.boundProjectId
    ? { sql: ` AND ${column} IS ?`, params: [context.boundProjectId] }
    : { sql: '', params: [] };
}

/** Owner and project the caller is bound to; `{}` for unbound callers. */
export function callerMemoryScope(context: {
  boundAgentId?: string | null;
  boundProjectId?: string | null;
}): CallerMemoryScope {
  return {
    ...(context.boundAgentId ? { owner_id: context.boundAgentId } : {}),
    ...(context.boundProjectId ? { project_id: context.boundProjectId } : {}),
  };
}

type VisibleScopeContext = Pick<ToolContext, 'boundAgentId' | 'boundProjectId'>;

/** `AND <live> AND owner_id IS ? AND project_id IS ?` for `memory_item` rows the caller may read. */
export function callerVisibleClause(context: VisibleScopeContext): { sql: string; params: string[] } {
  const scope = callerMemoryScopeSql(callerMemoryScope(context));
  return { sql: ` AND COALESCE(is_deleted, 0) = 0${scope.sql}`, params: scope.params };
}

/** The subset of `ids` that are live and inside the caller's bound owner and project. */
function filterCallerVisibleIds(
  context: VisibleScopeContext & Pick<ToolContext, 'db'>,
  ids: readonly string[],
): Set<string> {
  return selectIdsInScope(context.db, callerMemoryScope(context), ids);
}

/** Current-state reads compose the shared caller scope with the supersede predicate. */
export function callerCurrentClause(context: VisibleScopeContext, includeSuperseded = false) {
  const visible = callerVisibleClause(context);
  const { clauses, params } = buildMemoryFilterSql({ include_superseded: includeSuperseded }, { itemAlias: 'mi' });
  return {
    sql: visible.sql + clauses.map(clause => ` AND ${clause}`).join(''),
    params: [...visible.params, ...params],
  };
}

/** Explicit history retains caller scope and deletion checks. */
export function filterCallerCurrentIds(
  context: VisibleScopeContext & Pick<ToolContext, 'db'>,
  ids: readonly string[],
  includeSuperseded = false,
): Set<string> {
  if (includeSuperseded) return filterCallerVisibleIds(context, ids);
  return selectCurrentIdsInScope(context.db, callerMemoryScope(context), ids);
}

/** The subset of `ids` the caller owns. Unbound callers own every id. */
export function filterCallerOwnedIds(
  context: Pick<ToolContext, 'boundAgentId' | 'db'>,
  ids: readonly string[],
): Set<string> {
  if (!context.boundAgentId) return new Set(ids);
  return selectIdsOwnedBy(context.db, context.boundAgentId, ids);
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
