# Tasks: 037-infrastructure-refactor

## Phase 1 — Spec Kit

- [x] T001 worktree `memento-issue-615` / branch `037-infrastructure-refactor`
- [x] T002 `create-new-feature.sh` 실행
- [x] T003 spec.md / plan.md / tasks.md 작성

## Phase 2 — Extract async-optimizer modules

- [x] T004 `async-optimizer.types.ts` 추출
- [x] T005 `async-optimizer-parsers.ts` 추출
- [x] T006 `async-task-worker.ts` 추출
- [x] T007 `async-task-queue.ts` 추출
- [x] T008 `batch-processor.ts` 추출
- [x] T009 `async-optimizer.ts` re-export orchestrator로 축소

## Phase 3 — Extract reflexion-procedural-memory-service modules

- [x] T010 `reflexion-procedural-extraction.ts` 추출
- [x] T011 `reflexion-procedural-create.ts` 추출
- [x] T012 `reflexion-procedural-update-replace.ts` 추출
- [x] T013 `reflexion-procedural-update-incremental.ts` 추출 (+ mergeSteps)
- [x] T014 `reflexion-procedural-update-versioned.ts` 추출
- [x] T015 `reflexion-procedural-memory-service.ts` orchestrator로 축소

## Phase 4 — Verify

- [x] T016 reflexion-worker + failure-detector targeted vitest green
- [x] T017 lint + type-check + npm test green
- [x] T018 graphify rebuild
- [ ] T019 PR 등록 (Closes #615)
