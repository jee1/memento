# Feature Specification: Admin Jobs Dashboard Phase 3 — run logs + pause/resume·Run now

**Feature Branch**: `feature/feat-admin-jobs-dashboard-phase-3-run-pause-resu`
**Spec Directory**: `specs/671-834-admin-jobs-dashboard-phase-3`
**Created**: 2026-09-06
**Status**: Brainstormed
**Issue**: [#834](https://github.com/jee1/memento/issues/834)
**Parent**: Epic [#831](https://github.com/jee1/memento/issues/831)
**Depends on**: [#833](https://github.com/jee1/memento/issues/833) (Phase 2 — durable `job_run`; CLOSED)
**Input**: feat(admin): Jobs Dashboard Phase 3 — run 로그 + pause/resume·Run now

## Problem Statement

Phase 1–2로 스케줄·큐·영속 실행 타임라인은 보인다. 운영자가 **실패한 run을
로그로 추적**하거나 **스케줄을 pause/resume**하고 **임의 job을 Run now**하려면
여전히 서버/CLI에 의존한다. 쓰기 액션과 run 로그가 없으면 Phase 3 완료 기준
(실패 추적·인증된 관리·동시 Run 불변식)을 충족할 수 없다.

## Goals

- `job_run`에 묶인 structured log를 조회한다 (`job_run_log`: run_id, ts, level, message, context).
- Jobs UI에 Logs 탭(또는 동등 패널)을 제공한다.
- pause / resume / Run now(전 job)를 기존 `stopJob` / `restartJob` / `runJob` 위에 노출한다.
- 이중 실행 가드(`isJobRunning` / JobQueue dedupe)를 지킨다.
- 쓰기 액션은 admin auth + 확인 UX; read-only 모드 옵션 제공.
- (선택 P3) queue oldest-age 헬스 필드를 stats/UI에 노출.

## Non-Goals

- 외부 알림 / PagerDuty
- Bull Board / Arena / Temporal UI
- Redis·외부 브로커
- SSE/실시간 푸시 (수동 Refresh 또는 기존 짧은 poll만)
- FileLogger 전체를 DB로 이전 (run에 묶인 구조화 로그만)
- Phase 2 ring buffer `/run-history` 제거

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run 로그 조회 (Priority: P1)

운영자가 실패한(또는 임의) run을 고르면 해당 run의 structured 로그를 본다.

**Why this priority**: 이슈 완료 기준 — “실패 run의 로그·에러를 UI에서 추적”.

**Independent Test**: seed된 `job_run` + `job_run_log`에 대해 GET logs가 run_id 필터·시간순을 반환; UI Logs 패널이 렌더.

**Acceptance Scenarios**:

1. **Given** 완료된 run에 로그 행이 있음, **When** 운영자가 해당 run의 로그를 요청하면, **Then** ts·level·message·context가 시간순으로 표시된다.
2. **Given** 로그가 없는 run, **When** 조회하면, **Then** 빈 목록(오류 아님)을 본다.
3. **Given** job 실행 중 경고/에러 로그, **When** 실행이 `job_run`에 묶이면, **Then** 동일 `run_id`로 조회 가능하다.

---

### User Story 2 - Pause / Resume 스케줄 (Priority: P1)

운영자가 Jobs UI에서 스케줄 job을 일시정지·재개한다.

**Why this priority**: Epic Phase 3 관리 액션 핵심; 기존 `stopJob`/`restartJob` 표면화.

**Independent Test**: 인증된 POST pause → 스케줄 비활성/중지; POST resume → 재시작; 미인증은 거절.

**Acceptance Scenarios**:

1. **Given** 활성 스케줄 job, **When** 인증된 운영자가 pause를 확인 후 요청하면, **Then** 주기 실행이 멈추고 UI에 paused 상태가 반영된다.
2. **Given** paused job, **When** resume을 확인 후 요청하면, **Then** 스케줄이 다시 돌고 UI가 갱신된다.
3. **Given** 미인증 또는 read-only 모드, **When** pause/resume을 시도하면, **Then** 쓰기가 거절되고 스케줄은 변하지 않는다.

---

### User Story 3 - Run now (전 job) (Priority: P1)

운영자가 whitelist가 아닌 포함 **등록된 모든 스케줄 job**을 즉시 한 번 실행한다.

**Why this priority**: 이슈 범위 — 기존 3종 whitelist `POST /batch/run`을 전 job으로 확장(또는 동등 엔드포인트).

**Independent Test**: 인증 + 확인 후 runJob; 이미 실행 중이면 409/거절 + 큐 불변식 유지.

**Acceptance Scenarios**:

1. **Given** 유휴 job, **When** 인증된 운영자가 Run now를 확인하면, **Then** 한 번 실행되고 `job_run`(manual)이 남는다.
2. **Given** 동일 job이 이미 실행 중(`isJobRunning` 또는 큐 dedupe), **When** 동시 Run now를 보내면, **Then** 이중 실행 없이 거절/중복 무시되며 큐 불변식이 깨지지 않는다.
3. **Given** read-only 모드, **When** Run now를 시도하면, **Then** 거절된다.

---

### User Story 4 - Failed retry (Priority: P2)

운영자가 실패한 run 행에서 “다시 실행”을 고른다 (별도 replay 엔진 없음 — 해당 `job_name`에 대한 Run now와 동일).

**Why this priority**: 이슈 “(선택) failed retry”; P1 없이 MVP 가능하나 UX 완성에 유용.

**Independent Test**: failed timeline 행 → confirm → runJob(job_name); success run에서는 버튼 비활성 또는 숨김.

**Acceptance Scenarios**:

1. **Given** `success=false`인 run, **When** Retry를 확인하면, **Then** 해당 job이 수동 실행되고 새 `job_run`이 생긴다.
2. **Given** 성공 run, **When** UI를 보면, **Then** Retry가 없거나 비활성이다.

---

### User Story 5 - Queue oldest-age 헬스 (Priority: P3)

운영자가 큐에 가장 오래 대기 중인 항목의 나이를 본다.

**Why this priority**: 이슈 선택 항목; Phase 1 큐 요약 확장.

**Independent Test**: stats/queue 스냅샷에 oldest-age(ms 또는 ISO) 필드 + UI 한 줄.

**Acceptance Scenarios**:

1. **Given** 대기 항목이 있음, **When** stats/queue를 보면, **Then** oldest waiting age가 노출된다.
2. **Given** 큐 비어 있음, **When** 조회하면, **Then** null/0으로 표시된다.

---

### Edge Cases

- 알 수 없는 `run_id` / `job_name` → 404 또는 빈 결과(계약에 명시).
- pause 중 Run now → 허용(일회 수동 실행)하되 스케줄은 paused 유지.
- resume이 이미 활성인 job → idempotent 성공.
- 로그 context가 큰 JSON → 크기 상한 또는 truncate; UI는 접기.
- 동시 pause + schedule tick → stop 이후 신규 tick 없음; in-flight run은 완료까지 둠.
- read-only 모드에서도 GET logs/runs/stats는 허용.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST store structured log lines linked to a `job_run` id with `ts`, `level`, `message`, and optional `context` (JSON text).
- **FR-002**: System MUST expose authenticated GET of logs by `run_id` (newest or chronological; clamped limit).
- **FR-003**: Jobs UI MUST provide a Logs view for the selected run (manual Refresh).
- **FR-004**: System MUST expose authenticated pause and resume for schedule jobs, mapping to existing scheduler stop/restart semantics.
- **FR-005**: System MUST expose authenticated Run now for any registered schedule job name (not only the prior 3-job whitelist), using existing run semantics.
- **FR-006**: Concurrent Run now for an already-running job MUST be rejected or deduped so queue/execution invariants hold (`isJobRunning` / JobQueue dedupe).
- **FR-007**: All write actions (pause/resume/run/retry) MUST require admin authentication and a confirmation step in the UI.
- **FR-008**: System MUST support a read-only mode that allows GETs but rejects writes with a clear error.
- **FR-009**: Failed-run Retry MUST trigger the same path as Run now for that `job_name` (no separate replay store).
- **FR-010**: Log append during job execution MUST NOT flip the primary job success/failure outcome (soft-fail / failure isolation).
- **FR-011**: `job_run_log` retention MUST follow `job_run` retention (cascade delete or cleanup with parent).
- **FR-012** *(P3)*: Queue snapshot SHOULD expose oldest waiting item age when queue data is present.
- **FR-013**: Existing Phase 1–2 GET contracts (`/batch/status`, `/batch/stats`, `/batch/runs`, `/batch/run-history`) MUST remain backward compatible; Run whitelist expansion MUST be documented as intentional contract widening for `/batch/run` or a sibling path.

### Key Entities

- **JobRun**: Phase 2 durable execution row (parent).
- **JobRunLog**: structured log line belonging to one JobRun.
- **ScheduleJobControl**: pause/resume view of scheduler stop/restart.
- **ManualRunRequest**: authenticated one-shot run (including retry).

## Success Criteria *(mandatory)*

- **SC-001**: Operator can open a failed run and see its log lines (or empty) in the Jobs UI without SSH/CLI.
- **SC-002**: Unauthenticated or read-only clients cannot pause, resume, or Run now; authenticated confirmed actions succeed when the job is idle.
- **SC-003**: Two concurrent Run now requests for the same busy job do not create overlapping dual execution (regression test).
- **SC-004**: Pause stops further schedule ticks; resume restores them (observable via status/stats).
- **SC-005**: Constitution I–IV gates pass (TDD, compat notes, migration if any, quality + graphify for production code).

## Assumptions

- Phase 2 `job_run` + Jobs timeline already on this branch.
- Admin auth for writes reuses the same admin API key / middleware as other `/admin/batch/*` POSTs.
- “pause” = stop periodic schedule; in-flight run is not force-killed unless existing stop semantics already do.
- Structured logs are written from the job/scheduler path when a `run_id` is known; legacy FileLogger files remain as-is.
- Read-only mode is an env flag (e.g. `ADMIN_JOBS_READ_ONLY=true`) defaulting off.

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q1 | Log store: SQLite `job_run_log` vs FileLogger index? | Resolved | SQLite `job_run_log` keyed by `run_id` (queryable UI); FileLogger not migrated |
| Q2 | Expand `POST /batch/run` whitelist vs new route? | Resolved | Expand same `POST /admin/batch/run` to all registered schedule jobs; keep body `{ job }` ; document breaking widen |
| Q3 | Failed retry scope? | Resolved | P2: Retry = Run now for `job_name` from failed row; no replay engine |
| Q4 | Read-only mechanism? | Resolved | Env `ADMIN_JOBS_READ_ONLY` (default false); middleware rejects writes |
| Q5 | Queue oldest-age in MVP? | Resolved | P3 stretch; implement if queue snapshot already easy; else defer task optional |
| Q6 | pause vs force-cancel in-flight? | Resolved | pause = stop schedule only; in-flight completes (existing stopJob semantics) |

## Brainstorm Log

### 2026-09-06 — Session 1 (canonical auto-select)

- Categories covered: boundary (empty logs, unknown ids), error (auth/read-only), scale (log retention with parent), security (admin + confirm + read-only), UX (Logs tab, confirm dialogs, Retry on failed only).
- Q1–Q6 set to Recommended above; Status → Brainstormed.
- No further brainstorm unless plan surfaces new OQ.
