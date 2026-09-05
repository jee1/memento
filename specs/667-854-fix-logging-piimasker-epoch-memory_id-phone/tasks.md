# Tasks: 667-854-fix-logging-piimasker-epoch-memory_id-phone

**Input**: [plan.md](./plan.md) · [spec.md](./spec.md)
**Issue**: [#854](https://github.com/jee1/memento/issues/854)

## Phase 1 — Setup

- [x] T001 Confirm existing `pii-masker-*.spec.ts` phone cases still list `010-1234-5678`; note file touch list

## Phase 2 — Foundational (TDD) [REVIEW]

- [x] T002 [TDD] Add `pii-masker-phone-boundary.spec.ts` — RED: preserve `mem_*` / `search_*` / `failure_*` epoch ids, preserve port string; assert real phones still mask
- [x] T003 [TDD] Update `koreanPhonePattern` + `internationalPhonePattern` in `pii-masker.ts` — GREEN
- [x] T004 [REVIEW] Re-run boundary + integration + env-control phone tests

## Phase 3 — User Stories (covered by T002–T003)

US1–US3 acceptance mapped into T002 cases; no extra code paths.

## Phase 4 — Polish

- [x] T005 Run `npm run lint` + `npm run type-check` on touched package
- [x] T006 Rebuild graphify; confirm `graphify-out/GRAPH_REPORT.md` exists (do not commit)
- [x] T007 Update `progress.yml` + `checklist-review.md`

## Dependencies

```text
T001 → T002 → T003 → T004 → T005 → T006 → T007
```

## Parallel Opportunities

None meaningful (single file + single new test).

## Checkpoint Policy

User authorized full Speckit auto-advance (`진행해줘` + canonical). `[REVIEW]` runs as agent checklist-review (no commit/push).
