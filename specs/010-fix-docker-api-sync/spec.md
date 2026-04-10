# Feature Specification: Docker HTTP API 엔드포인트 동기화

**Feature Branch**: `010-fix-docker-api-sync`  
**Created**: 2026-04-04  
**Status**: Clarified  
**Input**: User description: "루트 src/server/와 packages/memento-server/src/server/ 사이의 HTTP API 엔드포인트 불일치 수정. 현재 도커 빌드는 루트 src/server/를 컴파일하는데, 다음 엔드포인트가 packages 버전에만 존재하여 도커 컨테이너에서 404를 반환함: GET /admin/telemetry/search-quality, GET /admin/telemetry/memory-quality, GET /admin/telemetry/system, GET /admin/telemetry/events, GET /admin/graph, POST /admin/consolidation/run."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 도커 환경에서 텔레메트리 지표 조회 (Priority: P1)

운영자가 도커로 배포된 Memento 서버의 검색 품질, 메모리 품질, 시스템 지표를 텔레메트리 API를 통해 조회하려 한다. 현재 도커 환경에서 이 엔드포인트들이 404를 반환하여 운영 모니터링이 불가능하다.

**Why this priority**: 텔레메트리 조회는 운영 중인 시스템 상태 파악의 핵심 기능이며, 도커 배포 환경에서 동작하지 않으면 운영자가 시스템 건강 상태를 전혀 파악할 수 없다.

**Independent Test**: 도커 컨테이너를 실행한 뒤 `GET /admin/telemetry/search-quality`, `GET /admin/telemetry/memory-quality`, `GET /admin/telemetry/system`에 HTTP 요청을 보내 200 응답 및 유효한 JSON 데이터를 받을 수 있는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 도커 컨테이너가 정상 실행 중일 때, **When** `GET /admin/telemetry/search-quality?period=24h`를 호출하면, **Then** HTTP 200과 검색 품질 지표 JSON을 반환한다.
2. **Given** 도커 컨테이너가 정상 실행 중일 때, **When** `GET /admin/telemetry/memory-quality`를 호출하면, **Then** HTTP 200과 메모리 품질 데이터를 반환한다.
3. **Given** 도커 컨테이너가 정상 실행 중일 때, **When** `GET /admin/telemetry/system?period=7d`를 호출하면, **Then** HTTP 200과 시스템 지표를 반환한다.
4. **Given** 잘못된 period 파라미터(예: `period=invalid`)를 전달할 때, **When** 텔레메트리 엔드포인트를 호출하면, **Then** HTTP 400과 허용 값 목록을 반환한다.

---

### User Story 2 - 도커 환경에서 텔레메트리 이벤트 조회 (Priority: P1)

운영자가 도커 환경에서 시간 범위, 이벤트 유형, 결과(성공/실패/빈 결과)별로 텔레메트리 이벤트를 필터링하여 조회하려 한다.

**Why this priority**: 이벤트 로그는 장애 원인 분석 및 사용 패턴 파악에 필수적이며 텔레메트리 지표 조회와 동일한 우선순위를 가진다.

**Independent Test**: 도커 컨테이너에서 `GET /admin/telemetry/events`에 다양한 쿼리 파라미터로 요청을 보내 페이지네이션된 이벤트 목록을 받는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 도커 컨테이너가 정상 실행 중일 때, **When** `GET /admin/telemetry/events?limit=20&offset=0`를 호출하면, **Then** HTTP 200과 최신 20건의 이벤트 목록을 반환한다.
2. **Given** 유효한 시간 범위를 지정할 때, **When** `GET /admin/telemetry/events?from=2026-01-01&to=2026-04-01`를 호출하면, **Then** 해당 기간 이벤트만 필터링하여 반환한다.
3. **Given** `limit=200`(허용 범위 초과) 파라미터를 전달할 때, **When** 이벤트 엔드포인트를 호출하면, **Then** HTTP 400 오류를 반환한다.
4. **Given** 유효하지 않은 날짜 문자열을 `from`에 전달할 때, **When** 이벤트 엔드포인트를 호출하면, **Then** HTTP 400 오류를 반환한다.

---

### User Story 3 - 도커 환경에서 메모리 관계 그래프 조회 (Priority: P2)

