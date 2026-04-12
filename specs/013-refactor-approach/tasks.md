---

description: "Task list for 013-refactor-approach — production maintainability refactoring program"
---

# Tasks: Production Maintainability Refactoring Approach

**Input**: Design documents under `specs/013-refactor-approach/` (paths below are relative to the repository root).  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Spec **FR-024** — adding or extending automated tests is **not** a program-level merge gate; tasks below reference **existing** CI and **manual** regression where **FR-013** applies.

**Constitution Principle I note**: Pure structural refactoring is **formally exempt** from Red-Green-Refactor per `constitution.md` v1.1.0 "Structural refactoring exception" (amended 2026-04-13; see `plan.md` constitution check). If any increment is later found to introduce new behavior or fix a defect rather than being purely structural reorganization, it **MUST** follow Red-Green-Refactor (write failing tests first) per Constitution Principle I. Resolve doubt conservatively — apply Principle I unless the increment is clearly documentation-only or type-only.

**Organization**: Phases follow **User Stories 1–3** (P1–P3 from `spec.md`). An additional phase covers **FR-014** capability areas not mapped to those stories (scheduled background, relationship extraction, embedding pipeline).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no blocking dependencies on incomplete tasks in the same phase)
- **[Story]**: `[US1]`–`[US3]` for user-story phases only
- Every task includes at least one **repository-relative file path**

## Path Conventions (this monorepo)

- Core: `packages/memento-core/src/`
- Server: `packages/memento-server/src/`
- Program docs: `specs/013-refactor-approach/`

---

## Phase 1: Setup (program alignment)

**Purpose**: Confirm authoritative program entries and doc consistency before code refactors.

- [x] T001 Verify integration line (`main`), paths to `maintainer-map.md` and `manual-regression-checklist.md`, and FR-023/FR-016 pointers in `specs/013-refactor-approach/plan.md` match `specs/013-refactor-approach/spec.md` expectations; also confirm `specs/013-refactor-approach/contracts/merge-gates.md` is consistent with spec.md FR-013/FR-026/FR-019, and `contracts/public-surface-stability.md` is consistent with Constitution II (backward compatibility for MCP tools and admin HTTP)
- [x] T002 [P] Align scenario commands and quality-gate commands in `specs/013-refactor-approach/quickstart.md` with `package.json` scripts (`npm test`, `npm run test:search`, etc.)
- [x] T003 [P] In `specs/013-refactor-approach/research.md` §3, verify that the SC-002 N/σ section **explicitly cites the expected canonical path** `specs/013-refactor-approach/maintainer-map.md` as the location where the N value and measurement notes will be recorded (FR-016 forward reference). **Note**: `maintainer-map.md` does not yet exist at this phase — the goal here is only to confirm `research.md` points to the correct future path, not to verify two-way links. The reverse link (from `maintainer-map.md` back to `research.md`) is a sub-step of T005 (Phase 2).

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Authoritative **manual regression checklist** and **maintainer map** skeleton so every later increment can cite the same gates and boundaries (FR-020, FR-007, FR-017). **No user-story refactor should merge before T004–T005 are usable.**

**⚠️ CRITICAL**: User Story work (Phases 3–5) and FR-014 coverage (Phase 6) assume this phase’s artifacts are in place.

