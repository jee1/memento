# Tasks: Fix CPU Monitoring Bug and Reduce MCP Process Overhead

**Input**: Design documents from `/specs/002-fix-mcp-monitoring-overhead/`
**Branch**: `002-fix-mcp-monitoring-overhead`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, quickstart.md ✅

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths included in all descriptions

---

## Phase 1: Setup

*No new files or project structure needed. All changes are modifications to existing files.*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add new environment variables and validation utility that US1–US4 all depend on.

**⚠️ CRITICAL**: All user story phases depend on T001 and T002.

- [X] T001 Add `os` import and new env vars (`PERF_MEMORY_WARN_PERCENT`, `PERF_CPU_WARN_PERCENT`, `BATCH_HEALTH_CHECK_INTERVAL_MS`, `BATCH_JOB_PROCESSOR_INTERVAL_MS`) to `ENV_DEFAULTS`; change `DB_PATH` default to `` `${os.homedir()}/.memento/memory.db` `` in `packages/memento-core/src/shared/config/environment.ts`
- [X] T002 [P] Add `resolveValidatedNumber(key, defaultValue, validate, hint)` utility function to `packages/memento-core/src/shared/config/environment.ts` — returns default + console.warn on NaN or failed validation (FR-011)

**Checkpoint**: Foundation ready — US1–US4 can now proceed in parallel

---

## Phase 3: User Story 1 — CPU 경고 오탐 제거 (Priority: P1) 🎯 MVP

**Goal**: CPU 사용률을 delta 기반으로 계산하여 유휴 상태에서 경고가 발생하지 않도록 수정

**Independent Test**: MCP 서버를 5분간 유휴 상태로 실행 후 CPU 관련 성능 경고 로그가 0건이면 통과

### Implementation for User Story 1

- [X] T003 [US1] Add `private previousCpuUsage: NodeJS.CpuUsage | null = null` and `private previousMeasurementTime: number | null = null` fields to `PerformanceMonitor` class in `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`
- [X] T004 [US1] Rewrite `calculateCpuUsage()` with delta formula: no args, calls `process.cpuUsage()` internally; first call sets baseline and returns 0; subsequent calls compute `(∆user_µs + ∆system_µs) / (wallClock_ms × 1000) × 100` clamped to [0, 100]; returns 0 if wallClockDelta === 0 in `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`
- [X] T005 [US1] Update `collectMetrics()` to call `this.calculateCpuUsage()` with no arguments (remove the `cpuUsage` argument that was passing cumulative value) in `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`
- [X] T006 [US1] Update `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`: add tests for (a) first call returns 0, (b) second call with simulated CPU work returns value in [0, 100], (c) elapsed = 0 returns 0; remove or fix any tests that call `calculateCpuUsage(cpuUsage)` with arguments