운영자나 개발자가 도커 환경에서 `GET /admin/graph`를 통해 기억 항목 간의 관계 그래프 데이터를 조회하려 한다. 현재 도커에서 404를 반환한다.

**Why this priority**: 관계 그래프는 시각화 기능(009-memory-graph-view)의 데이터 소스이지만, 텔레메트리보다 운영 긴급도가 낮다.

**Independent Test**: 도커 컨테이너에서 `GET /admin/graph`를 호출하여 nodes와 edges 배열을 포함한 JSON 응답을 받는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 도커 컨테이너가 정상 실행 중일 때, **When** `GET /admin/graph`를 호출하면, **Then** HTTP 200과 `{ nodes, edges, meta }` 구조의 JSON을 반환한다.
2. **Given** `types=semantic,episodic&min_importance=0.5` 필터를 전달할 때, **When** `/admin/graph`를 호출하면, **Then** 해당 조건에 맞는 노드와 엣지만 반환한다.
3. **Given** `types=invalid_type`을 전달할 때, **When** `/admin/graph`를 호출하면, **Then** HTTP 400 오류를 반환한다.
4. **Given** 조회된 데이터가 기본 limit(200)을 초과할 때, **When** `/admin/graph`를 호출하면, **Then** `meta.truncated: true`를 포함하여 반환한다.

---

### User Story 4 - 도커 환경에서 Sleep Consolidation 수동 실행 (Priority: P2)

운영자가 도커 환경에서 에피소딕→시맨틱 메모리 자동 통합(Sleep Consolidation)을 `POST /admin/consolidation/run`으로 수동 실행하려 한다.

**Why this priority**: 통합 작업은 메모리 품질 유지에 중요하지만 스케줄러를 통해 자동 실행되므로 수동 트리거 가용성은 텔레메트리보다 우선순위가 낮다.

**Independent Test**: 도커 컨테이너에서 `POST /admin/consolidation/run`에 `{ "dryRun": true }` 바디로 요청을 보내 통합 결과 JSON을 받는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 도커 컨테이너가 정상 실행 중일 때, **When** `POST /admin/consolidation/run`에 `{ "dryRun": true }`를 전달하면, **Then** HTTP 200과 실제 변경 없이 시뮬레이션 결과를 반환한다.
2. **Given** 도커 컨테이너가 정상 실행 중일 때, **When** `POST /admin/consolidation/run`을 빈 바디로 호출하면, **Then** HTTP 200과 실제 통합 실행 결과를 반환한다.
3. **Given** 통합 작업이 이미 실행 중일 때, **When** `POST /admin/consolidation/run`을 다시 호출하면, **Then** HTTP 409 Conflict를 반환한다.

---

### Edge Cases