- [x] T004 Author the full operational text of `specs/013-refactor-approach/manual-regression-checklist.md` (memory recall via MCP/agent flows, hybrid search scenarios, administrative HTTP routes, and pointers to `npm run lint` / `npm run type-check` / `npm test` from repo root)
- [x] T005 Populate `specs/013-refactor-approach/maintainer-map.md` with all **six** capability area boundaries, directory pointers (`packages/memento-core/src/domains/memory/`, `packages/memento-core/src/domains/search/`, `packages/memento-core/src/infrastructure/scheduler/`, `packages/memento-core/src/domains/relation/`, `packages/memento-server/src/server/routes/`, `packages/memento-core/src/domains/embedding/`), an **increment map** table template, and SC-002 operational notes per `specs/013-refactor-approach/research.md`. Document **FR-015** with an explicit sentence: "Heuristic or static quality scores (e.g. complexity, deficit-style metrics) MAY inform prioritization and code review but are NOT mandatory merge gates for this program unless a separate engineering policy mandates them." **Additionally (FR-016 pre-condition — fixes parameters that T029 will consume)**: verify that `specs/013-refactor-approach/research.md` already contains — or add to it — (a) defect classification labels/query rules for "recall/search–related" and (b) baseline comparison window definition. Separately, fix (c) the **N** value (or equivalent threshold rule) for "statistically meaningful worsening" in **`specs/013-refactor-approach/maintainer-map.md`** under a "SC-002 measurement" section (per `spec.md` Measurement procedures — SC-002 step 5; `research.md` §3 also confirms N belongs in `maintainer-map.md`). If any of (a)–(b) are absent from `research.md`, add them before closing this task; if (c) is absent from `maintainer-map.md`, add it. These parameters MUST be fixed at this point so that T029 can apply them consistently. *(Note: research.md is a Phase 0 artifact; this task retroactively adds SC-002 parameters as FR-016 requires.)*
- [x] T006 Run baseline quality gates from the repository root using scripts in `package.json`: `npm run lint`, `npm run type-check`, `npm test` (constitution + FR-013 CI). **Also verify no new migration files were introduced** during Phase 1 setup (FR-009): `git diff main -- packages/memento-core/src/infrastructure/database/migrations/` should show no new files. Record result.

**Checkpoint**: Checklist and maintainer map are ready; CI baseline green.

---

## Phase 3: User Story 1 — Maintainer locates recall behavior quickly (Priority: P1) 🎯 MVP

**Goal**: Refactor and document **agent memory recall** so maintainers can find filters, ranking options, and anchors without spelunking unrelated code (see `spec.md` User Story 1).

**Independent Test**: A newcomer follows `maintainer-map.md` only, names the owning area for recall-specific behavior, and can describe a mock “add one filter option” touch list without opening unrelated subsystems.

### Implementation for User Story 1

- [x] T007 [US1] Refactor recall MCP orchestration for maintainability in `packages/memento-core/src/domains/memory/tools/recall-tool.ts` and directly related recall helpers under `packages/memento-core/src/domains/memory/` (reduce nesting, extract cohesive units, replace unsafe `any` at boundaries where applicable) while preserving behavioral parity
- [x] T008 [US1] Update the **memory recall** section of `specs/013-refactor-approach/maintainer-map.md` with concrete file anchors (e.g. `recall-tool.ts`, neighbor/anchor services) and the increment row for this merge
- [x] T009 [US1] Add FR-011 **operational touchpoints** summary for this increment (logs/metrics/alerts or explicit “none”) in PR body and/or `specs/013-refactor-approach/maintainer-map.md`
- [x] T010 [US1] Satisfy FR-013 for this increment: run `specs/013-refactor-approach/manual-regression-checklist.md` sections covering **memory recall** (and full CI: `npm run lint`, `npm run type-check`, `npm test`) before merge to integration line `main`

**Checkpoint**: Recall path is documented and shippable with parity evidence.

---

## Phase 4: User Story 2 — Security reviewer can assess admin surface efficiently (Priority: P2)

**Goal**: Restructure **administrative HTTP** registration so reviewers can walk a structured outline without one monolithic block (FR-003, `spec.md` User Story 2).

**Independent Test**: Time-boxed **60 minutes** admin review session using `maintainer-map.md` outline (SC-003); all admin capabilities mapped with auth expectations.

### Implementation for User Story 2

- [x] T011 [US2] Modularize administrative route registration in `packages/memento-server/src/server/routes/admin.routes.ts` into cohesive submodules under `packages/memento-server/src/server/routes/` (preserve `/admin` mount and `createAdminAuthMiddleware` behavior in `packages/memento-server/src/server/http-server.ts`)
- [x] T012 [US2] Extend `specs/013-refactor-approach/maintainer-map.md` with a **structured administrative HTTP** outline (route group → capability → authorization expectations) aligned with refactored modules
- [x] T013 [US2] Add FR-011 operational touchpoints for admin HTTP increment in PR notes and/or `specs/013-refactor-approach/maintainer-map.md`
- [x] T014 [US2] Satisfy FR-013: run full `npm test` from repo root as the primary CI gate. If `packages/memento-server/src/server/routes/admin.routes.spec.ts` was created as part of T011 (as the modularization may warrant a new spec file), also run `npx vitest run packages/memento-server/src/server/routes/admin.routes.spec.ts` explicitly — but **do not assume this file pre-exists**; if T011 did not create it, `npm test` alone satisfies this gate. Execute `specs/013-refactor-approach/manual-regression-checklist.md` **administrative HTTP** sections, and full CI before merge. For **SC-003**, follow **`specs/013-refactor-approach/spec.md`** → **Measurement procedures — SC-003**: run a **time-boxed (≤60 minutes)** review session using the structured admin outline in `specs/013-refactor-approach/maintainer-map.md`; record **actual duration**, **pass/fail** against the time box, and reviewer notes (same PR or maintainer-map appendix)

