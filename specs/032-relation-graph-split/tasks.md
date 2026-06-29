# Tasks: 032-relation-graph-split

## Phase 1 — Baseline

- [x] T001 worktree `032-relation-graph-split` 생성
- [x] T002 spec/plan/tasks 작성
- [x] T003 relation-graph vitest baseline green 확인

## Phase 2 — Extract modules

- [x] T004 `relation-graph-row-utils.ts` 추출
- [x] T005 `relation-graph-cache.ts` 추출
- [x] T006 `relation-graph-cycle-detector.ts` 추출
- [x] T007 `relation-graph-query.ts` 추출
- [x] T008 `relation-graph-traversal.ts` 추출
- [x] T009 `relation-graph-mutations.ts` 추출
- [x] T010 `relation-graph.ts` 오케스트레이션으로 축소

## Phase 3 — Verify

- [x] T011 relation vitest + full CI green
- [x] T012 graphify rebuild
- [ ] T013 PR 등록 (Closes #595)
