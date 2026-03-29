# Feature Specification: Observability & Telemetry for Memory Quality Metrics

**Feature Branch**: `006-observability-telemetry`
**Created**: 2026-03-29
**Status**: Active

## Overview

Memento는 기억을 저장하는 시스템이지만, 그 기억이 **실제로 얼마나 잘 회수되고, 얼마나 도움이 되며, 시간이 지나며 품질이 어떻게 변하는지**를 측정하지 않으면 개선이 불가능하다. 이 기능은 Memento 내부 동작 전반에 이벤트 기반 텔레메트리를 추가하고, 운영자가 기억 시스템 품질을 정량적으로 모니터링하고 의사결정에 활용할 수 있게 한다.

## User Scenarios & Testing

### User Story 1 - 검색 품질 지표 조회 (Priority: P1)

운영자 또는 개발자가 Memento의 recall 품질이 시간에 따라 어떻게 변하고 있는지를 HTTP API를 통해 조회한다. "오늘 retrieval latency p95가 얼마인가?", "빈 결과가 몇 %인가?", "후보 대비 선택 비율은?" 같은 질문에 즉시 답할 수 있어야 한다. (타입별 검색 빈도는 본 스펙의 search-quality 지표 범위에 포함되지 않는다.)

**Why this priority**: 검색 품질은 Memento의 핵심 가치다. 이 지표 없이는 개선 여부를 객관적으로 판단할 수 없다.

**Independent Test**: `GET /admin/telemetry/search-quality` 를 호출했을 때 retrieval latency p95, empty retrieval rate, top-k selected rate 수치가 반환되면 독립적으로 검증 가능하다.

**Acceptance Scenarios**:

1. **Given** 최근 24시간 동안 recall 요청이 발생했을 때, **When** `GET /admin/telemetry/search-quality` 를 호출하면, **Then** retrieval latency avg/p95(ms), empty retrieval rate(%), avg candidate count, top-k selected rate(%)가 포함된 JSON이 반환된다.
2. **Given** recall 결과가 0건인 요청이 발생했을 때, **When** 지표를 조회하면, **Then** empty retrieval rate에 해당 건이 반영되어 있다.
3. **Given** `period=7d` 파라미터를 전달했을 때, **When** 지표를 조회하면, **Then** 최근 7일의 집계값만 반환된다.
4. **Given** `period`가 허용 목록(`24h`, `7d`, `30d`)에 없거나 빈 값일 때, **When** `GET /admin/telemetry/search-quality`를 호출하면, **Then** HTTP 400이며 응답 본문에 허용 `period` 값이 안내된다.

---

### User Story 2 - 메모리 품질 지표 조회 (Priority: P2)

운영자가 저장된 기억 자체의 건강 상태를 확인한다. 메모리 타입별 비중, 중복 생성률, relation coverage, consolidation 실행 이벤트(원시 이벤트 API) 등을 조회하여 "지식 구조가 좋아지고 있는가?"를 판단한다.

**Why this priority**: 검색 성능이 좋아도 저장된 기억 자체가 노이즈로 가득하면 장기적으로 품질이 하락한다. 기억 구조 건강도를 측정하는 것이 두 번째 우선순위다.

**Independent Test**: `GET /admin/telemetry/memory-quality` 를 호출했을 때 메모리 타입 분포, 중복 write rate, relation coverage ratio가 반환되면 독립적으로 검증 가능하다.

**Acceptance Scenarios**:

1. **Given** 메모리가 저장된 상태에서, **When** `GET /admin/telemetry/memory-quality` 를 호출하면, **Then** episodic/semantic/procedural 비중(%), 중복 write rate(%), relation coverage ratio(%), orphan memory 비율(%)이 반환된다.
2. **Given** consolidation이 실행된 이후, **When** `GET /admin/telemetry/memory-quality` 및 `GET /admin/telemetry/events?event_type=consolidation.performed` 를 조회하면, **Then** memory-quality 응답의 `type_distribution` 등 현재 DB 스냅샷이 갱신된 상태를 반영하고, consolidation 실행 이벤트가 원시 이벤트 API에서 조회된다.

---

### User Story 3 - 시스템 성능 지표 조회 (Priority: P2)

운영자가 서비스 안정성을 모니터링한다. 각 MCP 도구별 응답 시간, 성공/실패율, background job 실패율을 확인하여 "서비스가 살아 있는가?"를 판단한다.

**Why this priority**: 기억 품질 지표와 함께 시스템 지표가 있어야 "느려진 것인가, 아니면 결과가 나쁜 것인가"를 구분할 수 있다.

