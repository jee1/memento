# Tasks: Docker HTTP API 엔드포인트 동기화

**Input**: Design documents from `/specs/010-fix-docker-api-sync/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Branch**: `010-fix-docker-api-sync`  
**Target Files**: `src/server/bootstrap.ts`, `src/server/routes/admin.routes.ts`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 병렬 실행 가능 (다른 파일, 의존 없음)
- **[US#]**: 해당 User Story 번호
- 모든 task에 파일 경로 포함

---

## Phase 1: Setup (프로젝트 초기화)

**Purpose**: 수정 대상 파일 현황 파악 및 packages 버전 참조 코드 확인

- [x] T001 루트 `src/server/bootstrap.ts` 파일 읽기 — `ServerServices` 인터페이스 및 `initializeServices()` 현재 구조 확인
- [x] T002 루트 `src/server/routes/admin.routes.ts` 파일 읽기 — 기존 라우트 패턴 및 import 구조 확인
- [x] T003 [P] `packages/memento-server/src/server/routes/admin.routes.ts` 읽기 — 복사 원본 참조 (6개 누락 엔드포인트 구현 확인)
- [x] T004 [P] `packages/memento-server/src/server/bootstrap.ts` 읽기 — `ServerServices` 원본 인터페이스 확인 (telemetryService?, sleepConsolidationService? 필드 구조)

---

## Phase 2: Foundational (공통 전제 조건)

**Purpose**: US1~US4 모두에 필요한 서비스 주입 기반 구축. **이 Phase 완료 전 어떤 US도 시작 불가**

**⚠️ CRITICAL**: `src/server/bootstrap.ts` 수정은 모든 엔드포인트 추가의 선행 조건

- [x] T005 루트 `src/server/bootstrap.ts`의 `ServerServices` 인터페이스에 `telemetryService?: TelemetryService` 및 `sleepConsolidationService?: SleepConsolidationService` 옵셔널 필드 추가 — `src/server/bootstrap.ts`
- [x] T006 루트 `src/server/bootstrap.ts`의 import에 `TelemetryService`, `SleepConsolidationService` 추가 (`@memento/core`에서) — `src/server/bootstrap.ts`
- [x] T007 루트 `src/server/bootstrap.ts`의 `initializeServices()` 내부에 `TelemetryService`, `SleepConsolidationService` 초기화 로직 추가 — `src/server/bootstrap.ts`
- [x] T008 루트 `src/server/routes/admin.routes.ts`에 필요한 import 추가 — `ConsolidationAlreadyRunningError`, `TelemetryPeriod`, `EventType` (`@memento/core`에서) — `src/server/routes/admin.routes.ts`
- [x] T009 루트 `src/server/routes/admin.routes.ts` 파일 상단에 로컬 타입/인터페이스 선언 추가 — `GraphNode`, `GraphEdge`, `GraphFilter`, `GraphResponse`, `MemoryItemRow`, `MemoryRelationRow` — `src/server/routes/admin.routes.ts`
- [x] T010 루트 `src/server/routes/admin.routes.ts`에 헬퍼 함수 추가 — `buildGraphResponse()` (노드/엣지 DB 쿼리 + json_each CTE 포함) 및 `effectiveTelemetryPeriod()` (1줄 순수 함수) — `src/server/routes/admin.routes.ts`

**Checkpoint**: bootstrap.ts 수정 완료, admin.routes.ts import/타입/헬퍼 준비 완료 → US 구현 시작 가능

---

## Phase 3: User Story 1 — 도커 환경 텔레메트리 지표 조회 (Priority: P1) 🎯 MVP

**Goal**: `GET /admin/telemetry/search-quality`, `GET /admin/telemetry/memory-quality`, `GET /admin/telemetry/system` 엔드포인트를 도커 환경에서 정상 응답하도록 추가

**Independent Test**: 도커 컨테이너 실행 후 아래 3개 curl로 각각 HTTP 200 확인
```bash
curl http://localhost:9001/admin/telemetry/search-quality?period=24h
curl http://localhost:9001/admin/telemetry/memory-quality
curl http://localhost:9001/admin/telemetry/system?period=7d
```

### Implementation for User Story 1

- [x] T011 [US1] 루트 `src/server/routes/admin.routes.ts`에 `GET /telemetry/search-quality` 엔드포인트 추가 — period 파라미터 유효성 검사(24h/7d/30d), 빈 문자열 → 400, `effectiveTelemetryPeriod()` 사용, `telemetryService.getSearchQuality()` 호출, try-catch + 500 처리 — `src/server/routes/admin.routes.ts`
- [x] T012 [US1] 루트 `src/server/routes/admin.routes.ts`에 `GET /telemetry/memory-quality` 엔드포인트 추가 — `owner_id` 쿼리 파라미터 지원, `telemetryService.getMemoryQuality()` 호출, try-catch + 500 처리 — `src/server/routes/admin.routes.ts`
- [x] T013 [US1] 루트 `src/server/routes/admin.routes.ts`에 `GET /telemetry/system` 엔드포인트 추가 — period 파라미터 유효성 검사(24h/7d/30d), 빈 문자열 → 400, `effectiveTelemetryPeriod()` 사용, `telemetryService.getSystemMetrics()` 호출, try-catch + 500 처리 — `src/server/routes/admin.routes.ts`

**Checkpoint**: US1 완료 — telemetry 지표 3개 엔드포인트 독립 동작 검증 가능

---

## Phase 4: User Story 2 — 도커 환경 텔레메트리 이벤트 조회 (Priority: P1)

**Goal**: `GET /admin/telemetry/events` 엔드포인트를 도커 환경에서 페이지네이션 + 필터링 지원하여 정상 응답하도록 추가

**Independent Test**: 도커 컨테이너 실행 후 아래 curl로 HTTP 200 및 events 배열 확인
```bash
curl "http://localhost:9001/admin/telemetry/events?limit=20&offset=0"
curl "http://localhost:9001/admin/telemetry/events?limit=200"  # 400 기대
```

### Implementation for User Story 2

- [x] T014 [US2] 루트 `src/server/routes/admin.routes.ts`에 `GET /telemetry/events` 엔드포인트 추가 — `limit`(1~100, 기본 50), `offset`(≥0, 기본 0), `from`/`to`(ISO 날짜 파싱), `outcome`(`success`/`failure`/`empty`), `event_type`(EventType 12가지), `owner_id`, `request_id` 파라미터 유효성 검사, 각 오류 케이스 → 400, `telemetryService.getEvents()` 호출, try-catch + 500 처리 — `src/server/routes/admin.routes.ts`

**Checkpoint**: US2 완료 — telemetry 이벤트 조회 엔드포인트 독립 동작 검증 가능 (US1과 독립)

---

## Phase 5: User Story 3 — 도커 환경 메모리 관계 그래프 조회 (Priority: P2)

**Goal**: `GET /admin/graph` 엔드포인트를 도커 환경에서 nodes/edges/meta 구조로 정상 응답하도록 추가

**Independent Test**: 도커 컨테이너 실행 후 아래 curl로 HTTP 200 및 nodes/edges/meta 구조 확인
```bash
curl "http://localhost:9001/admin/graph"
curl "http://localhost:9001/admin/graph?types=semantic,episodic&min_importance=0.5"
curl "http://localhost:9001/admin/graph?types=invalid_type"  # 400 기대
```

### Implementation for User Story 3

- [x] T015 [US3] 루트 `src/server/routes/admin.routes.ts`에 `GET /graph` 엔드포인트 추가 — `types`(쉼표 구분, 허용 외 값 → 400), `relation_types`(쉼표 구분), `min_importance`(0.0~1.0, 파싱/범위 오류 → 400), `limit`(1~1000, 기본 200, 파싱/범위 오류 → 400) 파라미터 유효성 검사, `buildGraphResponse()` 헬퍼 호출, `{ nodes, edges, meta }` 구조 반환, try-catch + 500 처리 — `src/server/routes/admin.routes.ts`

**Checkpoint**: US3 완료 — graph 엔드포인트 독립 동작 검증 가능 (US1/US2와 독립)

---

## Phase 6: User Story 4 — 도커 환경 Sleep Consolidation 수동 실행 (Priority: P2)

**Goal**: `POST /admin/consolidation/run` 엔드포인트를 도커 환경에서 정상 응답하도록 추가

**Independent Test**: 도커 컨테이너 실행 후 아래 curl로 HTTP 200 및 result 구조 확인
```bash
curl -X POST http://localhost:9001/admin/consolidation/run \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

