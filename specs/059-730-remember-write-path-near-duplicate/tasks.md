# Tasks: remember write-path near-duplicate (#730)

**Input**: `specs/059-730-remember-write-path-near-duplicate/`
**Prerequisites**: spec.md, plan.md
**Branch**: `jee1/feat-memory-remember-write-path-near-duplicate`

## Format

- **[P]**: parallel-safe (different files)
- **[USn]**: maps to spec user story

---

## Phase 1: Foundational (config)

**Purpose**: env knobs before behavior changes

- [X] T001 [P] Add `MEMENTO_REMEMBER_DEDUP_THRESHOLD` / `MEMENTO_REMEMBER_DEDUP_MODE` parsing in `packages/memento-core/src/shared/config/` (defaults 0.85 / `warn`; invalid → default + stderr warn per AGENTS Security Check pattern)
- [X] T002 [P] Unit-test config parser (valid/invalid/default) under `packages/memento-core/src/shared/config/` `__tests__` or existing config spec

**Checkpoint**: config readable from `mementoConfig` (또는 동등 export)

---

## Phase 2: User Story 1 — warn + candidates (P1) 🎯 MVP

**Goal**: pre-insert near-dup search; warn mode INSERT + rich `similarity_warning`
**Independent Test**: mock vector — identical/similar warn; dissimilar silent; cross project/owner silent

- [X] T003 [US1] Add failing tests in `packages/memento-core/src/domains/memory/tools/__tests__/remember-near-duplicate.spec.ts` (또는 `remember-tool.spec.ts`): identical, similar, dissimilar, project_id isolation, owner_id isolation, **working-type warn**, fail-open on search error
- [X] T004 [US1] Extract/evolve candidate finder from `buildSimilarityWarning` in `remember-tool-memory-item.ts` → optional `remember-near-duplicate.ts`; filter type+owner+project+!deleted; threshold from config; return `{ id, similarity }[]`
- [X] T005 [US1] Wire pre-insert search in `handleMemoryItem` / persist path for mode=`warn`: INSERT then attach `similarity_warning` with `count`, `similar_ids`, `candidates`, `suggestion:'incremental'`, `action:'warned'`
- [X] T006 [US1] Remove obsolete post-insert-only self-filter path once pre-insert is sole path; keep fail-open try/catch
- [X] T007 [US1] Make T003 green

**Checkpoint**: US1 independently verifiable

---

## Phase 3: User Story 2 — env modes (P1)

**Goal**: threshold + `strict` / `off`
**Independent Test**: threshold filters candidates; strict no INSERT; off skips search

- [X] T008 [US2] Failing tests: high threshold suppresses warn; `strict` rejects with candidates and zero new rows; `off` no warning
- [X] T009 [US2] Implement `strict` branch (no INSERT) using existing ToolResult error conventions; include candidates in payload
- [X] T010 [US2] Implement `off` short-circuit (no embedding/vector call)
- [X] T011 [US2] Make T008 green

**Checkpoint**: US2 independently verifiable

---

## Phase 4: User Story 3 — incremental merge (P2)

**Goal**: working/episodic/semantic `update_mode=incremental` UPDATEs top candidate (procedural match first)
**Independent Test**: row count unchanged; content/importance/tags/num_times per spec Assumptions §6; procedural hit skips near-dup merge

- [X] T012 [US3] Failing tests: incremental merges into top candidate (working/episodic/semantic); no candidate → INSERT; procedural existing incremental still passes; **procedural hit면 near-dup merge 미호출**
- [X] T013 [US3] Implement near-dup UPDATE when `update_mode=incremental` && candidates[0] && type ∈ {working,episodic,semantic}; branch order per plan Assumptions §9 (procedural match first → near-dup incremental → strict → warn INSERT); set `action:'merged'`; reuse id in success result
- [X] T014 [US3] Telemetry/outbox: memory_id·content_hash 일관 (event type은 기존 remember 경로 재사용 OK; 신규 event 필수는 아님)
- [X] T015 [US3] Make T012 green

**Checkpoint**: US3 independently verifiable

---

## Phase 5: User Story 4 — agent docs (P2)

**Goal**: warn→incremental habit + env table

- [X] T016 [P] [US4] Document env + response fields + recommended loop in `docs/agents/agent-workflow.md` (and env row in `docs/agents/commands.md`)
- [X] T017 [P] [US4] CHANGELOG Unreleased entry for #730

**Checkpoint**: docs reviewable without code

---

## Phase 6: Polish & gates

- [X] T018 Run targeted vitest for remember/near-duplicate + procedural regression (note: ranking `duplication_penalty` / weights 미변경)
- [X] T019 `npm run lint` && `npm run type-check` && `npm test` (worktree; 실패 시 완료 선언 금지)
- [X] T020 Rebuild graphify: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
- [X] T021 Mark spec Status → Implemented when PR-ready; link issue #730 in PR body

---

## Dependencies

```text
T001/T002 → T003–T007 (US1) → T008–T011 (US2) → T012–T015 (US3)
T016/T017 parallel after US1 (can draft docs earlier)
T018–T021 after behavior complete
```

## MVP scope

Ship **Phase 1–3** (warn + env/strict) as minimum PR if incremental needs split; prefer single PR for #730 if tests stay green.

## Parallel opportunities

- T001 ‖ T002
- T016 ‖ T017
- After T004 API stable, docs can draft against FR-007 shape
