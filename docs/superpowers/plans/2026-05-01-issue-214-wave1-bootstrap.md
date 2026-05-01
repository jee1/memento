# Issue #214 Wave 1 — Core bootstrap split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `packages/memento-core/src/bootstrap.ts` `initializeServices` into named modules under `packages/memento-core/src/bootstrap/` without changing runtime behavior or the `ServerServices` contract.

**Architecture:** Thin `bootstrap.ts` re-exports `ServerServices` and `initializeServices`; helper modules own vertical slices (anchors, failure/reflexion, monitoring/WAL/lock, write path, batch/telemetry/relation/sleep, runtime diagnostics sampler). No new package-level imports for consumers.

**Tech Stack:** TypeScript 5.x, Node ≥20, Vitest, existing `@memento/core` patterns (`.js` import suffixes in TS sources).

**Note:** This is a behavior-preserving refactor. Verification is the **existing** test suite (`npm test`), not greenfield TDD with new failing tests.

---

## File map (target end state)

| Path | Responsibility |
|------|------------------|
| `packages/memento-core/src/bootstrap.ts` | `ServerServices`, `initializeServices` orchestration only; re-import from `bootstrap/*.js` |
| `packages/memento-core/src/bootstrap/search-and-embedding.ts` | `SearchEngine`, embedding pair, `HybridSearchFactory.createDefaultEngine`, `ForgettingPolicyService`, `DatabaseOptimizer` construction |
| `packages/memento-core/src/bootstrap/anchor-stack.ts` | `AnchorCacheService`, `AnchorSearchService`, `AnchorManager`, `getVectorSearchEngine`, `restoreCacheFromDB` |
| `packages/memento-core/src/bootstrap/failure-reflexion.ts` | `AsyncTaskQueue`, `FailureDetector.startQueue`, `ReflexionWorker` start |
| `packages/memento-core/src/bootstrap/monitoring-schedulers.ts` | `getPerformanceMonitor().initialize`, `RuntimeDiagnosticsLogger`, `WalCheckpointScheduler`, `DatabaseLockMonitor`, conditional `start()` + log lines |
| `packages/memento-core/src/bootstrap/write-and-meta.ts` | `WriteCoalescingManager` flush callback body (unchanged logic), optional `ConsolidationScoreService`, `MetaMemoryService` |
| `packages/memento-core/src/bootstrap/batch-telemetry-relation.ts` | `IntrospectionScanCache`, `TelemetryRepository`, `getBatchScheduler()` wiring, `TelemetryService`, `createRelationGraph`, `SleepConsolidationService`, conditional `batchScheduler.start` |
| `packages/memento-core/src/bootstrap/runtime-diagnostics-sampler.ts` | Entire `diagnosticsEnabled` block (lines 218–307 in pre-refactor `bootstrap.ts`): timer, in-flight promise, `writeSample`, cleanup function |

Exact filenames may be shortened (for example `write-path.ts`) as long as each file has one responsibility; merge two modules if a circular import appears.

---

### Task 1: Scaffold `bootstrap/` and move search/embedding/optimizer slice

**Files:**

- Create: `packages/memento-core/src/bootstrap/search-and-embedding.ts`
- Modify: `packages/memento-core/src/bootstrap.ts`

- [ ] **Step 1:** Add `search-and-embedding.ts` with a function such as `createSearchEmbeddingAndOptimizerServices(db: Database.Database)` returning `{ searchEngine, embeddingService, queryEmbeddingService, hybridSearchEngine, forgettingPolicyService, databaseOptimizer }` using the same constructors and comments as current `bootstrap.ts` lines 80–86.
- [ ] **Step 2:** In `bootstrap.ts`, remove duplicated lines 80–86 and call the new function; preserve variable names used downstream.
- [ ] **Step 3:** Run `npm run type-check` — expect PASS.
- [ ] **Step 4:** Run `npm test` — expect PASS.
- [ ] **Step 5:** Commit

```bash
git add packages/memento-core/src/bootstrap.ts packages/memento-core/src/bootstrap/search-and-embedding.ts
git commit -m "refactor(core): extract search/embedding bootstrap slice (#214)"
```

---

### Task 2: Extract anchor stack

**Files:**

- Create: `packages/memento-core/src/bootstrap/anchor-stack.ts`
- Modify: `packages/memento-core/src/bootstrap.ts`

- [ ] **Step 1:** Add `createAnchorStack(db, embeddingService, hybridSearchEngine, errorLoggingService)` returning `{ vectorSearchEngine, anchorCacheService, anchorSearchService, anchorManager }` matching lines 89–100; keep `await anchorCacheService.restoreCacheFromDB(db)` in the same relative order as today (inside helper or immediately after the call).
- [ ] **Step 2:** Replace inlined anchor block in `bootstrap.ts`.
- [ ] **Step 3:** `npm run type-check` then `npm test` — PASS.
- [ ] **Step 4:** Commit `refactor(core): extract anchor bootstrap stack (#214)`

---

### Task 3: Extract failure detector + reflexion worker

**Files:**

- Create: `packages/memento-core/src/bootstrap/failure-reflexion.ts`
- Modify: `packages/memento-core/src/bootstrap.ts`

