# Issue 278 Vector Search Failure Design

## Context

- Issue: `#278` reports repeated server error logs: `벡터 검색 실패`.
- Symptom: production log monitor repeatedly captures the same fingerprinted failure.
- Current behavior: `VectorSearchRepositoryImpl.search` and `hybridSearch` log an error and return an empty list on failure.
- Constraint: preserve existing external behavior (empty results on internal vector failure) while removing repeated runtime SQL failures in normal conditions.

## Goal

Eliminate recurring vector-search runtime failures in normal operation by aligning vector availability checks and runtime execution rules (provider, dimensions, table mapping), and by making failure classes diagnosable.

## Non-Goals

- Changing public API contract for search tools.
- Broad operational policy changes unrelated to vector search execution path.
- Unrelated refactors in memory, admin, or relation domains.

## Design Overview

### 1) Align preflight and runtime vector rules

Unify the rules used in `checkVecAvailability()` with the rules used in `search()` and `hybridSearch()`:

- Same provider resolution (`undefined` provider defaults to `tfidf`).
- Same dimension basis from `providerDimensions`.
- Same table selection path via `getTableName(provider, dimensions)`.

This prevents "preflight says available, runtime fails" mismatches.

### 2) Keep and tighten dimension boundary handling

Retain current flow:

- Resolve expected dimensions from provider.
- For `tfidf` only, allow dominant stored-dimensions fallback for 384/512 legacy split.
- Align query vector to target dimensions with `alignQueryVectorToStoredDimensions`.
- Refuse SQL execution when alignment fails.

No contract change to caller: return `[]` for non-actionable internal mismatch.

### 3) Classify internal failures for diagnostics

Introduce structured failure categories for logs:

- `VEC_UNAVAILABLE`
- `VECTOR_DIMENSION_MISMATCH`
- `VECTOR_SQL_EXECUTION_FAILED`

Each log includes provider, table, expected/target/actual dimensions, and error message when present.

## Data Flow

1. Normalize provider (`provider ?? 'tfidf'`).
2. Compute expected dimensions from provider config.
3. Optionally compute dominant stored dimensions (`tfidf` only).
4. Derive target dimensions.
5. Align query vector to target dimensions.
6. Resolve table with `getTableName(provider, targetDimensions)`.
7. Execute vector SQL query.
8. Normalize and return results, or return `[]` with categorized diagnostics.

## Error Handling Policy

- Keep return-shape compatibility: failed vector search returns `[]`.
- Distinguish internal root causes in logs.
- Maintain `warn` for detectable data-quality signals (stored-dimension divergence).
- Keep `error` only for true runtime failures in execution path.

## Test Plan

### Unit tests (`vector-search.repository.spec.ts`)

- Availability checks validate provider/table/dimension combinations consistently.
- Undefined provider path defaults to `tfidf`.
- `tfidf` legacy 384/512 branch selects the correct table.
- Vector alignment success and rejection cases.
- SQL execution failure path emits categorized diagnostics and returns `[]`.
- Availability failure path emits `VEC_UNAVAILABLE` diagnostics.

### Regression checks

- Existing successful hybrid/vector search scenarios keep passing.
- No spurious `벡터 검색 실패` errors in normal passing test runs.

## Implementation Notes

- `checkVecAvailability()` resolves the same runtime table as `search`/`hybridSearch` and confirms it is registered in `sqlite_master` before running the vec probe query, which avoids naive mocks (and phantom availability) drifting from real SQLite behavior.
- Failure logs attach `category` (`VEC_UNAVAILABLE`, `VECTOR_DIMENSION_MISMATCH`, `VECTOR_SQL_EXECUTION_FAILED`) with provider/table/dimension context.
- Task 3 verification: repository spec suite, entire `packages/memento-core/src/domains/search` Vitest subtree, plus `npm run lint` and `npm run type-check`; `vector-search-engine.spec.ts` mocks were aligned with sqlite_master-bound registration checks.

## Rollout Plan

1. Implement alignment and categorized diagnostics in repository.
2. Add/update tests first for failing-path classification and preflight/runtime consistency.
3. Run `npm test`, `npm run lint`, `npm run type-check` in worktree.
4. Validate issue-oriented reproduction path if production-like dataset is available.

## Risks and Mitigations

- Risk: hidden dataset-specific corruption still causes SQL errors.
  - Mitigation: preserve detailed categorized logs for targeted follow-up migration.
- Risk: over-broad log level changes hide actionable failures.
  - Mitigation: only classify and enrich, not silence true execution errors.

## Acceptance Criteria

- Vector preflight and runtime table/dimension decisions are consistent.
- Runtime vector SQL failures are no longer repeatedly triggered in normal paths.
- Diagnostics are sufficient to identify provider/table/dimension root cause from a single log event.
- Test suite covers success, mismatch, and SQL-failure branches.
