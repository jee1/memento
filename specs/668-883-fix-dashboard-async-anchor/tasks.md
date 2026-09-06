# Tasks: 668-883-fix-dashboard-async-anchor

**Issue**: [#883](https://github.com/jee1/memento/issues/883)
**Branch**: `feature/fix-dashboard-anchor-map`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Phase dependencies

```text
Setup → Foundational → (US1 ∥ US2 ∥ US3) → (US4 ∥ US5) → Polish → Review
```

AUTO-APPROVE checkpoints between phases (user Speckit canonical for this session).

---

## Phase 0 — Setup

- [x] T001 Confirm companion script load order in `dashboard.html` and existing harness lists in `dashboard-review-candidates-panel.spec.ts` / `dashboard-agent-sessions-panel.spec.ts`
- [x] T002 Update `progress.yml` current_phase through execute

---

## Phase 1 — Foundational

- [x] T003 [TDD] Add failing harness coverage for `previewGeneration` / list fingerprint helpers expectations in review panel spec
- [x] T004 [P] Extend `review-candidates-panel-shared.js` state: `previewGeneration`, `lastListFingerprint`, fingerprint builder
- [x] T005 [P] Extend `agent-sessions-panel-shared.js` state: `detailGeneration`

---

## Phase 2 — User Story 1 (P1) Review stale preview

- [x] T006 [TDD][SUBAGENT] RED: delayed A preview after B select must not apply (review panel spec)
- [x] T007 [SUBAGENT] GREEN: guard preview apply + action enablement in `review-candidates-panel-render-preview.js` / `render-actions.js`

---

## Phase 3 — User Story 2 (P1) Sessions stale detail

- [x] T008 [TDD][P][SUBAGENT] RED: delayed A detail/timeline after B select ignored (agent sessions spec or new focused cases)
- [x] T009 [P][SUBAGENT] GREEN: generation + selectedSessionId checks in `agent-sessions-panel-data.js`

---

## Phase 4 — User Story 3 (P1) SSE/poll selection + fingerprint

- [x] T010 [TDD][P][SUBAGENT] RED: same-count list change applies; selection restored for surviving IDs
- [x] T011 [P][SUBAGENT] GREEN: `poll-snapshot.js` fingerprint apply; `render-list.js` preserve/restore selection (stop blind clear)

---

## Phase 5 — User Story 4 (P2) Checkbox Space

- [x] T012 [TDD][P][SUBAGENT] RED: Space on checkbox does not call `onRowActivate` / preventDefault
- [x] T013 [P][SUBAGENT] GREEN: exclude checkbox targets in `review-candidates-panel-render-list.js` keydown

---

## Phase 6 — User Story 5 (P2) Mobile map + auth hidden

- [x] T014 [TDD][P][SUBAGENT] RED: CSS contracts for `[hidden]`, map `min-height: 200px`, tab `overflow-x`
- [x] T015 [P][SUBAGENT] GREEN: `static/css/dashboard.css` rules

---

## Phase 7 — Polish

- [x] T016 Run focused Vitest suites + `npm run lint` + `npm run type-check`
- [x] T017 Rebuild graphify (`python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`)
- [x] T018 Mark tasks complete; prepare review checklist

---

## Parallel map

| Wave | Tasks |
|------|-------|
| F | T004 ∥ T005 after T003 |
| P1 | T006→T007; T008→T009; T010→T011 (pairs parallel across stories) |
| P2 | T012→T013 ∥ T014→T015 |
| Polish | T016 → T017 → T018 |
