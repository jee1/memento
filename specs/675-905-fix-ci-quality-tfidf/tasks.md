# Tasks: #905 Nightly quality provider / CI red

**Input**: `specs/675-905-fix-ci-quality-tfidf/`  
**Prerequisites**: plan.md (required), spec.md

## Phase 1: Setup

- [x] T001 Confirm constitution NO amendment; update `progress.yml` + `.specify/feature.json`

## Phase 2: Foundational

- [x] T002 [TDD] Export/resolve benchmark vector provider helper in `benchmark.types.ts`
- [x] T003 [P] [TDD] Update `scripts/__tests__/benchmark-search-database.spec.ts` (tfidf path; vitest mocks onnx so minilm covered by standalone smoke + Nightly)
- [x] T004 [P] [TDD] Header formatter + resolver tests in `quality-benchmark-category-report.spec.ts`

## Phase 3: User Story 1 — Nightly can load core (P1)

- [x] T005 [US1] Add `npm run build -w @memento/core` before category-report
- [x] T006 [US1] [P] `EMBEDDING_PROVIDER: minilm` + fixture vs `DB_PATH` comment

## Phase 4: User Story 2+3 — Header + provider alignment (P1)

- [x] T007 [US3] Seed with resolved provider; fail-closed; drop mock companion
- [x] T008 [US3] Aggregator + compare-weight-profiles use `getBenchmarkVectorProviderFilter`
- [x] T009 [US2] Report header; fix misleading comment
- [x] T010 Rebuild core; targeted vitest green; tfidf full category-report exit 0; minilm 1-row smoke dims=384

## Phase 5: Polish

- [x] T011 [REVIEW] checklist-review + specialist review
- [x] T012 graphify rebuild; summary (no commit/push)