**Independent Test**: `GET /admin/telemetry/system` 을 호출했을 때 tool별 p95 latency와 error rate가 반환되면 독립적으로 검증 가능하다.

**Acceptance Scenarios**:

1. **Given** MCP 도구 요청이 발생한 이후, **When** `GET /admin/telemetry/system` 을 호출하면, **Then** recall/remember/feedback 각 도구의 avg/p95 latency(ms), 성공/실패 건수, error rate(%)가 반환된다.
2. **Given** sleep consolidation background job이 실행된 이후, **When** `GET /admin/telemetry/system` 을 조회하면, **Then** `background_jobs.sleep_consolidation`에 `last_run_at`, `last_outcome`, `total_runs_24h`, `success_runs_24h`, `failure_runs_24h`, `avg_duration_ms`가 포함되며(해당 기간 데이터가 없으면 일부 필드는 null), `telemetry_cleanup` 잡에도 동일 필드 집합이 적용된다.
3. **Given** `period`가 허용 목록에 없거나 빈 값일 때, **When** `GET /admin/telemetry/system`을 호출하면, **Then** HTTP 400이며 응답 본문에 허용 `period` 값이 안내된다.

---

### User Story 4 - 이벤트 원시 데이터 쿼리 (Priority: P3)

고급 분석 또는 디버깅을 위해 raw 텔레메트리 이벤트를 쿼리한다. 특정 request_id나 event_type으로 검색하여 전체 요청 흐름을 역추적할 수 있다.

**Why this priority**: P1~P3 집계 지표로 충분히 운영이 가능하지만, 특정 이상 케이스를 디버깅하려면 raw 이벤트 접근이 필요하다.

**Independent Test**: `GET /admin/telemetry/events?event_type=memory.search.empty&limit=50` 호출 시 해당 이벤트 목록이 반환되면 독립적으로 검증 가능하다.

**Acceptance Scenarios**:

1. **Given** 이벤트가 기록된 상태에서, **When** `GET /admin/telemetry/events?event_type=memory.search.empty` 를 호출하면, **Then** 해당 이벤트 목록이 최신순으로 반환되며 각 이벤트에 timestamp, request_id, latency_ms, outcome 필드가 포함된다.
2. **Given** 특정 request_id를 알고 있을 때, **When** `GET /admin/telemetry/events?request_id={id}` 를 호출하면, **Then** 해당 요청의 모든 단계 이벤트가 시간순으로 반환된다.
3. **Given** `from` 또는 `to`가 ISO8601로 파싱 불가한 값일 때, **When** `GET /admin/telemetry/events`를 호출하면, **Then** HTTP 400이며 응답 본문이 어떤 파라미터가 잘못되었는지 구분 가능하다.
4. **Given** `from`과 `to`가 모두 유효하지만 `from` > `to`일 때, **When** `GET /admin/telemetry/events`를 호출하면, **Then** HTTP 400이며 역전 오류임을 본문으로 구분 가능하다.

---

### Edge Cases

- recall 요청이 0건인 날짜에 지표를 조회하면 빈 값(0 또는 null)과 함께 정상 응답이 반환된다.
- 텔레메트리 이벤트 기록이 실패(DB 쓰기 오류)해도 원래 기능(recall, remember 등)은 정상적으로 실행된다.
- `telemetry_events` 테이블이 지나치게 커지면 오래된 이벤트를 자동으로 정리하는 보존 정책(기본 90일)이 실행된다.
- `telemetry_daily_metrics`의 일별 집계는 보존 정책 이후에도 유지된다.
- owner_id 필터를 전달하면 해당 owner의 이벤트만 집계한다.
- `GET /admin/telemetry/memory-quality`에 `period` 쿼리가 포함되어도 **무시**하고 200으로 스냅샷을 반환한다(400을 내지 않음).
- `GET /admin/telemetry/search-quality`·`GET /admin/telemetry/system`에서 `period`가 허용 집합(`24h`, `7d`, `30d`) 밖이거나 파싱 불가·빈 값이면 **400 Bad Request**이며, 응답 본문에 허용 값을 안내한다(`memory-quality`의 `period` 무시와 구분).
- `GET /admin/telemetry/events`에서 `from` 또는 `to`가 **ISO8601로 파싱 불가**이거나, 둘 다 유효한데 **`from` > `to`** 이면 **400 Bad Request**이며, 응답 본문은 어떤 쿼리 파라미터가 문제인지 구분 가능해야 한다.

## Requirements

### Functional Requirements