**Checkpoint**: Admin surface remains authenticated and behaviorally equivalent; review outline supports SC-003.

---

## Phase 5: User Story 3 — Contributor extends search without duplicating logic (Priority: P3)

**Goal**: Clarify **hybrid search** boundaries so ranking, provider execution, and result merging are not copy-pasted across layers (`spec.md` User Story 3).

**Independent Test**: Contributor explains where ranking composition vs provider execution vs merging lives using `maintainer-map.md` and can propose an additive change touching only documented owners.

### Implementation for User Story 3

- [x] T015 [US3] Refactor hybrid search composition for clarity in `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts`, `packages/memento-core/src/domains/search/algorithms/search-ranking.ts`, and `packages/memento-core/src/domains/search/algorithms/search-result-combiner.ts` (extract helpers, reduce duplication, preserve parity)
- [x] T016 [US3] Document **hybrid search** layering (ranking vs providers vs merge) in `specs/013-refactor-approach/maintainer-map.md` with file references under `packages/memento-core/src/domains/search/`
- [x] T017 [US3] Record FR-011 operational touchpoints for search increment in PR notes and/or `specs/013-refactor-approach/maintainer-map.md`
- [x] T018 [US3] Satisfy FR-013: run `npm run test:search` from repo root per `package.json`, complete `specs/013-refactor-approach/manual-regression-checklist.md` **hybrid search** sections, and full CI before merge

**Checkpoint**: Search boundaries documented; agreed search scenarios stable vs baseline.

---

## Phase 6: First-wave coverage — remaining capability areas (FR-014)

**Purpose**: **FR-014** requires at least one releasable increment per area: this phase covers **scheduled background coordination**, **relationship extraction**, and **embedding pipeline** (not separate P4–P6 user stories in `spec.md`).

**Goal**: One shippable refactor + `maintainer-map.md` increment row each for: batch scheduling (FR-004), relation layers (FR-006), embedding boundary typing (FR-005).

**Independent test**: Each increment passes **CI**; **FR-013 manual** is **not** mandatory unless the increment **directly** changes recall/search/admin HTTP paths (per clarified FR-013); complete **recommended** manual steps where helpful. **FR-011** (operational touchpoints) applies to **each** Phase 6 increment via **T020 / T022 / T024**, same pattern as US1–US3.

- [x] T019 Refactor ownership boundaries in `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` (separate configuration vs execution vs failure handling concerns without behavior change) per FR-004. **CI gate (FR-013)**: run `npm run lint`, `npm run type-check`, `npm test` from repo root before merge and record pass in PR body; FR-002 is satisfied via CI-only for this indirect-only increment (no direct change to recall/search/admin HTTP surfaces per FR-013); FR-013 manual regression is **not mandatory** but **recommended**
- [x] T020 Update `specs/013-refactor-approach/maintainer-map.md` increment map and **scheduled background** section referencing `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`, including **FR-011** operational touchpoints for this increment (PR body and/or maintainer-map)
- [x] T021 [P] Refactor relationship extraction layering across `packages/memento-core/src/domains/relation/services/relation-extractor.ts` and `packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-service.ts` (provider selection vs orchestration vs persistence hooks) per FR-006. **CI gate (FR-013)**: run `npm run lint`, `npm run type-check`, `npm test` from repo root before merge and record pass in PR body; FR-002 is satisfied via CI-only for this indirect-only increment (no direct change to recall/search/admin HTTP surfaces per FR-013); FR-013 manual regression is **not mandatory** but **recommended**
- [x] T022 Update `specs/013-refactor-approach/maintainer-map.md` for **relationship extraction** increment and file anchors under `packages/memento-core/src/domains/relation/`, including **FR-011** operational touchpoints for this increment (PR body and/or maintainer-map)
- [x] T023 [P] Reduce unsafe generic handling at module boundaries in `packages/memento-core/src/domains/embedding/providers/embedding-provider-factory.ts` and `packages/memento-core/src/domains/embedding/services/unified-embedding-service.ts` per FR-005 (no schema migrations). **CI gate (FR-013)**: run `npm run lint`, `npm run type-check`, `npm test` from repo root before merge and record pass in PR body; FR-002 is satisfied via CI-only for this indirect-only increment (no direct change to recall/search/admin HTTP surfaces per FR-013); FR-013 manual regression is **not mandatory** but **recommended**
- [x] T024 Update `specs/013-refactor-approach/maintainer-map.md` for **embedding pipeline** increment with paths under `packages/memento-core/src/domains/embedding/`, including **FR-011** operational touchpoints for this increment (PR body and/or maintainer-map)

