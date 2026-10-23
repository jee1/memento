/**
 * Tools where owner_id filters whose memories are read (Issue #1452).
 * Shared single source of truth between HTTP owner scope middleware and tool dispatch boundary.
 */
export const OWNER_FILTER_TOOLS: ReadonlySet<string> = new Set([
  'recall',
  'memory_injection',
  'export_memories'
]);