### Implementation for User Story 4

- [x] T016 [US4] 루트 `src/server/routes/admin.routes.ts`에 `POST /consolidation/run` 엔드포인트 추가 — `dryRun`(boolean, 기본 false), `ownerIdFilter`(string | null) 바디 파라미터 추출, `sleepConsolidationService` 미초기화 시 → 500(`Sleep consolidation not available`), `ConsolidationAlreadyRunningError` catch → 409, 일반 오류 → 500, 성공 → `{ success: true, result }` — `src/server/routes/admin.routes.ts`

**Checkpoint**: US4 완료 — consolidation 엔드포인트 독립 동작 검증 가능

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates 통과 및 도커 환경 최종 검증

- [x] T017 `npm run lint -- --fix` 실행 및 오류 해결 — 루트 프로젝트
- [x] T018 [P] `npm run type-check` 실행 및 타입 오류 해결 — 루트 프로젝트
- [x] T019 [P] `npm test` 실행 및 기존 테스트 회귀 없음 확인 — 루트 프로젝트
- [x] T020 도커 빌드 확인 (`docker build .`) 및 smoke test 실행 — 6개 엔드포인트 curl 검증 (SC-001~SC-005)

---

## Dependencies & Execution Order

### Phase 의존 관계

- **Phase 1 (Setup)**: 즉시 시작 가능, 병렬 실행 가능 (T001~T004)
- **Phase 2 (Foundational)**: Phase 1 완료 후 → **모든 US 블락**
  - T005~T007: bootstrap.ts 수정 (순차)
  - T008~T010: admin.routes.ts import/타입/헬퍼 (T005~T007과 병렬 가능, 다른 파일)
