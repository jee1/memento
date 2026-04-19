# Issue 187 Design: `npm test` CPU Usage Stabilization

## Context

Issue `#187` identifies a compound test-performance problem rather than a single defect:

1. Root Vitest execution uses `pool: 'forks'` without a worker cap.
2. `MockDatabase` misclassifies `SELECT COUNT(*) as count FROM memory_item_fts`.
3. `SearchEngine` repeatedly re-checks FTS5 and `reflection_notes` availability.
4. Fallback warnings are emitted repeatedly to `stderr`, amplifying CPU and I/O contention during test runs.

The user explicitly chose the broader scope:

- Fix the search/mock-database causes.
- Fix the default root `npm test` execution policy so high-core machines do not default to excessive parallel fork usage.

## Goals

1. Eliminate the false-negative FTS5 availability result caused by the mock database.
2. Remove repeated availability checks inside a single `SearchEngine` instance.
3. Prevent repeated fallback warnings from dominating test output and test overhead.
4. Make root `npm test` use a bounded parallelism policy by default.

## Non-Goals

1. Re-architecting the entire test suite into multiple new command groups.
2. Replacing `forks` with `threads`.
3. Broad logging-system refactoring outside the repeated fallback warning path.
4. Tuning every existing test script independently unless required by the root policy.

## Chosen Approach

### Recommended approach

Use a balanced fix across both the search path and the test runner policy:

1. Correct the `MockDatabase` SQL classification order.
2. Cache FTS5 and `reflection_notes` availability at the `SearchEngine` instance level.
3. Downgrade repeated fallback warnings to `debug` in test environments instead of fully removing them.
4. Keep Vitest `pool: 'forks'`, but cap root file parallelism at `4`.

This approach directly addresses every root cause named in the issue while keeping the design aligned with the repository's current intent:

- `forks` remains in place because it is already documented as necessary for isolation.
- Test behavior becomes quieter and cheaper without hiding diagnostics completely.
- The default root workflow becomes safer instead of relying on callers to remember special flags.

### Rejected alternatives

#### Search-only fix

Fixing only `MockDatabase` and `SearchEngine` would reduce fallback/log churn, but it would not satisfy the selected completion criterion that root `npm test` itself must stop defaulting to excessive parallelism.

#### Test-runner-only fix

Limiting Vitest workers alone would leave the false fallback path and warning spam intact. That would preserve unnecessary overhead and noisy output even for single-file reproduction runs.

#### Full suppression of fallback warnings in tests

Suppressing warnings entirely would reduce observability too aggressively. Debug-level retention gives a better balance: no default spam, but still inspectable when needed.

## 1. Mock Database Fix

File:

- `packages/memento-core/src/test/mock-database.ts`

Change:

- Move the `count(*)` branch ahead of the generic `memory_item_fts` branch in `analyzeQuery()`.

Reason:

- `SELECT COUNT(*) as count FROM memory_item_fts` currently returns FTS rows such as `{ rowid, rank }` instead of `{ count }`.
- That causes `SearchEngine.checkFTS5Availability()` to interpret the table as empty.

Expected result:

- Mocked FTS count queries return the correct shape.
- Search tests stop entering the fallback path for the wrong reason.

## 2. SearchEngine Availability Caching

File:

- `packages/memento-core/src/domains/search/algorithms/search-engine.ts`

Change:

- Add instance-level cached fields for:
  - FTS5 availability
  - `reflection_notes` FTS availability / fallback decision
- `checkFTS5Availability()` computes once per `SearchEngine` instance and returns the cached result on later calls.
- `checkReflectionNotesAvailability()` does the same.

Reason:

- The current implementation repeats DB metadata checks and sample queries for each search call.
- In test loops, that multiplies both SQL overhead and warning/log emission.

Expected result:

- Repeated searches against the same `SearchEngine` instance stop redoing availability work.
- Fallback checks become effectively constant-cost after the first evaluation.

## 3. Fallback Logging Policy

Files:

- `packages/memento-core/src/domains/search/algorithms/search-engine.ts`
- optionally no structural changes to `packages/memento-server/src/server/mcp-logger.ts`

Change:

- Keep actual fallback messages, but emit them at `debug` instead of `warn` when running in a test environment.
- Production/runtime behavior stays warning-oriented where appropriate.

Test-environment detection:

- Prefer an explicit test-aware condition already available in the process environment, such as Vitest presence.
- Keep the condition local to the fallback logging path rather than broadening logger behavior globally.

Reason:

- The issue is repeated warning spam from a known, repeatedly evaluated path.
- Lowering only this path in tests avoids changing unrelated logger semantics.

Expected result:

- Default test runs no longer flood `stderr` with repeated fallback warnings.
- Engineers can still inspect the path with `LOG_LEVEL=debug` if necessary.

## 4. Root Vitest Parallelism Policy

Files:

- `vitest.config.ts`
- optionally `package.json` if the default script needs to make the bounded policy explicit

Change:

- Keep `pool: 'forks'`.
- Add a worker cap of `4` for root test execution.

Reason for `4`:

- The issue targets predictability and CPU containment, not maximum throughput.
- A fixed cap is more reproducible than machine-core-derived logic.
- The repository already uses special handling for sensitive suites, so a conservative global default is consistent with that direction.

Expected result:

- `npm test` no longer scales fork parallelism up to the full machine core count by default.
- High-core local environments stop paying an outsized CPU cost just because more cores exist.

## Error Handling

1. If availability checks fail unexpectedly, preserve the existing fallback-to-safe-search behavior.
2. If the cache is populated with a negative result, repeated searches should continue using the same safe path rather than repeatedly probing.
3. Logging behavior changes must not convert genuine runtime errors into silent failures.

## Testing Strategy

### Unit / regression coverage

1. `MockDatabase` returns `{ count }` for `COUNT(*)` queries against `memory_item_fts`.
2. `SearchEngine` availability checks are cached across repeated search calls within one instance.
3. Fallback warning behavior is reduced in test conditions.

### Execution verification

Primary reproduction target:

- `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts`

Validation goals:

1. Repeated fallback warnings disappear or are reduced to non-default visibility.
2. The issue reproduction path no longer shows the false “FTS5 table empty” behavior caused by the mock.
3. Root `npm test` reflects bounded parallelism by default.

## Risks and Mitigations

### Risk: cache scope becomes stale

Mitigation:

- Cache only at the `SearchEngine` instance level, not globally across process lifetime.
- This keeps the optimization local and avoids surprising cross-test or cross-request state sharing.

### Risk: lowered test logging hides a real regression

Mitigation:

- Lower only repeated fallback warnings in tests.
- Preserve debug visibility and leave non-test behavior intact.

### Risk: worker cap slows some developer workflows

Mitigation:

- The issue requirement prioritizes bounded CPU usage for the default path.
- Developers can still use explicit Vitest CLI overrides for exceptional local experiments.

## Implementation Boundaries

Expected changed areas:

1. `packages/memento-core/src/test/mock-database.ts`
2. `packages/memento-core/src/domains/search/algorithms/search-engine.ts`
3. `vitest.config.ts`
4. related tests only as needed

This should remain a focused issue fix, not a broader suite reorganization.
