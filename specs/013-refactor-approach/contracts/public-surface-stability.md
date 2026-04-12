# Contract: Public surface stability (first wave)

**Purpose**: Align refactoring work with **Constitution II** (backward compatibility for public contracts).

## MCP tools

- **Expectation**: Tool names, request/response shapes, and **observable semantics** for **`remember`**, **`recall`**, **`feedback`**, **`forget`**, **`pin`**, **`unpin`**, **`memory_injection`**, **`get_memory_neighbors`**, **`set_anchor`**, **`get_anchor`**, **`search_local`**, **`clear_anchor`**, **`procedural_diff`**, **`procedural_rollback`**, **`remember_procedure`**, **`get_introspection_summary`**, **`get_telemetry_summary`** remain **backward compatible** for this program.
- **Allowed**: Internal refactors, clearer code paths, non-observable performance (not a program goal), bugfixes that **restore** specified behavior.

## HTTP administrative API

- **Expectation**: Existing **admin** endpoints remain **authenticated and behaviorally equivalent** unless a change is **explicitly** tracked outside this program (security incidents, separate approved change).
- **Allowed**: Route **registration** restructuring, clearer module ownership (FR-003), **no** capability disappearance or move to unauthenticated paths (per user stories).

## Database

- **First wave**: **No** schema migrations or on-disk format changes (FR-009). Any future change requires migrations + types + docs per Constitution III.

## Versioning

- Library/server **semver** bumps follow normal release process; this program does **not** imply a major version bump **by itself** if public contracts stay compatible.