- **Phase 3~6 (User Stories)**: Phase 2 완료 후 → **동일 파일(admin.routes.ts)이므로 순차 처리 권장**
- **Phase 7 (Polish)**: Phase 3~6 완료 후

### User Story 의존 관계

| Story | 의존 | 독립 테스트 가능 |
|-------|------|----------------|
| US1 (P1) — telemetry 지표 3개 | Phase 2 완료 | T011~T013 완료 후 |
| US2 (P1) — telemetry events | Phase 2 완료 | T014 완료 후 (US1과 독립) |
| US3 (P2) — graph | Phase 2 완료 | T015 완료 후 (US1/US2와 독립) |
| US4 (P2) — consolidation | Phase 2 완료 | T016 완료 후 (US1/US2/US3와 독립) |

### 병렬 실행 기회

```bash
# Phase 1 — 모두 병렬 가능 (다른 파일 읽기):
T001 (루트 bootstrap.ts 읽기)
T002 (루트 admin.routes.ts 읽기)
T003 (packages admin.routes.ts 읽기)
T004 (packages bootstrap.ts 읽기)

# Phase 2 — bootstrap.ts vs admin.routes.ts 병렬:
[T005 → T006 → T007] (bootstrap.ts)  ||  [T008 → T009 → T010] (admin.routes.ts)

# Phase 7 — lint/type-check/test 병렬:
T017 (lint)  ||  T018 (type-check)  ||  T019 (test)
```

---

## Implementation Strategy

### MVP 범위 (P1 우선)

1. Phase 1: Setup (T001~T004)
2. Phase 2: Foundational (T005~T010) — **필수 전제 조건**
3. Phase 3: US1 — telemetry 지표 3개 (T011~T013)
4. Phase 4: US2 — telemetry events (T014)
5. **중간 검증**: US1 + US2 smoke test (curl 4개 엔드포인트)
6. Phase 5: US3 — graph (T015)
7. Phase 6: US4 — consolidation (T016)
8. Phase 7: quality gates + docker smoke test (T017~T020)

### 단계별 검증 기준 (SC-001~SC-005)

- **SC-001**: 6개 엔드포인트 모두 HTTP 404 → 200
- **SC-002**: 응답 구조가 packages 버전과 동일 (같은 JSON 키/타입)
- **SC-003**: 기존 21개 엔드포인트 회귀 없음
- **SC-004**: 잘못된 파라미터 → HTTP 400
- **SC-005**: 도커 빌드 오류 없음

---

## Notes

- [P] tasks = 다른 파일, 의존 없음 → 병렬 처리 가능
- Phase 3~6는 모두 동일 파일(`admin.routes.ts`)에 작업하므로, 팀 1인 기준 순차 처리 권장
- 각 US 완료 후 checkpoint에서 독립적으로 smoke test 가능
- Phase 7 T017~T019는 모두 병렬로 실행 가능
- 총 20개 task (T001~T020)