**Checkpoint**: All six capability areas have at least one documented, merged-quality increment on track for FR-014, with **FR-011** operational notes delivered via **T020 / T022 / T024**.

---

## Phase 7: Polish & cross-cutting concerns

**Purpose**: Program closure artifacts, **SC-001 / SC-002 / SC-004** measurement hooks (first wave), success-criteria traceability, final verification. **Authoritative step-by-step procedures**: `specs/013-refactor-approach/spec.md` → **Success Criteria** → **Measurement procedures (SC-001–SC-004)** (cross-linked from each task below).

- [x] T025 Verify `specs/013-refactor-approach/maintainer-map.md` documents **FR-014** first-wave completion (six areas × ≥1 increment) and SC-002/SC-004 retrospective placeholders (SC-002 per FR-016/FR-023; SC-004 per FR-021)
- [x] T026 [P] Add quarterly retrospective placeholders for SC-001/SC-004 participant counts (FR-021/FR-022) to `specs/013-refactor-approach/maintainer-map.md` (canonical location for all SC-001/SC-004 retro results)
- [x] T027 Run or schedule the first **SC-001** facilitated onboarding exercise per **`specs/013-refactor-approach/spec.md`** → **Measurement procedures — SC-001**: participants use **only** `specs/013-refactor-approach/maintainer-map.md` to distinguish recall vs search ownership scenarios; record cohort size, **first-attempt correctness** rate, and pool limitations per **FR-022** in `specs/013-refactor-approach/maintainer-map.md` (retro section) — **minimum three participants** when fewer than five are available
- [x] T028 [P] Run or schedule the first **SC-004** quarterly perceived-time survey per **`specs/013-refactor-approach/spec.md`** → **Measurement procedures — SC-004** (recall/search ownership tweak): **Pre-condition (survey instrument must be documented before collecting responses)**: before collecting responses, confirm that the **primary survey scale** (Likert / estimated-minutes / % improvement — "pick one") is documented in `specs/013-refactor-approach/maintainer-map.md` or `specs/013-refactor-approach/research.md`; if not already recorded, select and document it now so the same instrument is reused across quarters. Then collect responses per **FR-021**, record **30%** target assessment only when **≥3** responses (or **≥5** sampled when enough contributors exist), and note limitations in `specs/013-refactor-approach/maintainer-map.md`
- [x] T029 Document **SC-002** defect-trend **cadence** for **two consecutive releases** after program start per **`specs/013-refactor-approach/spec.md`** → **Measurement procedures — SC-002**: **Pre-condition (N/σ parameters must be fixed before proceeding)**: confirm that T005 has fixed (a) the N/σ parameter in `specs/013-refactor-approach/maintainer-map.md` §"SC-002 measurement" (per `spec.md` Measurement procedures — SC-002 step 5) and (b) defect classification rules in `specs/013-refactor-approach/research.md` before proceeding; if not fixed, fix them now so the release comparison is consistent. Then use **GitHub Issues** as primary source per `specs/013-refactor-approach/plan.md`, apply filters and “statistically meaningful” rules from `specs/013-refactor-approach/research.md` (**FR-016**); add a small **release comparison** table or checklist template in `specs/013-refactor-approach/maintainer-map.md` or `specs/013-refactor-approach/research.md` so each release snapshot is repeatable
- [x] T030 Run final program validation from `specs/013-refactor-approach/quickstart.md`: `npm run lint`, `npm run type-check`, `npm test` from the repository root (after **T027–T029** when schedules allow; does not replace **SC** measurement steps in **spec.md**); also verify no migration files were introduced during the first wave: `git diff main -- packages/memento-core/src/infrastructure/database/migrations/` should show no new files (FR-009)

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** → **Phase 2** (foundational docs must be authoritative before relying on them in PRs)
- **Phase 2** → **Phases 3–6** (checklist + maintainer skeleton usable)
- **Phases 3–5** (US1–US3): After Phase 2, may proceed **sequentially by priority** (P1 → P2 → P3) or with **separate branches** if merge conflicts are managed—stories are independently testable per `spec.md`
- **Phase 6**: After Phase 2; **can overlap** Phases 3–5 if different owners and no shared-file conflicts (recommended: start after US1 MVP if team is small). **Small teams:** Phase 6 changes can still **merge-conflict** with ongoing US1–3 work (shared packages); prefer finishing **US1** before heavy Phase 6 parallel work, or **rebase often** and split owners by subtree.
- **Phase 7**: After all increments intended for first wave are merged to `main`. Run **T027–T029** (success-criteria measurement) when cohorts/releases are available; **T030** is the final quality-gate sweep — typically **after** T025–T026 and ideally **after** T027–T029 when schedule allows.

