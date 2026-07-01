# Tasks: 034-agent-integration-repo-split

## Phase 1 — Baseline

- [x] T001 worktree `034-agent-integration-repo-split` 생성
- [x] T002 spec/plan/tasks 작성
- [x] T003 agent-integration vitest baseline green 확인

## Phase 2 — Extract modules

- [x] T004 `agent-integration-row-utils.ts` 추출
- [x] T005 `agent-integration-cursor-utils.ts` 추출
- [x] T006 `agent-integration-session-store.ts` 추출
- [x] T007 `agent-integration-observation-store.ts` 추출
- [x] T008 `agent-integration-promotion-store.ts` 추출
- [x] T009 `agent-integration-provenance-store.ts` 추출
- [x] T010 `sqlite-agent-integration-repository.ts` 오케스트레이션으로 축소

## Phase 3 — Verify

- [x] T011 agent-integration vitest + full CI green
- [x] T012 graphify rebuild
- [ ] T013 PR 등록 (Closes #610)
