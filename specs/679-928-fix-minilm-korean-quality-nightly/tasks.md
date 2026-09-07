# Tasks: MiniLM Korean quality on Nightly (#928)

**Input**: Design documents from `/specs/679-928-fix-minilm-korean-quality-nightly/`  
**Prerequisites**: plan.md, spec.md (Brainstormed), research.md  

**Tests**: Principle I — contract test first.

## Phase 1: Setup

- [x] T001 Create `progress.yml`; set `.specify/feature.json` → this spec; constitution NO amendment

## Phase 2: Foundational — contract [TDD]

- [x] T002 [TDD] Extend `tests/test-topology-contract.spec.ts` to require nightly YAML contains `RUN_EMBEDDING_QUALITY` and `minilm-korean-quality.spec.ts` (and that `ci.yml` does not)

## Phase 3: User Stories 1–3 — workflow (P1/P2)

- [x] T003 [US3] Add `actions/cache` for `~/.cache/huggingface` on `test-search-quality`
- [x] T004 [US1][US2] Add vitest step with `RUN_EMBEDDING_QUALITY=1` targeting the Korean quality spec; no `continue-on-error`
- [x] T005 [US1] Comment linking #928 / #889

## Phase 4: Polish / gates

- [x] T006 Run `npm test -- tests/test-topology-contract.spec.ts` (GREEN — 10 passed)
- [x] T007 [P] YAML eyeball: timeout 45m, upload-on-failure retained, ONNX skip retained
- [x] T008 [REVIEW] `/speckit.superspec.review` vs FR/SC; simplify check (SC-005) — PASS
- [x] T009 Update `progress.yml` + tasks checkboxes; summary (no commit/push unless asked)

## Dependencies

- T001 → T002 → T003/T004 → T006 → T008
- T005 with T004; T007 [P] with T006

## Parallel opportunities

- T003 and T004 same file sequential; T007 parallel with T006
