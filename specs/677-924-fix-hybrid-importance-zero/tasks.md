# Tasks: Fix hybrid ranker importance 0 (#924)

**Input**: [plan.md](./plan.md) · [spec.md](./spec.md)  
**Branch**: `feature/hybrid-importance-0-0.5`

## Phase 1: Setup

- [x] T001 Verify bug line `importance: result.importance || 0.5` in `hybrid-result-ranker.ts` and confirm no other search-domain `|| 0.5` on importance for this path

## Phase 2: Foundational / TDD (US1+US2)

- [x] T002 [TDD] Add regression: equal signals → finalScore(0) < finalScore(0.1) < finalScore(0.5); importance breakdown for 0 ≠ default 0.5 — `hybrid-result-ranker.spec.ts`
- [x] T003 [TDD] Add regression: undefined/null importance scores equal to explicit 0.5 — `hybrid-result-ranker.spec.ts`
- [x] T004 [TDD] Run ranker spec RED (expect T002 fail before fix)

## Phase 3: Implementation (US1)

- [x] T005 Change `|| 0.5` to `?? 0.5` in `buildBaseFeatures` — `hybrid-result-ranker.ts`
- [x] T006 Run ranker spec GREEN; keep existing 0.95 vs 0.5 / relevance-slot tests green

## Phase 4: Polish & Gates

- [x] T007 [P] `npm run type-check`
- [x] T008 [P] Domain test command: `npm test -- packages/memento-core/src/domains/search/algorithms/hybrid-result-ranker.spec.ts`
- [x] T009 Rebuild graphify after code change
- [x] T010 [REVIEW] simplify + superspec.review against FR-001..005 / SC-001..004

## Dependencies

T001 → T002/T003 → T004 → T005 → T006 → T007/T008/T009 → T010

## Checkpoint

After T010 PASS: summary report; commit/PR only on explicit user request.
Label note: PR 시 `tech-debt-approved` 추가·`tech-debt-pending` 제거.
