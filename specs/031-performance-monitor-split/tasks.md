# Tasks: 031-performance-monitor-split

## Phase 1 — Baseline

- [x] T001 worktree `031-performance-monitor-split` 생성
- [x] T002 spec/plan/tasks 작성
- [x] T003 `performance-monitor.spec.ts` baseline green 확인

## Phase 2 — Extract modules

- [x] T004 `performance-monitor-types.ts` 추출
- [x] T005 `memory-pressure-utils.ts` 추출
- [x] T006 `cpu-usage-tracker.ts` 추출
- [x] T007 `search-metrics-store.ts` 추출
- [x] T008 `database-metrics-reader.ts` 추출
- [x] T009 `performance-alert-manager.ts` 추출
- [x] T010 `performance-analytics.ts` 추출
- [x] T011 `performance-monitor.ts` 오케스트레이션으로 축소 + re-export

## Phase 3 — Verify & docs

- [x] T012 monitoring vitest + full CI green
- [x] T013 `core-deprecated-inventory.md` 경로 갱신
- [x] T014 graphify rebuild
- [ ] T015 PR 등록 (Closes #594)