- **FR-001**: 시스템은 recall 요청 처리 중 다음 이벤트를 자동으로 기록해야 한다: `memory.search.requested`, `memory.search.candidates_retrieved`, `memory.search.reranked`, `memory.search.selected`, `memory.search.empty`, `memory.search.failed` (검색 실행 중 예외 발생 시)
- **FR-002**: 시스템은 remember 요청 처리 중 `memory.write.requested`, `memory.write.completed` 이벤트를 자동으로 기록해야 한다.
- **FR-003**: 시스템은 feedback 요청 처리 중 `memory.feedback.positive`, `memory.feedback.negative` 이벤트를 자동으로 기록해야 한다.
- **FR-004**: 시스템은 sleep consolidation 실행 완료 시 `consolidation.performed` 이벤트를 기록해야 한다.
- **FR-005**: 각 이벤트에는 공통 필드가 포함되어야 한다: `timestamp`, `event_type`, `request_id`, `owner_id`, `latency_ms`, `outcome` (success/failure/empty), `error_code` (선택). `request_id`는 서버가 각 MCP 도구 호출 진입 시 UUID를 자동 생성하며, 해당 호출 내 발생하는 모든 이벤트에 동일 값이 전파된다. MCP 클라이언트 변경은 필요하지 않다.
- **FR-006**: recall 이벤트에는 추가 필드가 포함되어야 한다: `candidate_count`, `selected_count`, `retrieval_strategy` (hybrid/vector/fts/graph), `embedding_provider`, `ranking_version`. 각 필드가 어느 event_type에 귀속되는지는 `specs/006-observability-telemetry/data-model.md`의 extra_data 스키마를 참조한다 (`memory.search.requested`에 retrieval_strategy·embedding_provider·ranking_version, `memory.search.candidates_retrieved`·`memory.search.reranked`에 candidate_count, `memory.search.selected`에 selected_count).
- **FR-007**: 시스템은 `GET /admin/telemetry/search-quality` 엔드포인트를 통해 검색 품질 집계 지표를 제공해야 한다: avg latency, p95 latency(raw events 실시간 계산), empty rate, avg candidate count, selected rate. p50/p99는 이 스펙 범위 밖이며, avg와 p95만 제공한다.
- **FR-008**: 시스템은 `GET /admin/telemetry/memory-quality` 엔드포인트를 통해 메모리 품질 집계 지표를 제공해야 한다: 타입별 비중, 중복 write rate, relation coverage ratio, orphan rate. **중복 write**는 동일 owner_id + content 해시가 24시간 이내 이미 존재하는 상태에서 재저장된 경우로 정의한다.
- **FR-009**: 시스템은 `GET /admin/telemetry/system` 엔드포인트를 통해 시스템 성능 지표를 제공해야 한다: 도구별 avg/p95 latency, 성공/실패 건수, background job 상태(`contracts/admin-api.md`의 `background_jobs` 필드: `last_run_at`, `last_outcome`, `total_runs_24h`, `success_runs_24h`, `failure_runs_24h`, `avg_duration_ms` 등)
- **FR-010**: 시스템은 `GET /admin/telemetry/events` 엔드포인트를 통해 원시 이벤트를 쿼리할 수 있어야 한다 (event_type, request_id, owner_id, 날짜 범위 필터 `from`/`to`, limit/offset 페이지네이션 지원). `from`·`to`는 각각 생략 가능하나, **전달된 값은 유효한 ISO8601 instant로 파싱 가능해야** 하며 파싱 불가 시 **400 Bad Request**다. `from`과 `to`가 **모두 유효할 때는 `from` ≤ `to`** 여야 하며, `from` > `to`이면 **400**이다. 오류 응답 본문은 `from`/`to` 중 어느 쪽이 문제인지(파싱 실패·역전) 클라이언트가 구분할 수 있어야 한다.
- **FR-011**: 텔레메트리 이벤트 기록 실패가 recall/remember/feedback 도구의 정상 응답에 영향을 주어서는 안 된다.
- **FR-012**: 텔레메트리 이벤트는 기본 90일 보존 정책을 따르며, `TELEMETRY_RETENTION_DAYS` 환경변수로 설정할 수 있다. 정리는 기존 `BatchScheduler`에 등록된 일별 cleanup 잡으로 실행되며, 실행 간격은 `TELEMETRY_CLEANUP_INTERVAL_MS` 환경변수로 설정 가능하다(기본 24시간). 일별 집계(`telemetry_daily_metrics`)는 보존 기간 이후에도 삭제되지 않는다.
- **FR-013**: 시간 구간 집계가 의미 있는 엔드포인트 `GET /admin/telemetry/search-quality`, `GET /admin/telemetry/system`은 `period` 파라미터(허용 값: `24h`, `7d`, `30d`; 생략 시 `24h`)와 `owner_id` 필터를 지원해야 한다. `period`가 **미지원 값·파싱 불가·빈 문자열**이면 **400 Bad Request**로 거절하고, 응답 본문에 허용 값 목록을 안내해야 한다. `GET /admin/telemetry/memory-quality`는 현재 DB 스냅샷 지표이며 `owner_id` 필터만 지원한다. 요청에 `period`가 포함되어도 **무시**하고 응답은 200으로 반환한다(해당 파라미터는 집계에 사용하지 않음).
- **FR-014**: query 필드는 기본적으로 해시(앞 16자)로 저장하며, `TELEMETRY_STORE_QUERY_PLAINTEXT=true` 환경변수 설정 시 전문을 저장한다.
- **FR-015**: `/admin/telemetry/*` HTTP 엔드포인트는 **기존 admin API와 동일한 접근 모델**을 따른다. 기본 구성은 **루프백 바인딩(예: `MEMENTO_HTTP_BIND_HOST=127.0.0.1`)**을 전제로 하며, 텔레메트리 전용 **API 키·Bearer 등 애플리케이션 계층 인증은 본 스펙 범위에 포함하지 않는다**. 외부 노출이나 별도 인증이 필요하면 별도 변경 계획·운영 가이드에서 정의한다.

