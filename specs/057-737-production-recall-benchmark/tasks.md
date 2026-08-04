# Tasks: Production Recall Benchmark (#737)

## Phase 1 — Spec alignment
- [x] T001 Write `spec.md` / `plan.md` / `tasks.md` under `specs/057-737-production-recall-benchmark/`

## Phase 2 — Rename synthetic baseline
- [x] T002 Rename `BaselineName` `memento` → `rrf_sim` in `scripts/agent-memory-benchmark.ts`
- [x] T003 Update `scripts/agent-memory-benchmark.spec.ts` (+ adapter specs if keyed) for `rrf_sim`

## Phase 3 — Production adapter
- [x] T004 Add `scripts/agent-memory-production-adapter.ts` (temp DB, fixed-id import, embed, HybridSearch)
- [x] T005 Add `scripts/agent-memory-production-adapter.spec.ts` (import + search spy + ranked IDs)

## Phase 4 — Scorecard & gates
- [x] T006 Add scorecard builder + `gates.production_vs_fts` + failed_queries / abstention
- [x] T007 Wire `--production` / `--scorecard-out` CLI; async main path
- [x] T008 Unit-test gate + scorecard fields

## Phase 5 — Packaging & docs
- [x] T009 Update `package.json` scripts; `CHANGELOG.md` Unreleased
- [x] T010 Fixture README note; graphify rebuild
- [x] T011 Run `quality:agent-memory:test`, type-check, lint
