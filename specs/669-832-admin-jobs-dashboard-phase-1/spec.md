# Feature Specification: Admin Jobs Dashboard Phase 1 — 스케줄·큐 가시성

**Feature Branch**: `feature/feat-admin-jobs-dashboard-phase-1-detailedstats`
**Spec Directory**: `specs/669-832-admin-jobs-dashboard-phase-1`
**Created**: 2026-09-06
**Status**: Executed — review PASS
**Issue**: [#832](https://github.com/jee1/memento/issues/832)
**Parent**: Epic [#831](https://github.com/jee1/memento/issues/831)
**Input**: feat(admin): Jobs Dashboard Phase 1 — detailedStats·스케줄·큐 API + read-mostly UI

## Problem Statement

운영자가 Admin에서 배치 스케줄러가 **어떤 job이 켜져 있는지**, **마지막으로 언제 돌았는지**, **지금 큐에 무엇이 쌓였는지**를 한눈에 볼 수 없다. 백엔드에는 이미 상세 통계·스케줄 Map·인메모리 큐 스냅샷이 있으나 Admin 표면은 얇은 status와 수동 `run-history` 정도만 노출한다. 결과적으로 장애·지연 진단이 Review Queue 수동 이력에 의존한다.

## Goals

- 인증된 운영자가 Admin에서 **스케줄 job 목록**(이름·간격/활성·마지막 실행·실행 횟수·오류 수·실행 중 여부)을 확인한다.
- 같은 화면에서 **큐 요약**(깊이·실행 중 개수·실행 중 이름, 가능하면 대기 이름)과 **건강 요약**을 확인한다.
- 기존 수동 실행 이력(`run-history`)에 Jobs 화면에서 접근한다(링크 또는 임베드).
- 데이터는 **수동 새로고침**으로만 갱신한다(자동 poll·SSE 없음).
- 기존 Admin 배치 조회·수동 실행 계약은 깨지지 않는다.

## Non-Goals

- `job_run` 영속화·프로세스 재시작 후 이력 보존 → [#833](https://github.com/jee1/memento/issues/833)
- pause/resume·per-run logs·관리 액션 UI → [#834](https://github.com/jee1/memento/issues/834)
- Bull / Temporal / Redis 등 외부 큐 도입
- `POST /admin/batch/run` jobType 화이트리스트 확장(선택 항목 — 본 Phase에서 하지 않음)
- 신규 알림·임계값 경보 파이프라인

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 스케줄·건강 상태 조회 (Priority: P1)

운영자가 Admin Jobs 화면에 들어가면 등록된 스케줄 job별 상태와 스케줄러 건강 요약을 본다.

**Why this priority**: Phase 1의 가치 — “지금 스케줄러가 살아 있고 job이 돌고 있는가”를 바로 확인.

**Independent Test**: 인증된 Admin 클라이언트로 상세 통계를 요청하면 job 배열·health 필드가 채워지고, Jobs UI가 이를 표로 렌더한다.

**Acceptance Scenarios**:

1. **Given** 배치 스케줄러가 기동된 상태, **When** 운영자가 Jobs 상세 통계를 조회하면, **Then** 각 스케줄 job에 대해 이름·간격 또는 활성 여부·마지막 실행 시각(없으면 없음 표시)·누적 실행 횟수·오류 수·현재 실행 중 여부가 보인다.
2. **Given** 동일 조회, **When** 응답을 확인하면, **Then** 건강 요약에 실행 중 job 수·큐 깊이·오류율·업타임(및 메모리 사용 비율이 제공되면 그것)이 포함된다.
3. **Given** 스케줄러가 아직 시작되지 않았거나 job이 없는 상태, **When** 조회하면, **Then** 오류 대신 빈 목록·제로 카운트로 안전하게 표시된다.

---

### User Story 2 - 큐 스냅샷 확인 (Priority: P1)

운영자가 대기·실행 중 큐 압력을 한눈에 본다.

**Why this priority**: 큐 적체는 스케줄 “마지막 실행”만으로는 보이지 않는 지연 원인.

**Independent Test**: 큐에 대기/실행 중 job이 있을 때 스냅샷 필드가 깊이와 이름 목록을 반영한다.

**Acceptance Scenarios**:

1. **Given** 하나 이상의 job이 실행 중, **When** 큐 스냅샷을 조회하면, **Then** `runningCount`와 실행 중 job 이름 목록이 실제와 일치한다.
2. **Given** 대기열에 job이 있음, **When** 조회하면, **Then** 큐 크기(`size`)가 보이고, 대기 이름 목록을 제공할 수 있으면 함께 보인다(불가하면 크기는 필수, 이름 목록은 생략 가능함을 UI에 명시).
3. **Given** 큐가 비어 있음, **When** 조회하면, **Then** size·runningCount가 0이고 이름 목록은 비어 있다.

---

### User Story 3 - Jobs 페이지 + 수동 refresh + run-history (Priority: P1)

운영자가 Admin 대시보드에서 Jobs 탭/페이지를 열고, 새로고침 버튼으로만 데이터를 갱신하며, 기존 수동 실행 이력에 접근한다.

**Why this priority**: API만으로는 “읽기 위주 대시보드” 완료 기준 미달.

**Independent Test**: Jobs 패널 로드·Refresh 클릭·run-history 영역/링크 smoke; 자동 주기 fetch/SSE 구독이 없음을 검증.

**Acceptance Scenarios**:

1. **Given** 인증된 Admin 세션, **When** Jobs 탭을 열면, **Then** 스케줄 테이블·큐 요약·(임베드 또는 링크된) 수동 실행 이력이 한 화면 흐름에 있다.
2. **Given** Jobs 화면이 열려 있음, **When** 시간이 지나도, **Then** 자동 poll·SSE로 목록이 갱신되지 않는다.
3. **Given** 운영자가 Refresh를 누름, **When** 요청이 성공하면, **Then** 스케줄·큐·이력이 최신 스냅샷으로 바뀐다.
4. **Given** 상세 통계 요청이 실패함, **When** UI가 응답하면, **Then** 이전 성공 스냅샷을 덮어쓰지 않거나 명확한 오류 상태를 보여 주고, 다른 Admin 탭은 깨지지 않는다.

---

### User Story 4 - 기존 배치 계약 호환 (Priority: P2)

이미 `/admin/batch/status`·`/admin/batch/run-history`·제한된 `POST /admin/batch/run`을 쓰는 클라이언트/테스트가 계속 동작한다.

**Why this priority**: Constitution II — public Admin 계약 파괴 금지.

**Independent Test**: 기존 admin batch route 스펙이 회귀 없이 green; 신규 필드는 additive이거나 별도 경로.

**Acceptance Scenarios**:

1. **Given** 기존 status 소비자, **When** Phase 1 배포 후 status를 호출하면, **Then** 기존에 의존하던 필드·의미가 유지된다(추가 필드는 허용).
2. **Given** 수동 run-history·whitelist run, **When** Phase 1 후에도 호출하면, **Then** 동작·한도가 기존과 같다.

---

### Edge Cases

- `Date` / Map 등 JSON 비친화 값은 클라이언트에 **직렬화 가능한** 형태(ISO 문자열·plain object/array)로 전달된다.
- 스케줄러 단건 조회 실패 시 500과 안전한 오류 메시지; 절대 경로·시크릿 비노출.
- 매우 많은 스케줄 job이어도 테이블이 스크롤 가능하고 페이지가 멈추지 않는다(운영 규모: 수십 개 수준).
- 미인증/비Admin 요청은 기존 Admin 게이트와 동일하게 거부된다.
- 프로세스 재시작 직후: in-memory 카운터·이력이 초기화될 수 있음 — UI는 “프로세스 로컬/비영속”임을 오해 없이 표현(영속은 #833).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose an Admin-authenticated read surface that returns scheduler health plus a per-schedule job list with name, interval/enabled (or equivalent schedule config), last execution, total executions, error count, and isRunning.
- **FR-002**: System MUST include a queue snapshot with size, runningCount, running job names, and queued names when the in-memory queue can provide them.
- **FR-003**: Admin UI MUST provide a Jobs page/tab showing the schedule table, queue summary, and access to existing manual run-history (link or embed).
- **FR-004**: Jobs page MUST refresh data only on explicit user action (no automatic poll, no SSE for this page).
- **FR-005**: Existing `/admin/batch/status`, `/admin/batch/run-history`, and `POST /admin/batch/run` whitelist behavior MUST remain backward compatible.
- **FR-006**: Admin routes for the new/extended read surface MUST be covered by automated tests; Jobs UI MUST have at least smoke-level coverage for load/refresh/error display.
- **FR-007**: Failure responses MUST NOT leak absolute filesystem paths or credentials.
- **FR-008**: System MUST expose `GET /admin/batch/stats` as a JSON-serializable detailed read (health + schedules + queue). Existing `GET /admin/batch/status` MUST remain unchanged in shape/meaning.
- **FR-009**: Admin dashboard MUST add a Jobs tab (session-only) that loads on manual Refresh / tab open fetch only — never SSE and never interval poll.
- **FR-010**: Jobs page MUST embed (same panel section) the existing manual `run-history` list, with a short note that counters/history are process-local until #833.
- **FR-011**: Queue snapshot MUST include running job name list and queued job name list derived from the in-memory JobQueue (add snapshot accessors if missing today).

### Key Entities

- **ScheduleJobView**: 한 스케줄 job의 운영 스냅샷(이름, 간격/활성, lastExecution, totalExecutions, errorCount, isRunning).
- **QueueSnapshot**: 인메모리 큐의 순간 상태(size, runningCount, runningNames, queuedNames?).
- **SchedulerHealthView**: 스케줄러 건강 요약(runningJobs, queueSize, errorRate, uptime, memoryUsage?).
- **ManualRunHistoryEntry**: 기존 프로세스 로컬 수동 실행 링 버퍼 항목(본 Phase에서 스키마 변경 없음).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 인증된 운영자가 Jobs 화면에서 스케줄 job 상태·마지막 실행·큐 깊이를 **추가 도구 없이** 확인한다.
- **SC-002**: Jobs 화면을 60초 열어 두어도 네트워크에 자동 주기 갱신 요청이 발생하지 않는다(수동 Refresh만).
- **SC-003**: 기존 admin batch status / run-history / run 회귀 테스트가 통과한다.
- **SC-004**: 신규·확장 Admin 읽기 경로와 Jobs UI smoke 테스트가 CI에서 통과한다.
- **SC-005**: 큐가 비었거나 스케줄러 미기동인 경우에도 Jobs 화면이 크래시 없이 “비어 있음/0”을 보여 준다.

## Assumptions

- Phase 1은 **읽기 위주**; 관리 액션·영속 이력은 후속 이슈.
- 상세 통계 소스는 기존 스케줄러 in-memory 상태(`getDetailedStats` / status Maps / `JobQueue`)이며 새 외부 저장소를 두지 않는다.
- API: **신규** `GET /admin/batch/stats` (Q1=A). status 무변경.
- `POST /admin/batch/run` 화이트리스트 확장은 본 Phase 범위 밖.
- Admin 인증·세션 모델은 기존 대시보드와 동일.
- JobQueue에 running/queued 이름 스냅샷 accessor를 추가해 FR-011을 충족한다.

## Brainstorm Log

### 2026-09-06 Session 1 (auto-select per Speckit canonical)

- Categories covered: API contract shape, UX (tab + history), empty/JSON edge, process-local disclaimer, security (admin gate / no path leak).
- Q1→A: new `/admin/batch/stats` JSON-safe; keep `/batch/status` as-is (Maps may still be lossy for legacy callers — not this PR’s rewrite).
- Q2→Recommended: new Jobs tab in dashboard nav (after Review / near Agent Sessions); embed run-history section in panel; Refresh button only.
- Extra: JobQueue today exposes size/runningCount/`isRunning`/`isQueued` but not name lists — plan adds `getRunningNames()` / `getQueuedNames()` (or single `snapshot()`).
- Scale: dozens of schedule rows OK; table scroll.
- No further Open Questions — Ready for Plan.

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q1 | `/admin/batch/stats` 신규 vs `/admin/batch/status` additive 확장? | Resolved | A — 신규 `GET /admin/batch/stats`; status 유지 |
| Q2 | Jobs 탭 배치·run-history 임베드 vs 링크? | Resolved | Jobs 탭 + 패널 내 run-history 임베드 + 수동 Refresh |
