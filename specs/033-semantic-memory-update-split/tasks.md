# Tasks: 033-semantic-memory-update-split

## Phase 1 — Baseline

- [x] T001 worktree `033-semantic-memory-update-split` 생성
- [x] T002 spec/plan/tasks 작성
- [x] T003 semantic-memory-update vitest baseline green 확인

## Phase 2 — Extract modules

- [x] T004 `semantic-memory-update-types.ts` 추출
- [x] T005 `semantic-memory-scoring.ts` 추출
- [x] T006 `semantic-memory-similarity.ts` 추출
- [x] T007 `semantic-memory-crud.ts` 추출
- [x] T008 `semantic-memory-relations.ts` 추출
- [x] T009 `semantic-memory-update-pipeline.ts` 추출
- [x] T010 `semantic-memory-update-service.ts` 오케스트레이션으로 축소

## Phase 3 — Verify

- [x] T011 semantic memory vitest + full CI green
- [x] T012 graphify rebuild
- [ ] T013 PR 등록 (Closes #598)