### User story dependencies

- **US1 (P1)**: No dependency on US2/US3; depends on Phase 2 only
- **US2 (P2)**: No hard dependency on US1 if files don’t overlap; practically sequential reduces merge pain
- **US3 (P3)**: Same as US2

### Within each user story or Phase 6 increment

- Code refactor → update `maintainer-map.md` (with **FR-011** in the paired doc task) → FR-013 evidence (when mandatory)

### Parallel opportunities

- **T002** and **T003** (Phase 1) — different files
- **T021** and **T023** (Phase 6) — different subsystems (`domains/relation` vs `domains/embedding`)
- **T026**, **T027**, **T028**, **T029** (Phase 7) — different files or parallelizable surveys/cadence docs; **T030** should follow when ready for final CI sweep

---

## Parallel example: User Story 1

```bash
# After T007 completes, T008–T010 are mostly sequential (same feature area).
# No parallel [P] tasks inside US1 unless splitting PRs by doc vs code with careful coordination.
```

---

## Parallel example: Phase 6 (FR-014)

```bash
# Relation vs embedding refactors can proceed in parallel on separate branches:
Task T021 — `packages/memento-core/src/domains/relation/services/relation-extractor.ts`
Task T023 — `packages/memento-core/src/domains/embedding/services/unified-embedding-service.ts`
```

---

## Implementation strategy

### MVP first (User Story 1 only)

1. Complete Phase 1–2 (T001–T006)
2. Complete Phase 3 / US1 (T007–T010)
3. **Stop and validate**: recall documentation + FR-013 evidence for recall increment
4. Demo/onboard reviewers using `maintainer-map.md`

### Incremental delivery

1. Setup + Foundational → shared gates ready
2. US1 → independent verification (SC-001/SC-004 alignment via docs)
3. US2 → SC-003 admin review session
4. US3 → search extension clarity
5. Phase 6 → FR-014 closure for remaining capability areas (scheduler, relation, embedding) with **FR-011** on **T020 / T022 / T024**
6. Phase 7 → **T025** (FR-014 closure in map) → **T026** (retro placeholders) → **T027**–**T029** (SC-001 / SC-004 / SC-002 hooks when schedules allow) → **T030** (final CI sweep)

### Suggested MVP scope

- **Minimum**: Phase 1–2 + **Phase 3 (US1)** — delivers highest-priority maintainer value and first recall increment toward FR-014

---

## Notes

- **[P]** = different files / no dependency on incomplete sibling tasks
- **[USn]** only on Phases 3–5 tasks
- FR-013 manual checklist: mandatory only for **direct** recall/search/admin HTTP runtime path changes; see `specs/013-refactor-approach/contracts/merge-gates.md`
- Emergency merges: FR-019 — organization policy, not overridden by this task list
- **Task IDs**: Phase 7 runs **T027**–**T029** (success-criteria hooks) then **T030** (final CI sweep) after **T025**–**T026** when schedules allow
- **T027–T029** tie **SC-001**, **SC-004**, and **SC-002** to concrete artifacts per **`specs/013-refactor-approach/spec.md`** **Measurement procedures**; scheduling may slip past the first merge — record dates and limitations in **FR-021/FR-022** retrospectives when targets are not assessable