- 데이터베이스 연결이 없는 상태에서 새 엔드포인트를 호출하면 HTTP 500을 반환해야 한다.
- 텔레메트리 서비스가 초기화되지 않은 경우 텔레메트리 엔드포인트들이 HTTP 500을 반환해야 한다.
- Sleep Consolidation 서비스가 비활성화된 환경에서 `/admin/consolidation/run`을 호출하면 HTTP 500을 반환해야 한다.
- 도커 컨테이너 재시작 후에도 모든 누락 엔드포인트가 지속적으로 사용 가능해야 한다.
- 기존에 동작하던 루트 src/server 엔드포인트들이 이번 변경으로 인해 영향받지 않아야 한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 도커 빌드 환경에서 `GET /admin/telemetry/search-quality` 엔드포인트가 응답해야 한다. `period` 파라미터(`24h`, `7d`, `30d`)와 선택적 `owner_id`를 지원하며, 유효하지 않은 period에는 HTTP 400을 반환해야 한다.
- **FR-002**: 도커 빌드 환경에서 `GET /admin/telemetry/memory-quality` 엔드포인트가 응답해야 한다. 선택적 `owner_id` 필터를 지원한다.
- **FR-003**: 도커 빌드 환경에서 `GET /admin/telemetry/system` 엔드포인트가 응답해야 한다. `period` 파라미터(`24h`, `7d`, `30d`)와 선택적 `owner_id`를 지원하며, 유효하지 않은 period에는 HTTP 400을 반환해야 한다.
- **FR-004**: 도커 빌드 환경에서 `GET /admin/telemetry/events` 엔드포인트가 응답해야 한다. `from`, `to`(ISO 날짜), `limit`(1–100, 기본 50), `offset`(기본 0), `outcome`(`success`/`failure`/`empty`), `event_type`, `owner_id`, `request_id` 필터를 지원하며, 유효하지 않은 파라미터에는 HTTP 400을 반환해야 한다.
- **FR-005**: 도커 빌드 환경에서 `GET /admin/graph` 엔드포인트가 응답해야 한다. `types`(쉼표 구분, `episodic`/`semantic`/`procedural`/`working`), `relation_types`, `min_importance`(0.0–1.0), `limit`(1–1000, 기본 200) 파라미터를 지원하며, `{ nodes, edges, meta }` 구조를 반환해야 한다.
- **FR-006**: 도커 빌드 환경에서 `POST /admin/consolidation/run` 엔드포인트가 응답해야 한다. `dryRun`(boolean)과 `ownerIdFilter`(string) 바디 파라미터를 지원하며, 이미 실행 중일 경우 HTTP 409를 반환해야 한다.
- **FR-007**: 새로 추가된 6개 엔드포인트의 응답 구조가 packages/memento-server 버전과 기능적으로 동일해야 한다.
- **FR-008**: 기존에 루트 src/server에서 제공하던 모든 엔드포인트는 변경 없이 계속 동작해야 한다.

### Key Entities

- **TelemetryPeriod**: 텔레메트리 조회 기간 값 (`24h`, `7d`, `30d`)
- **EventType**: 텔레메트리 이벤트 분류 (예: `memory.search.requested`, `memory.feedback.positive` 등 12가지)
- **GraphNode**: 기억 항목을 나타내는 그래프 노드 (id, label, content, type, importance, created_at, tags, pinned)
- **GraphEdge**: 기억 항목 간 관계를 나타내는 그래프 엣지 (id, source, target, relation_type, confidence)
- **GraphResponse**: 노드 목록, 엣지 목록, 메타데이터(`total_nodes`, `total_edges`, `applied_filters`, `truncated`)를 포함한 응답 구조

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 도커 컨테이너에서 6개의 누락 엔드포인트 모두 HTTP 404 대신 HTTP 200을 반환한다.
- **SC-002**: 새로 추가된 엔드포인트의 응답 구조가 packages/memento-server 버전과 동일하다 (같은 요청에 동일한 JSON 키 및 데이터 타입).
- **SC-003**: 기존에 동작하던 루트 src/server 엔드포인트들이 변경 전과 동일하게 응답한다 (회귀 없음).
- **SC-004**: 잘못된 파라미터(범위 초과, 파싱 불가 값, 허용되지 않는 열거값) 전달 시 모든 새 엔드포인트가 HTTP 400을 반환한다.
- **SC-005**: 도커 컨테이너 빌드가 오류 없이 완료된다.

## Assumptions

- 루트 `src/server/routes/admin.routes.ts`에 누락된 라우트를 추가하는 방식을 선택한다. 도커 빌드 진입점 자체를 변경하는 방식은 더 큰 리스크를 동반하므로 범위에서 제외한다.
- `TelemetryService`, `SleepConsolidationService` 등 필요한 서비스 인스턴스는 루트 `src/server/bootstrap.ts`의 `ServerServices` 인터페이스에 옵셔널 필드로 추가하고 `initializeServices()`에서 초기화하여 주입한다. 루트 `http-server.ts`는 이미 `@memento/core`의 `ServerServices`를 런타임에 사용하고 있으므로 실제 초기화는 `@memento/core`의 `initializeServices()`에서 수행된다.
- `@memento/core`에서 `ConsolidationAlreadyRunningError`(클래스), `TelemetryPeriod`, `EventType`(타입)이 이미 export되어 있다. 루트 `admin.routes.ts`에서 `@memento/core`로부터 직접 import한다.
- `buildGraphResponse` 헬퍼 함수 및 `GraphNode`, `GraphEdge`, `GraphFilter`, `GraphResponse` 타입은 루트 `admin.routes.ts`에 직접 복사 구현한다(`@memento/core`에 없음).
- `effectiveTelemetryPeriod` 헬퍼 함수는 루트 `admin.routes.ts` 내부에 로컬 함수로 선언하며 packages 버전과 동일한 1줄 로직을 사용한다.