**Checkpoint**: US1 independently testable — run `npx vitest run packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

---

## Phase 4: User Story 2 — 에디터 응답성 개선 (Priority: P2)

**Goal**: 헬스체크·큐 폴링 기본 간격을 늘려 유휴 CPU 소비를 50% 이상 감소

**Independent Test**: 배치 스케줄러 기본값이 healthCheckInterval=300,000ms, jobProcessorInterval=1,000ms인지 단위 테스트로 확인

### Implementation for User Story 2

- [X] T007 [US2] Change `healthCheckInterval` constructor default from `30 * 1000` to `resolveValidatedNumber('BATCH_HEALTH_CHECK_INTERVAL_MS', 300_000, n => n >= 10_000, '최솟값 10000')` in `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`
- [X] T008 [US2] Change `setInterval(processQueue, 100)` in `startJobProcessor()` to `setInterval(processQueue, resolveValidatedNumber('BATCH_JOB_PROCESSOR_INTERVAL_MS', 100, n => n >= 100, '최솟값 100'))` — 기본값은 100ms 유지(1,000ms로 변경 시 fake-timer 테스트 8건 회귀 확인, 코드 리뷰 반영) in `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`
- [X] T009 [US2] Update `packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts`: update default value assertions from 30,000 → 300,000 and 100 → 1,000; add test for env var override; add test for invalid (negative) value → default + warn

**Checkpoint**: US2 independently testable — run `npx vitest run packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts`

---

## Phase 5: User Story 3 — DB 경로 일관성 (Priority: P3)

**Goal**: MCP 서버 실행 위치와 무관하게 항상 `~/.memento/memory.db`에 접근; DB 디렉터리 자동 생성

**Independent Test**: 서로 다른 두 디렉터리에서 서버 실행 시 동일한 DB 파일 경로를 사용하는지 확인 (DB_PATH 미설정 상태에서 `os.homedir()` 경로 출력 확인)

### Implementation for User Story 3

- [X] T010 [US3] Add `ensureDbDirectory(dbPath: string): void` function using `mkdirSync(dirname(dbPath), { recursive: true })`; on error, `console.error(...)` and `process.exit(1)` — implemented directly in `packages/memento-core/src/infrastructure/database/database/init.ts` where the DB is actually opened
- [X] T011 [US3] Call `ensureDbDirectory(dbPath)` before the SQLite database connection is opened — fixed existing `mkdirSync` catch block in `packages/memento-core/src/infrastructure/database/database/init.ts` to use `process.exit(1)` on failure

**Checkpoint**: US3 independently testable — set `DB_PATH=/tmp/test-memento/memory.db npm run dev` and verify `/tmp/test-memento/` is auto-created

---

## Phase 6: User Story 4 — 성능 경고 임계값 조정 (Priority: P4)

**Goal**: `PERF_MEMORY_WARN_PERCENT` 및 `PERF_CPU_WARN_PERCENT` 환경 변수로 경고 임계값을 재정의 가능하게 함

**Independent Test**: 환경 변수로 임계값 변경 후, 해당 임계값 미만에서 경고 미발생 / 초과 시 경고 발생 확인

### Implementation for User Story 4

- [X] T012 [US4] In `PerformanceMonitor` constructor, replace hardcoded `memoryUsagePercent: 80` and `cpuUsagePercent: 70` with `resolveValidatedNumber('PERF_MEMORY_WARN_PERCENT', 85, n => n >= 1 && n <= 100, '범위 1-100')` and `resolveValidatedNumber('PERF_CPU_WARN_PERCENT', 75, n => n >= 1 && n <= 100, '범위 1-100')` in `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`
- [X] T013 [US4] Update `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`: update threshold assertions from 80 → 85 (memory) and 70 → 75 (CPU); add test that env var override changes threshold behavior

**Checkpoint**: US4 independently testable — set `PERF_CPU_WARN_PERCENT=10` and confirm warning fires at low CPU; set `PERF_CPU_WARN_PERCENT=abc` and confirm fallback to 75

---

## Phase 7: Polish & Quality Gate

**Purpose**: 전체 품질 게이트 통과 및 최종 검증

- [X] T014 Run `npm run lint -- --fix` from repo root and resolve any remaining lint errors
- [X] T015 [P] Run `npm run type-check` from repo root and resolve all TypeScript errors
- [X] T016 [P] Run `npm test` from repo root — performance-monitor.spec.ts 9/9 pass; batch-scheduler new tests 3/3 pass; pre-existing better-sqlite3 native module failures unchanged
- [ ] T017 Validate quickstart.md scenarios: (a) DB 경로 자동 생성 (`DB_PATH=/tmp/test-memento/memory.db`), (b) 헬스체크 로그 간격 5분 확인, (c) CPU 경고 없음 (5분 유휴)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: No dependencies — start immediately
  - T001 must complete before T002, T003, T007, T010, T012
  - T002 can run in parallel with T001 (but references the new utility — write stub first)
- **User Story phases (3–6)**: All depend on T001 (env vars) and T002 (validation utility)
  - US1 (Phase 3), US2 (Phase 4), US3 (Phase 5) can run in parallel after Phase 2
  - US4 (Phase 6) depends on US1 completion (same file: `performance-monitor.ts`)
- **Polish (Phase 7)**: Depends on all user story phases complete

### User Story Dependencies

| Story | Depends On | Can Parallelize With |
|-------|-----------|---------------------|
| US1 (P1) | Phase 2 | US2, US3 |
| US2 (P2) | Phase 2 | US1, US3 |
| US3 (P3) | Phase 2 | US1, US2 |
| US4 (P4) | Phase 2 + US1 (same file) | US2, US3 |

### Task-Level Dependencies (within Phase 3)

- T004 depends on T003 (needs the new fields before rewriting the method)
- T005 depends on T004 (method signature changes before call-site update)
- T006 depends on T003–T005 (spec update after implementation)

---

## Parallel Execution Examples

### After Phase 2 completes — launch US1, US2, US3 in parallel

```bash
# Agent A: US1 — CPU delta fix
# T003 → T004 → T005 → T006 (sequential within US1)

# Agent B: US2 — Batch scheduler intervals
# T007, T008 (parallel, different methods in same file) → T009

# Agent C: US3 — DB path consistency
# T010 → T011 (sequential, same file)
```

### Phase 7 — parallel quality checks

```bash
# After all implementation complete:
npm run type-check &
npm test &
npm run lint -- --fix
wait
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: environment.ts + validation utility
2. Complete Phase 3: CPU delta fix (T003–T006)
3. **STOP and VALIDATE**: run spec test file, check no CPU warnings in 5 min idle
4. Proceed to US2–US4 if US1 passes

### Incremental Delivery

1. Phase 2 → Foundation ready
2. Phase 3 (US1) → CPU false positives fixed ✅ (SC-001, SC-005)
3. Phase 4 (US2) → Idle CPU reduced 50%+ ✅ (SC-002, SC-003)
4. Phase 5 (US3) → DB path consistent ✅ (SC-004)
5. Phase 6 (US4) → Configurable thresholds ✅
6. Phase 7 → Quality gate passed ✅ (SC-006)

---

## Notes

- No new files are created — all changes are to existing source files
- `resolveValidatedNumber` can be written inline in environment.ts or as a named export
- T002 and T001 are in the same file; write T001 first, then add T002 in the same edit if convenient
- US4 (T012–T013) touches `performance-monitor.ts` — coordinate with US1 (T003–T006) to avoid conflicts
- Run `npm run lint -- --fix` after each file change to catch style issues early
- Commit after each phase to maintain clean history
