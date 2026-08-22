# Tasks: Recall metadata wait removal & FTS·vector parallelism (#735)

**Input**: `specs/064-735-perf-recall-metadata-fts-vector/`
**Prerequisites**: spec.md, plan.md
**Branch**: `jee1/perf-recall-metadata-fts-vector`

## Phase 1: Setup

- [x] T001 Write `spec.md` / `plan.md` / `tasks.md` under `specs/064-735-perf-recall-metadata-fts-vector/`

---

## Phase 2: Foundational

- [x] T002 Confirm #736 scope-filter recall tests still green: `npm test -- packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts` (baseline before edits)

---

## Phase 3: User Story 1 - pending meta stats without sleep (P1) 🎯 MVP

**Goal**: 현재 recall의 `meta_stats`가 타이머 없이 응답에 반영되고, 150ms sleep이 사라진다.

**Independent Test**: `recordRecall` 직후 `getStats`/`recall handle`이 fake timer 없이 이번 `recall_count`를 포함한다.

### Tests (fail first)

- [x] T003 [US1] Add no-timer read-your-write test in `packages/memento-core/src/domains/memory/introspection/meta-memory-service.spec.ts` (`recordRecall` then `getStats`/`getStatsById` without 150ms wait)
- [x] T004 [US1] Update `packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts` meta_stats cases: assert `meta_stats` on handle return without sleeping; keep `destroy()` for DB flush if needed

### Implementation

- [x] T005 [US1] Overlay `statsBuffer` onto DB rows in `getStatsById` and `getStats` in `packages/memento-core/src/domains/memory/introspection/meta-memory-service.ts`
- [x] T006 [US1] Remove `setTimeout(..., 150)` from `getMetaStatsForResults` in `packages/memento-core/src/domains/memory/recall/recall-tool-envelope.ts`
- [x] T007 [US1] Run meta-memory + recall-tool targeted tests; confirm no `setTimeout(..., 150)` in envelope

**Checkpoint**: US1 independently testable. Debounce flush tests still pass.

---

## Phase 4: User Story 2 - parallel FTS·vector (P1)

**Goal**: hybrid 두 분기가 동시에 시작되고, delayed mock에서 완료 시간이 max에 가깝다.

**Independent Test**: FTS delay A, vector delay B → elapsed ≈ max(A,B), not A+B.

### Tests (fail first)

- [x] T008 [US2] Add delayed-mock timing test in `packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts` (max-not-sum; ranker receives both branch results)

### Implementation

- [x] T009 [US2] In `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts` `search()`, start `vectorExecutor.execute` first, `Promise.all` with `executeTextSearch`, then existing `combineAndSortResults`
- [x] T010 [US2] Run hybrid-search-engine + consolidation specs

**Checkpoint**: US2 independently testable. Ranker call site unchanged besides input source being awaited in parallel.

---

## Phase 5: User Story 3 - ranking contract (P1)

**Goal**: 순서·`final_score`·`score_breakdown` 불변.

- [x] T011 [US3] Re-run existing hybrid ranking / recall score_breakdown tests (no ranker or `config/ranking-weights.toml` edits)
- [x] T012 [US3] Diff-check: no ranking weight/formula files in the change set

**Checkpoint**: Ranking regression green.

---

## Phase 6: User Story 4 - p95 note (P2)

- [x] T013 [US4] Record before/after recall p95 (local `recall_profile` or #737 `memento_prod` if available) in CHANGELOG Unreleased or `specs/064-735-perf-recall-metadata-fts-vector/p95-note.md`

---

## Phase 7: Polish

- [x] T014 [P] CHANGELOG Unreleased entry for #735
- [x] T015 `npm run lint` && `npm run type-check`
- [x] T016 Targeted tests: meta-memory-service, recall-tool, hybrid-search-engine
- [x] T017 graphify rebuild (`python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`)

---

## Dependencies & Execution Order

- T001 done → T002 baseline → US1 (T003–T007) → US2 (T008–T010) → US3 (T011–T012) → US4 (T013) → Polish
- US1 and US2 touch different files and can be parallel after T002; ranking check (US3) after US2
- Tests MUST fail before the matching implementation task

## Parallel Example

```text
After T002:
  T003+T004 (tests) then T005+T006 (impl)   # US1 files
  T008 (test) then T009 (impl)              # US2 files — parallel with US1
```
