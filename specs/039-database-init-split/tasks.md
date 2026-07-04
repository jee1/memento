# Tasks: 039-database-init-split

## Phase 1 — Baseline

- [x] T001 worktree `memento-issue-631` / branch `issue-631-database-init-split` 생성
- [x] T002 spec/plan/tasks 작성
- [x] T003 init.spec.ts baseline green 확인

## Phase 2 — Extract modules

- [x] T004 `init-legacy-schema.ts` 추출
- [x] T005 `init-sqlite-session.ts` 추출
- [x] T006 `init-migration-baseline.ts` 추출
- [x] T007 `init-migrate-existing.ts` 추출
- [x] T008 `init-bootstrap-new-db.ts` 추출
- [x] T009 `init.ts` 오케스트레이션으로 축소

## Phase 3 — Verify

- [x] T010 init + migration vitest + full CI green
- [x] T011 `npm run db:pre-docker-deploy` 통과
- [x] T012 graphify rebuild
- [x] T013 PR 등록 (Closes #631)
