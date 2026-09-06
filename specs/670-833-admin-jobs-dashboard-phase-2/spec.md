# Feature Specification: Admin Jobs Dashboard Phase 2 — durable job_run

**Feature Branch**: `feature/feat-admin-jobs-dashboard-phase-2-durable-job_ru`
**Spec Directory**: `specs/670-833-admin-jobs-dashboard-phase-2`
**Created**: 2026-09-06
**Status**: Brainstormed
**Issue**: [#833](https://github.com/jee1/memento/issues/833)
**Parent**: Epic [#831](https://github.com/jee1/memento/issues/831)
**Depends on**: [#832](https://github.com/jee1/memento/issues/832) (Phase 1 — stats UI)
**Input**: feat(admin): Jobs Dashboard Phase 2 — durable job_run 실행 이력

## Problem Statement

스케줄 자동 실행과 수동 `POST /admin/batch/run` 결과가 **프로세스 로컬 ring buffer**
(`batch-run-history`, 수동만)와 **lastJobRunMeta**(스케줄 last-only)에만 남아,
서버 재시작 후 실행 타임라인을 볼 수 없다. 운영자는 “이 job이 최근 N회 성공/실패했는지”
를 영속적으로 확인할 수 있어야 한다.

## Goals

- 스케줄·수동 실행 결과를 SQLite `job_run`에 append한다(성공/실패).
- `GET /admin/batch/runs?job=&limit=`로 최근 실행 이력을 조회한다.
- Jobs UI에서 job 선택 시 start/end/duration/success 타임라인을 본다.
- retention 정책(`JOB_RUN_RETENTION_DAYS`, telemetry_cleanup 정렬) + 테스트.
- 서버 재시작 후에도 이력 조회 가능.

## Non-Goals

- run_id 단위 로그 스토어 → Phase 3 [#834](https://github.com/jee1/memento/issues/834)
- pause/resume·관리 액션 UI
- Bull/Temporal/Redis 외부 큐
- `POST /admin/batch/run` 화이트리스트 확장
- ring buffer `/admin/batch/run-history` 완전 제거(보조 유지; 신규 타임라인은 `/runs`)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 영속 실행 기록 (Priority: P1)

스케줄러가 job을 돌리거나 운영자가 수동 실행하면 결과가 SQLite에 남는다.

**Why this priority**: Phase 2 핵심 — 재시작 후에도 이력이 있어야 함.

**Independent Test**: 스케줄/수동 실행 후 DB에 행이 생기고, 프로세스 재기동 후에도 `GET /runs`가 동일 행을 반환.

**Acceptance Scenarios**:

1. **Given** 스케줄 job이 성공/실패로 종료, **When** 실행이 끝나면, **Then** `job_run`에 `trigger=schedule`, start/end, success, duration_ms(및 가능하면 processed/error_count/details)가 기록된다.
2. **Given** 인증된 운영자가 whitelist job을 `POST /admin/batch/run`으로 실행, **When** 성공 또는 실패로 끝나면, **Then** `job_run`에 `trigger=manual` 행이 기록되고 기존 ring buffer 동작은 유지된다.
3. **Given** append 중 DB 오류, **When** job 자체는 성공/실패를 확정함, **Then** job 결과(primary success)를 뒤집지 않고 로그만 남긴다(실패 격리).

---

### User Story 2 - 실행 이력 API (Priority: P1)

운영자/클라이언트가 job별·전체 최근 실행 목록을 조회한다.

**Why this priority**: UI와 외부 관측의 계약.

**Independent Test**: seed된 `job_run` 행에 대해 `GET /admin/batch/runs`가 limit/job 필터·최신순을 지킨다.

**Acceptance Scenarios**:

1. **Given** 여러 job의 실행 행, **When** `GET /admin/batch/runs?limit=N`, **Then** 최신 `started_at` 순으로 최대 N건(기본·상한 clamp)을 반환한다.
2. **Given** 특정 `job` 쿼리, **When** 조회하면, **Then** 해당 `job_name`만 필터된다.
3. **Given** 행이 없음, **When** 조회하면, **Then** 빈 배열 200(오류 아님).

---

### User Story 3 - Jobs UI 타임라인 (Priority: P1)

운영자가 Jobs 화면에서 job을 고르면 최근 N회 실행 타임라인을 본다.

**Why this priority**: 이슈 완료 기준의 UI 축.

**Independent Test**: Jobs panel smoke — job 선택 → `/runs?job=` fetch → start/end/duration/success 렌더; 수동 Refresh only 유지.

**Acceptance Scenarios**:

1. **Given** Jobs 탭, **When** 스케줄 표의 job 행을 선택하면, **Then** 해당 job의 최근 실행 목록(시작·종료·duration·성공 여부)이 표시된다.
2. **Given** 선택·Refresh, **When** 요청 성공, **Then** 타임라인이 최신 스냅샷으로 갱신된다.
3. **Given** Phase 1 process-local disclaimer, **When** Phase 2 배포, **Then** durable runs 안내로 갱신되고 “재시작 후 소멸” 문구를 제거한다.

---

### User Story 4 - Retention (Priority: P2)

오래된 `job_run` 행이 정책일수 이후 삭제되고, 문서·테스트로 검증된다.

**Why this priority**: 테이블 무한 성장 방지; 이슈 완료 기준.

**Independent Test**: cutoff 이전 행 DELETE 단위 테스트 + retention env 문서.

**Acceptance Scenarios**:

1. **Given** `JOB_RUN_RETENTION_DAYS` (기본 90), **When** cleanup이 돌면, **Then** cutoff(ISO) 이전 `started_at` 행만 삭제된다.
2. **Given** retention 문서, **When** 운영자가 읽으면, **Then** env·기본값·cleanup 경로가 명시된다.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist each completed schedule and manual batch job execution into SQLite table `job_run` with columns: `id`, `job_name`, `trigger` (`schedule`|`manual`), `started_at`, `ended_at`, `success`, `duration_ms`, `processed`, `error_count`, `details_json`.
- **FR-002**: Schedule path MUST append on completion (success or failure) from the BatchScheduler execution coordinator path.
- **FR-003**: Manual `POST /admin/batch/run` MUST append with `trigger=manual` without removing existing `/batch/run-history` ring buffer behavior.
- **FR-004**: Append failures MUST NOT flip the primary job success/failure outcome (log + soft-fail).
- **FR-005**: System MUST expose `GET /admin/batch/runs` with optional `job` and `limit` (clamped; newest-first).
- **FR-006**: Jobs UI MUST show a per-job recent-run timeline driven by `/runs` (manual refresh only; no new poll/SSE).
- **FR-007**: System MUST retain runs for `JOB_RUN_RETENTION_DAYS` (default 90) and delete expired rows via a documented cleanup path aligned with telemetry_cleanup (JS ISO cutoff, not SQL `CURRENT_TIMESTAMP` string compare alone).
- **FR-008**: Migration MUST create `job_run` + indexes; `schema.sql` MUST mirror DDL for fresh DBs.
- **FR-009**: Existing `/admin/batch/status`, `/batch/stats`, `/batch/run-history`, `/batch/run` whitelist contracts MUST remain backward compatible.

### Key Entities

- **JobRun**: one completed execution row (schedule or manual).
- **BatchRunHistoryRecord**: process-local manual-only ring (unchanged API; Phase 2 optional dual-write source).

## Success Criteria *(mandatory)*

- **SC-001**: After process restart, previously appended runs remain queryable via `GET /admin/batch/runs`.
- **SC-002**: Both schedule and manual completions produce `job_run` rows (covered by tests).
- **SC-003**: Retention policy documented + unit/integration test deletes rows older than retention window.
- **SC-004**: Jobs UI timeline shows start/end/duration/success for selected job without auto-poll.
- **SC-005**: Constitution I–IV gates pass (TDD, compat, migration, quality + graphify).

## Edge Cases

- Concurrent schedule + manual for same `job_name` → both rows; order by `started_at`.
- Missing `processed`/`details` on schedule void runners → null/0 + empty details OK.
- Invalid `limit` / unknown `job` → clamp / empty list.
- DB unavailable at append → job outcome unchanged; warn log.
- Retention env `< 1` → reject or clamp to ≥1 (match telemetry pattern).

## Assumptions

- Phase 1 Jobs tab + `/batch/stats` already on branch or mergeable.
- Admin auth for new `/runs` same as other `/admin/batch/*`.
- `details_json` is best-effort JSON text; size capped reasonably if needed.

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q1 | ring buffer `/run-history` keep vs replace? | Resolved | Keep as secondary (manual-only); durable timeline uses `/runs` |
| Q2 | Retention default days? | Resolved | 90 via `JOB_RUN_RETENTION_DAYS` (telemetry-aligned) |
| Q3 | Schedule append hook? | Resolved | `BatchJobExecutionCoordinator.executeJobWithRetry` finally |
| Q4 | Cleanup vehicle? | Resolved | `JobRunRepository.deleteExpired` + hook from existing cleanup/telemetry-style batch path (document in research) |
| Q5 | UI interaction? | Resolved | Click/select schedule job row → fetch `/runs?job=` timeline |

## Brainstorm Log

### 2026-09-06 — Session 1 (canonical auto-select)

- Categories: boundary (empty/limit), failure isolation (append soft-fail), scale (retention 90d + indexes), security (admin auth reuse), UX (job select timeline, disclaimer update).
- All open Q1–Q5 set to Recommended answers above; Status → Brainstormed.
- No further brainstorm needed unless plan surfaces new OQ.