## Clarifications

### Session 2026-04-04

- **Q1**: 루트 `src/server/bootstrap.ts`의 `ServerServices` 인터페이스에 `telemetryService`와 `sleepConsolidationService` 주입 방법 → **A: Option A** (루트 `ServerServices` 인터페이스에 옵셔널 필드 추가, `initializeServices()`에서 초기화)
  - **근거**: 코드 분석 결과 루트 `http-server.ts`는 이미 `@memento/core`의 `ServerServices`(`CoreServerServices`)를 실제 런타임에 사용하며, 이를 `LocalServerServices`로 캐스팅해 `createAdminRouter`에 전달한다. `@memento/core`의 `ServerServices`에는 이미 `telemetryService?`와 `sleepConsolidationService?`가 포함되어 있다. 따라서 루트 `src/server/bootstrap.ts`의 `ServerServices` 인터페이스에도 동일 옵셔널 필드를 추가하고 `initializeServices()`에서 초기화하는 것이 가장 일관된 접근이다.

- **Q2**: 루트 `admin.routes.ts`에서 `buildGraphResponse`, `GraphNode`, `GraphEdge`, `GraphFilter`, `GraphResponse` 타입을 어떻게 확보하는가 → **A: 루트 파일에 직접 복사 구현**
  - **근거**: 이 타입들은 `@memento/core`에서 export되지 않으므로 `packages/memento-server`에서와 동일한 코드를 루트 `admin.routes.ts` 파일 상단에 직접 선언한다. 중복이지만 별도 패키지화할 만큼 재사용 빈도가 낮고, 공용 패키지에 UI 전용 타입을 올리는 것은 아키텍처 의존성 방향(core ← server) 규칙을 깨뜨리므로 적합하지 않다.

- **Q3**: `effectiveTelemetryPeriod` 헬퍼 함수 위치 → **A: 루트 `admin.routes.ts` 파일 내부에 로컬 함수로 선언**
  - **근거**: `packages` 버전과 동일한 1줄짜리 순수 함수이다. 별도 유틸 파일로 분리할 필요 없이 라우터 파일 내부에 두는 것이 가장 단순하다.

- **Q4**: `ConsolidationAlreadyRunningError`, `TelemetryPeriod`, `EventType` import 경로 → **A: `@memento/core`에서 직접 import**
  - **근거**: 코드 확인 결과 세 가지 모두 `@memento/core`의 `index.ts`에서 export된다 (`ConsolidationAlreadyRunningError` — 클래스, `TelemetryPeriod`/`EventType` — `export type`). 루트 `src/server` 코드는 이미 `@memento/core`를 의존성으로 사용하므로 추가 설치 없이 import 가능하다.

- **Q5**: 신규 엔드포인트에 대한 단위 테스트 범위 → **A: 기존 `admin.routes.spec.ts`가 없으므로 새 spec 파일 미생성, 수동 smoke test로 검증**
  - **근거**: 루트 `src/server/routes/`에 `admin.routes.spec.ts`가 존재하지 않으며 packages 버전 테스트도 integration 성격이다. 이 태스크의 SC-001~005 기준은 HTTP 응답 코드와 JSON 구조 확인이므로, 도커 컨테이너 실행 후 curl로 smoke test하는 방식으로 충분하다. 단위 테스트 추가는 이 feature 범위 밖으로 처리한다.

## Coverage Summary

| Category | Status |
|----------|--------|
| 서비스 주입 방법 (Q1) | Resolved — Option A (루트 ServerServices에 옵셔널 필드 추가) |
| 그래프 타입/헬퍼 확보 (Q2) | Resolved — 루트 파일에 직접 복사 구현 |
| 헬퍼 함수 위치 (Q3) | Resolved — 라우터 파일 내부 로컬 함수 |
| 타입 import 경로 (Q4) | Resolved — @memento/core에서 직접 import |
| 테스트 범위 (Q5) | Deferred — smoke test로 충분, 단위 테스트 미생성 |