### Key Entities

- **TelemetryEvent**: 단일 이벤트 기록. 공통 필드(timestamp, event_type, request_id, owner_id, latency_ms, outcome)와 이벤트 유형별 추가 데이터(JSON blob)를 포함.
- **TelemetryDailyMetric**: 일별 집계 스냅샷. event_type, date, owner_id 단위로 count, avg_latency_ms, error_count를 포함. p95_latency_ms는 이 테이블에 저장하지 않으며, p95 조회는 항상 `telemetry_events`에서 실시간 계산한다.
- **EventType**: `memory.search.requested`, `memory.search.candidates_retrieved`, `memory.search.reranked`, `memory.search.selected`, `memory.search.empty`, `memory.search.failed`, `memory.write.requested`, `memory.write.completed`, `memory.feedback.positive`, `memory.feedback.negative`, `consolidation.performed`, `telemetry.cleanup.performed`
- **RetrievalStrategy**: recall 경로를 식별하는 값 — `hybrid`, `vector`, `fts`, `graph`

## Success Criteria

### Measurable Outcomes

- **SC-001**: recall 요청에 대한 이벤트 기록 성공률 99% 이상 (오류 시에도 기능 응답은 정상).
- **SC-002**: 텔레메트리 계측 추가로 인한 recall/remember 응답 시간 증가가 p95 기준 5ms 이하.
- **SC-003**: `GET /admin/telemetry/search-quality` 응답 시간이 최근 24시간 기준 2초 이내.
- **SC-004**: empty retrieval rate와 duplicate write rate가 시간에 따라 추적 가능하며, 동일 기간 재조회 시 동일 결과를 반환한다 (집계 일관성).
- **SC-005**: 90일 보존 정책 실행 후 90일 이전 원시 이벤트는 삭제되고, 일별 집계 히스토리는 유지된다.

### 구현 간극·검증 범위 (추적용, 규범 아님)

스펙 문장을 구현에 맞추지 않고, **현재 코드가 아직 충족하지 못하거나 자동 테스트로만 전부 입증하기 어려운 점**을 이슈·백로그로 쓰기 위한 메모다. 요구사항을 낮추는 효력은 없다.

| 항목 | 내용 |
|------|------|
| FR-006 `graph` | 관계 그래프 **전용** recall 검색 경로가 없으면 `retrieval_strategy=graph` 를 기록할 수 없다. 구현 시 graph 경로 도입 또는 스펙·데이터 모델 재협의가 필요하다. |
| SC-001 | 장기·운영 지표에 가깝다. CI가 매 빌드에서 99%를 증명하는 구조는 보통 두지 않는다. |
| SC-002 | 저장소에는 recall 경로 중심의 **로컬** 마이크로벤치(`test-telemetry.spec.ts`, CI에서는 스킵 가능)가 있을 수 있다. remember까지 동일 방식으로 단언하려면 테스트를 추가하는 것이 구현 쪽 작업이다. |

## Assumptions

