# Contract: MCP / search tool schema unchanged (#807)

**Feature**: `specs/660-807-fts-or-prefix`  
**Status**: Binding — FR-018 / SC-008 / Q9

## Guarantee

This feature **MUST NOT** change:

- MCP tool names exposed by default toolset  
- `recall` / `remember` / `memory_injection` / `feedback` (and other registered tools) **JSON Schema** for arguments or structured result envelopes  
- HTTP admin search request/response **shape** (field names/types), aside from result **ordering/membership** improving with better text candidates  

## Allowed change

- Which memory IDs appear in results / ranking order for the same query string  
- Internal FTS `MATCH` string construction  
- Documentation of combinator semantics (`docs/agents/search-ranking.md`)

## Verification

- Schema snapshot / contract tests already used in the repo (if any) show **0 breaking shape diffs** attributable to this change (SC-008)  
- Manual: `tools/list` / tool descriptors unchanged in review diff
