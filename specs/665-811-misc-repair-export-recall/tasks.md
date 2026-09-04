# Tasks: misc repair export · 손상 필터 · -32603 (#811)

**Input**: `specs/665-811-misc-repair-export-recall/` (spec.md, plan.md, research.md)
**Prerequisites**: plan.md, spec.md Ready for Planning; brainstorm 3 sessions done
**Tests**: Constitution I — TDD for US1–US3, US5; US4 docs-only
**Execute**: `progress.yml` → `auto_approve_phases: true` (no human phase gates). Prefer `[P][SUBAGENT]` parallelism.

## Format: `[ID] [P?] [Story?] [TDD?] [SUBAGENT?] Description`

---

## Phase 1: Setup

- [x] T001 Verify worktree branch `feature/fix-misc-repair-export-recall-32603` and run `npm run build` so `@memento/core` dist exists (unblocks US1 script import)

---

## Phase 2: Foundational

- [x] T002 [TDD] Add `ToolInputValidationError` class (`name: 'ToolInputValidationError'`) under `packages/memento-core/src/shared/errors/tool-input-validation-error.ts` (or equivalent shared path) with a tiny unit test; export from `packages/memento-core/src/index.ts` if needed for consumers
- [x] T003 [P] [TDD] Extend `packages/memento-server/src/server/utils/mcp-tool-call-error.ts` (+ spec) to map `ToolInputValidationError` / `error.name === 'ToolInputValidationError'` → `-32602 Invalid params` with `data` = message; keep Zod→`-32602`, Unknown tool→`-32601`

**Checkpoint**: Foundation ready — US1/US2/US3/US5 may proceed in parallel

---

## Phase 3: User Story 1 — Repair script export (P1) 🎯

**Goal**: `memory:repair-triple-sentences` imports named exports; smoke prevents regression  
**Independent Test**: build + dry-run / export assert

- [x] T004 [P] [US1] [TDD] [SUBAGENT] Add export smoke test asserting `@memento/core` (or public index) exports `buildTripleSentence` and `hasBrokenTripleConjugation` — e.g. extend `scripts/repair-triple-sentence-memories.spec.ts` or new colocated smoke
- [x] T005 [US1] Confirm `scripts/repair-triple-sentence-memories.ts` runs without named-export SyntaxError after build (dry-run OK on empty/fixture)

---

## Phase 4: User Story 2 — Adaptive corruption filter (P1)

**Goal**: Injection fills `maxMemories` with non-broken content despite high broken ratio  
**Independent Test**: bundle builder spec with mostly-broken fixtures

- [x] T006 [P] [US2] [TDD] [SUBAGENT] RED: extend `knowledge-context-bundle-builder.spec.ts` — many `정의됨합니다` hits + few clean; `maxMemories` filled with clean; prompt has no broken conjugation; `포함합니다` / `함합니다` policy unchanged
- [x] T007 [US2] GREEN: implement adaptive overfetch/early filter in `knowledge-context-bundle-builder.ts` (cap search limit); keep DiD post-filter + warn; all-corrupted → empty bundle without throw

---

## Phase 5: User Story 3 — Validation → -32602 (P1)

**Goal**: type/query validation failures surface as `-32602`  
**Independent Test**: mcp-tool-call-error / dispatch specs

- [x] T008 [P] [US3] [TDD] [SUBAGENT] Wire `recall-tool.ts` to throw `ToolInputValidationError` instead of private `RecallInputValidationError` (or make subclass); update local `isRecallInputValidationError` checks
- [x] T009 [P] [US3] [TDD] [SUBAGENT] Wire `remember-tool.ts` type/validation throws to `ToolInputValidationError`
- [x] T010 [US3] [TDD] Add/adjust server or dispatch test: type-less recall/remember → `-32602` not `-32603`
- [x] T011 [US3] Attempt minimal backtick/`include_score_breakdown` repro; if unreproduced, note in progress.yml residual (non-blocking)

---

## Phase 6: User Story 5 — Hybrid similarity single path (P3)

**Goal**: Score conversion only via `cosineDistanceToSimilarity`  
**Independent Test**: mapper + hybrid query specs

- [x] T012 [P] [US5] [TDD] [SUBAGENT] RED/GREEN: `vector-search-hybrid-query.ts` return distance (not precomputed similarity as contract); `mapHybridResults` uses `cosineDistanceToSimilarity`; update `vector-search.types.ts` + specs/comments (#713/#806)

---

## Phase 7: User Story 4 — Docs (P2)

- [x] T013 [P] [US4] [SUBAGENT] Document diagnostic `auto_set_anchor: false` and injection-without-feedback high_failure caution in `docs/agents/agent-workflow.md` (and brief AGENTS.md §3.1 pointer if appropriate)

---

## Phase 8: Polish & Gates

- [x] T014 Run targeted vitest for touched areas; fix failures
- [x] T015 `npm run lint` && `npm run type-check`
- [x] T016 Rebuild graphify (`python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`) and confirm `graphify-out/GRAPH_REPORT.md` exists
- [x] T017 Update `progress.yml` execute→done; prepare for `/speckit.superspec.review`

---

## Dependencies

- T001 before T005
- T002 before T008/T009; T003 before T010 (T003 may parallel T002 after class exists — sequence T002→T003)
- T006 before T007
- US1 (T004–T005), US2 (T006–T007), US3 (T008–T011), US5 (T012) parallel after Phase 2
- T013 parallel anytime after specify
- T014–T017 after all US tasks

## Parallel opportunities

```text
After T002–T003:
  T004/T005 (US1) ∥ T006/T007 (US2) ∥ T008–T010 (US3) ∥ T012 (US5) ∥ T013 (US4)
```

## Implementation strategy

1. T001–T003 foundational  
2. Launch parallel subagents for US1, US2, US3, US5, US4  
3. T011 residual note  
4. Polish gates → review  

## Notes

- Do not expand `hasBrokenTripleConjugation` to `함합니다`
- Do not delete repair script
- Do not force feedback in hooks
