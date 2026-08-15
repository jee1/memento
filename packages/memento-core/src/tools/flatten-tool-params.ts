/**
 * MCP/HTTP tool params: hoist nested `filters` once to top-level fields.
 * Client (`search-client`) posts `{ query, filters, limit }`; RecallTool reads top-level.
 * Top-level keys win when both are present (MCP stdio compat).
 */

const FILTER_HOIST_KEYS = [
  'tags',
  'privacy_scope',
  'time_from',
  'time_to',
  'pinned',
  'id',
  'project_id',
  'process_id',
  'session_id',
  'importance_min',
  'importance_max',
  'has_reflection_notes',
  'workflow_name',
  'skill_name',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hoistTypeField(
  out: Record<string, unknown>,
  nestedType: unknown,
): void {
  if (out.type !== undefined || out.memory_types !== undefined) {
    return;
  }
  if (typeof nestedType === 'string') {
    out.type = nestedType;
    return;
  }
  if (Array.isArray(nestedType) && nestedType.length > 0) {
    out.memory_types = nestedType;
  }
}

/**
 * Flatten nested `filters` onto top-level tool params. Idempotent for already-flat MCP args.
 */
export function flattenNestedToolFilters(params: unknown): unknown {
  if (!isPlainObject(params)) {
    return params;
  }
  if (!('filters' in params)) {
    return params;
  }

  const { filters, ...rest } = params;
  if (filters === undefined || filters === null) {
    return rest;
  }
  if (!isPlainObject(filters)) {
    return rest;
  }

  const out: Record<string, unknown> = { ...rest };

  hoistTypeField(out, filters.type);

  if (out.owner_id === undefined) {
    const owner = filters.owner_id ?? filters.ownerId;
    if (owner !== undefined) {
      out.owner_id = owner;
    }
  }

  for (const key of FILTER_HOIST_KEYS) {
    if (out[key] === undefined && filters[key] !== undefined) {
      out[key] = filters[key];
    }
  }

  return out;
}
