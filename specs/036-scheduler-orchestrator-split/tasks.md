# Tasks: 036-scheduler-orchestrator-split

## Phase 1 — Baseline

- [x] T001 worktree `memento-612-scheduler-split` 생성
- [x] T002 spec/plan/tasks 작성
- [x] T003 scheduler domain vitest baseline 확인

## Phase 2 — Extract batch-scheduler modules

- [x] T004 `batch-scheduler-logging.ts` 추출
- [x] T005 `batch-scheduler-context.ts` 추출
- [x] T006 `batch-scheduler-diagnostics.ts` 추출
- [x] T007 `batch-scheduler-interval.ts` 추출
- [x] T008 `batch-scheduler-stats.ts` 추출
- [x] T009 `batch-scheduler-health.ts` 추출
- [x] T010 `batch-scheduler-singleton.ts` 추출
- [x] T011 `batch-scheduler.ts` 오케스트레이션으로 축소

## Phase 3 — Extract triple-extraction-batch-job modules

- [x] T012 `triple-extraction-batch-job.types.ts` 추출
- [x] T013 `triple-extraction-batch-job-retry.ts` 추출
- [x] T014 `triple-extraction-batch-job-chunk.ts` 추출
- [x] T015 `triple-extraction-batch-job-memory-status.ts` 추출
- [x] T016 `triple-extraction-batch-job.ts` 오케스트레이션으로 축소
- [x] T017 `BatchJobResult` import → `batch-scheduler-types.js`

## Phase 4 — Verify

- [x] T018 batch-scheduler + triple-extraction vitest green
- [x] T019 build + lint + type-check green
- [x] T020 graphify rebuild
- [ ] T021 PR 등록 (Closes #612)
