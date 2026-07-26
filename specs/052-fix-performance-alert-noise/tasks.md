# Tasks: Performance alert WARN 노이즈 완화 (#697)

**Input**: `specs/052-fix-performance-alert-noise/`  
**Prerequisites**: spec.md, plan.md

## Phase 1: Spec Kit (완료 기준: 산출물 존재)

- [x] T001 Write `spec.md` / `plan.md` / `tasks.md`

## Phase 2: Tests (US1–US3) — Red

- [x] T002 [P] [US1] Add tests: warning → `logger.info`, critical → `logger.warn` for `Performance alert generated` in `performance-monitor.spec.ts`
- [x] T003 [P] [US2] Add tests: default `databaseSizeMB` 500, `PERF_DATABASE_WARN_MB` override, 150MB under default no alert
- [x] T004 [US3] Add rearm cooldown test; set `alertRearmMs: 0` on existing resolve→recreate cases

## Phase 3: Implementation — Green

- [x] T005 [US2] Wire `PERF_DATABASE_WARN_MB` + `PERF_ALERT_REARM_MS` in `environment.ts` / `env.example` / types
- [x] T006 [US1][US3] Implement log-level split + rearm in `performance-alert-manager.ts`
- [x] T007 Update `CHANGELOG.md` Unreleased Fixed for #697

## Phase 4: Verify

- [x] T008 Run domain vitest for `performance-monitor.spec.ts` (33 passed)
- [x] T009 Run `npm run lint` && `npm run type-check` in worktree
- [x] T010 Open PR closing #697