- [ ] **Step 1:** Move lines 101–105 logic into `startFailureAndReflexion(db)` returning `{ failureDetector, reflexionWorker }`.
- [ ] **Step 2:** Wire from `initializeServices`.
- [ ] **Step 3:** `npm run type-check` and `npm test` — PASS.
- [ ] **Step 4:** Commit `refactor(core): extract failure/reflexion bootstrap (#214)`

---

### Task 4: Extract monitoring + WAL + lock monitors

**Files:**

- Create: `packages/memento-core/src/bootstrap/monitoring-schedulers.ts`
- Modify: `packages/memento-core/src/bootstrap.ts`

- [ ] **Step 1:** Move construction of `performanceMonitor`, `runtimeDiagnosticsLogger`, `bootstrap_start` event, `walCheckpointScheduler`, `databaseLockMonitor`, and the two `if (mementoConfig...)` start blocks into one function taking `db` and returning `{ performanceMonitor, runtimeDiagnosticsLogger, walCheckpointScheduler, databaseLockMonitor }`.
- [ ] **Step 2:** Verify log strings unchanged (`WAL 체크포인트`, `데이터베이스 락 모니터`).
- [ ] **Step 3:** `npm run type-check` and `npm test` — PASS.
- [ ] **Step 4:** Commit `refactor(core): extract monitoring and WAL/lock bootstrap (#214)`

---

### Task 5: Extract write coalescing, consolidation score, meta memory

**Files:**

- Create: `packages/memento-core/src/bootstrap/write-and-meta.ts`
- Modify: `packages/memento-core/src/bootstrap.ts`

- [ ] **Step 1:** Move `WriteCoalescingManager` instantiation and its flush callback verbatim (including `mementoConfig.consolidationScoreEnabled` branches and SQL update loop).
- [ ] **Step 2:** Move `consolidationScoreService` conditional and `MetaMemoryService` plus log line `MetaMemoryService 초기화 완료`.
- [ ] **Step 3:** `npm run type-check` and `npm test` — PASS.
- [ ] **Step 4:** Commit `refactor(core): extract write coalescing and meta memory bootstrap (#214)`

---

### Task 6: Extract batch scheduler, telemetry, relation graph, sleep consolidation

**Files:**

- Create: `packages/memento-core/src/bootstrap/batch-telemetry-relation.ts`
- Modify: `packages/memento-core/src/bootstrap.ts`

- [ ] **Step 1:** Move lines 201–217 into a function that accepts `db`, `embeddingService`, `runtimeDiagnosticsLogger`, `reflexionWorker` and returns `{ introspectionScanCache, telemetryRepository, batchScheduler, telemetryService, relationGraph, sleepConsolidationService }`, preserving `getBatchScheduler()` and setter call order.
- [ ] **Step 2:** `npm run type-check` and `npm test` — PASS.
- [ ] **Step 3:** Commit `refactor(core): extract batch/telemetry/relation bootstrap (#214)`

---

### Task 7: Extract runtime diagnostics sampler

**Files:**

- Create: `packages/memento-core/src/bootstrap/runtime-diagnostics-sampler.ts`
- Modify: `packages/memento-core/src/bootstrap.ts`

- [ ] **Step 1:** Move the full `if (mementoConfig.diagnosticsEnabled) { ... }` block into `createRuntimeDiagnosticsSampler({ mementoConfig, batchScheduler, runtimeDiagnosticsLogger })` returning `{ runtimeDiagnosticsSamplerCleanup } | undefined`.
- [ ] **Step 2:** Ensure `unref`, in-flight await, and `scheduleRuntimeDiagnosticsSampler` recursion match pre-refactor behavior.
- [ ] **Step 3:** `npm run type-check` and `npm test` — PASS.
- [ ] **Step 4:** Commit `refactor(core): extract runtime diagnostics sampler (#214)`

---

### Task 8: Final cleanup and quality gate

**Files:**

- Modify: `packages/memento-core/src/bootstrap.ts` (imports only, ensure no dead imports)

- [ ] **Step 1:** `npm run lint` — fix unused imports or order issues.
- [ ] **Step 2:** `npm run type-check` and `npm test` — PASS.
- [ ] **Step 3:** Confirm `packages/memento-core/src/index.ts` still imports `./bootstrap.js` and exports unchanged.
- [ ] **Step 4:** No code change expected in `packages/memento-server/src/server/bootstrap.ts`.
- [ ] **Step 5:** Final commit only if cleanup remains.

```bash
git add packages/memento-core/src/bootstrap.ts
git commit -m "refactor(core): tidy bootstrap imports after split (#214)"
```

---

## Plan self-review

| Spec section (#214 design) | Tasks covering it |
|----------------------------|-------------------|
| `bootstrap/` modules, thin orchestrator | Tasks 1–7 |
| No behavior/API change | Each task: verbatim move + full suite |
| Server bootstrap unchanged | Task 8 note |
| Lint/type/test | Task 8 |

Placeholder scan: none.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-05-01-issue-214-wave1-bootstrap.md`.

1. **Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks.
2. **Inline Execution** — Execute tasks in this session using executing-plans with checkpoints.

Which approach?
