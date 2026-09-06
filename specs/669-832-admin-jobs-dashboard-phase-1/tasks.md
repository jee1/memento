# Tasks: Admin Jobs Dashboard Phase 1

**Input**: `specs/669-832-admin-jobs-dashboard-phase-1/`  
**Prerequisites**: spec.md (Brainstormed), plan.md, research.md, data-model.md, contracts/admin-batch-stats.md  
**Issue**: [#832](https://github.com/jee1/memento/issues/832)

**Markers**: `[P]` parallel · `[TDD]` red-green-refactor · `[SUBAGENT]` delegable · `[REVIEW]` review gate

## Phase 1: Setup

- [x] T001 Confirm feature artifacts under `specs/669-832-admin-jobs-dashboard-phase-1/` and update `progress.yml` current_phase=execute when starting impl
- [x] T002 [P] Skim `admin-batch.routes.ts`, `job-queue.ts`, `batch-scheduler-stats.ts`, `dashboard-tabs-panels.js` — no code change

---

## Phase 2: Foundational — JobQueue snapshot

**Goal**: Queue name lists for FR-011 / US2

- [x] T003 [TDD] RED: unit tests for `getRunningNames` / `getQueuedNames` (empty, one running, mixed queue) in `packages/memento-core/src/infrastructure/scheduler/` `__tests__` (or adjacent existing job-queue spec)
- [x] T004 [TDD] GREEN: implement snapshot accessors on `packages/memento-core/src/infrastructure/scheduler/job-queue.ts` (array copies; no job fn leak)
- [x] T005 Export/wire if needed from BatchScheduler public surface for route serializer

**Checkpoint**: JobQueue snapshot tests green

---

## Phase 3: US1+US2+US4 — `GET /admin/batch/stats` (P1/P2)

**Goal**: JSON-safe detailed stats + queue; status unchanged

- [x] T006 [TDD] RED: admin route tests — 200 shape per `contracts/admin-batch-stats.md`; Dates/Maps absent; empty-safe; existing `/batch/status` regression still passes (`packages/memento-server/src/server/routes/admin.routes.spec.ts` or sibling)
- [x] T007 [TDD] GREEN: `GET /batch/stats` in `packages/memento-server/src/server/routes/admin/admin-batch.routes.ts` — serialize health/jobs/queue/`schedulerRunning`; ISO dates; `intervalMs` map best-effort
- [x] T008 [P] Confirm `/batch/run-history` + `/batch/run` whitelist tests untouched (US4)

**Checkpoint**: Route contract green; status regression green

---

## Phase 4: US3 — Jobs UI (P1)

**Goal**: Jobs tab + manual refresh + embedded run-history

- [x] T009 [TDD] RED: `packages/memento-server/src/server/dashboard-jobs-panel.spec.ts` — tab registered, refresh fetches stats+history, no setInterval/SSE, error path does not wipe blindly
- [x] T010 Add Jobs tab button + panel markup in `static/dashboard.html`; register in `static/js/dashboard-tabs-panels.js`
- [x] T011 [P] [SUBAGENT] `static/js/jobs-panel-shared.js` + `jobs-panel-render.js` + `jobs-panel-fetch.js` + `jobs-panel.js`; script tags in dashboard.html; process-local disclaimer
- [x] T012 [TDD] GREEN: make T009 pass; minimal CSS via tokens if needed

**Checkpoint**: UI smoke green; SC-002 (no auto poll) covered by source assert or harness

---

## Phase 5: Polish

- [x] T013 [P] `npm run lint` + `npm run type-check` on touched packages
- [x] T014 Focused tests: job-queue + admin batch stats + dashboard-jobs-panel
- [x] T015 Rebuild graphify (`python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`) after production code edits
- [x] T016 [REVIEW] `/speckit.superspec.review` vs FR/SC; fix Critical/Important until PASS
- [x] T017 Update `progress.yml` phases + summary report (no git commit unless asked)

---

## Dependencies

```text
T001–T002 → T003–T005 → T006–T008 → T009–T012 → T013–T017
T003 ∥ T002
T008 ∥ after T007
T011 ∥ T010 after T009 RED
```

## AUTO-APPROVE

User `진행해줘` + Speckit canonical: phase checkpoints auto-advance; commit/push still require explicit ask.