- 초기 구현은 기존 SQLite(`memory.db`)에 `telemetry_events`, `telemetry_daily_metrics` 테이블을 추가한다. 외부 observability 플랫폼(OpenTelemetry, Prometheus)으로의 내보내기는 이 스펙 범위 밖이다.
- `telemetry_daily_metrics`는 이벤트 기록 시마다 즉시 UPSERT로 갱신된다 (실시간 갱신, 별도 배치 잡 불필요). 집계 API는 daily_metrics 테이블에서 단순 SELECT로 SC-003을 만족한다. 오늘 데이터도 동일 테이블에서 조회된다.
- 이 기능은 기존 MCP 도구 계약(16개 도구)을 변경하지 않는다.
- `memory_used_in_response` 이벤트는 외부 에이전트가 명시적으로 알려야 측정 가능하므로 이 스펙에서는 제외한다.

## Out of Scope

- OpenTelemetry / Prometheus / Grafana 연동
- `/admin/telemetry/*` 전용 API 키·OAuth 등 **신규 애플리케이션 인증 레이어**(FR-015와 달리 별도 인증을 도입하는 변경)
- 실시간 스트리밍 이벤트 (WebSocket, SSE)
- 사용자/에이전트 효용 지표 (task completion rate, user correction rate)
- 학습/진화 지표 (reflection 채택률, procedural improvement 효과)
- 이벤트 기반 알람/알림

## Clarifications

### Session 2026-03-29
- Q: query 필드 저장 방식 → A: 기본 해시(16자), `TELEMETRY_STORE_QUERY_PLAINTEXT=true` 환경변수로 전문 저장 활성화 가능
- Q: 초기 저장소 → A: 기존 SQLite 내 별도 테이블 (외부 시스템 연동 없음)
- Q: `telemetry_daily_metrics` 업데이트 전략 → A: 이벤트 기록 시마다 즉시 UPSERT (실시간 갱신, 배치 잡 불필요)
- Q: "중복 write" 기준 → A: 동일 owner_id + content 해시가 24시간 이내 재저장된 경우
- Q: `request_id` 생성 주체 → A: 서버가 각 MCP 도구 호출 진입 시 UUID 자동 생성, 호출 내 모든 이벤트에 전파 (MCP 클라이언트 변경 불필요)
- Q: daily_metrics의 p95 계산 방법 → A: daily_metrics에는 count/avg/error_count만 저장; p95는 항상 raw events 실시간 계산
- Q: 90일 보존 정책 실행 메커니즘 → A: 기존 BatchScheduler에 일별 cleanup 잡 등록 (기본 24시간, TELEMETRY_CLEANUP_INTERVAL_MS 설정 가능)
- Q: MCP 도구별 `owner_id` 텔레메트리 추출 → A: `ToolRegistry.execute` 진입 시 도구 입력 객체에서 관례적 필드를 순서대로 시도한다: `owner_id`, `ownerId`, `context.owner_id`, `context.agent_id`. 없으면 `null`. (필드 추가 시 spec·tasks에 동일 규칙 반영)
- Q: `GET /admin/telemetry/memory-quality`에 `period` 쿼리가 붙은 경우 동작 → A: **무시**하고 스냅샷만 200 반환(400 없음).
- Q: `/admin/telemetry/*` 접근·인증 요구 → A: **기존 admin과 동일** — 루프백 바인딩 전제, 텔레메트리 전용 API 키/Bearer 없음(FR-015).
- Q: `search-quality`·`system`에서 잘못된 `period` 처리 → A: **400 Bad Request**, 응답 본문에 허용 값(`24h`, `7d`, `30d`) 안내 (`memory-quality`는 `period` 무시·200 유지).
- Q: `events`의 `from`/`to` 파싱 실패 또는 `from`>`to` → A: **400 Bad Request**, 본문에서 파라미터·원인(파싱 실패 vs 역전) 구분 가능.
- Q: `background_jobs` 응답 스키마 — FR-009+US-3 AS2(6개 필드) vs contracts/admin-api.md(3개 필드) 불일치 → A: 스펙 기준 6개 필드(`last_run_at`, `last_outcome`, `total_runs_24h`, `success_runs_24h`, `failure_runs_24h`, `avg_duration_ms`)가 최종 계약. `contracts/admin-api.md` 업데이트.
- Q: `GET /admin/telemetry/system` tool별 latency — FR-009·US-3 AS1의 "p50/p95" vs contracts의 "avg/p95" → A: `avg_latency_ms` + `p95_latency_ms` (contracts 기준). FR-007 search-quality "avg와 p95"와 일관성 유지. FR-009·US-3 AS1 "p50" → "avg"로 수정.
