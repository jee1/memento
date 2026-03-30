# Feature Specification: Telemetry CLI & MCP Tool Access

**Feature Branch**: `007-telemetry-cli-mcp`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "CLI 명령어와 MCP 도구가 모두 있으면 좋겠어."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 서버 없이 CLI로 텔레메트리 조회 (Priority: P1)

운영자 또는 개발자가 HTTP 서버를 별도로 실행하지 않고도, 터미널 명령 하나로 검색 품질·시스템 지표를 즉시 확인하고 싶다.

**Why this priority**: HTTP 서버가 꺼져 있거나 디버깅 중인 상황에서도 지표를 조회할 수 있어야 한다. 가장 빈번히 사용되는 시나리오이며 다른 스토리와 독립적으로 동작한다.

**Independent Test**: 서버를 실행하지 않은 상태에서 `npm run telemetry` 명령을 실행하면 검색 품질·시스템 지표가 포맷된 텍스트로 출력된다.

**Acceptance Scenarios**:

1. **Given** 텔레메트리 이벤트가 DB에 기록되어 있고 HTTP 서버가 꺼진 상태에서, **When** `npm run telemetry` 를 실행하면, **Then** 검색 품질(빈 결과율, 평균/p95 레이턴시, 총 쿼리 수)과 시스템 지표(도구별 호출 수, 성공률)가 한눈에 보이는 포맷으로 출력된다.
2. **Given** 텔레메트리 이벤트가 없는 빈 DB에서, **When** `npm run telemetry` 를 실행하면, **Then** "기록된 텔레메트리 데이터가 없습니다" 메시지가 출력되고 0 exit code로 종료된다.
3. **Given** DB 파일이 존재하지 않을 때, **When** `npm run telemetry` 를 실행하면, **Then** DB 경로와 함께 명확한 오류 메시지가 출력되고 비정상 exit code로 종료된다.

---

### User Story 2 - CLI 기간 필터 및 지표 유형 선택 (Priority: P2)

운영자가 특정 기간(24h / 7d / 30d)이나 특정 지표 유형만 골라서 조회하고 싶다.

**Why this priority**: 기본 조회(P1)만 있어도 충분히 가치 있지만, 기간 비교와 지표 범위 선택이 가능하면 이상 탐지·트렌드 분석에 크게 도움이 된다.

**Independent Test**: `npm run telemetry -- --period 7d --type search-quality` 를 실행하면 7일치 검색 품질 지표만 출력된다.

**Acceptance Scenarios**:

1. **Given** 충분한 이벤트가 기록된 상태에서, **When** `npm run telemetry -- --period 7d` 를 실행하면, **Then** 지난 7일 기준 집계 결과가 출력되고 헤더에 조회 기간이 명시된다.
2. **Given** 여러 지표 유형이 존재할 때, **When** `npm run telemetry -- --type memory-quality` 를 실행하면, **Then** 메모리 품질 지표(중복률, 고아 메모리 수 등)만 출력된다.
3. **Given** 지원하지 않는 기간 값(`--period 1y`)을 입력했을 때, **When** 명령을 실행하면, **Then** 허용 값 목록과 함께 사용법이 출력되고 비정상 exit code로 종료된다.

---

### User Story 3 - 에이전트가 MCP 도구로 자신의 성능 조회 (Priority: P1)

AI 에이전트가 MCP 도구를 통해 자신의 검색 품질·메모리 품질 지표를 조회하여 현재 상태를 파악하고 사용자에게 리포트하거나 스스로 개선 방향을 제안하고 싶다.

**Why this priority**: 에이전트 자가 진단은 메모리 시스템의 핵심 가치 중 하나다. P1으로 CLI와 병행 개발한다.

**Independent Test**: 에이전트가 `get_telemetry_summary` 도구를 호출하면 검색 품질과 메모리 품질 지표를 포함한 구조화된 데이터를 반환한다.

**Acceptance Scenarios**:

1. **Given** 텔레메트리 이벤트가 기록된 상태에서, **When** owner_id가 설정된 에이전트가 `get_telemetry_summary`(period=24h)를 호출하면, **Then** 해당 owner_id로 필터링된 검색 빈 결과율, 평균 레이턴시, 총 쿼리 수, 메모리 품질 요약이 반환된다.
2. **Given** 텔레메트리 데이터가 없을 때, **When** `get_telemetry_summary`를 호출하면, **Then** 각 지표가 null이고 데이터 없음을 나타내는 응답이 반환된다.
3. **Given** 유효하지 않은 `period` 값을 전달했을 때, **When** `get_telemetry_summary`를 호출하면, **Then** 도구 오류가 반환되고 허용 값이 오류 메시지에 포함된다.

---

### Edge Cases

- DB 파일이 없거나 경로가 잘못된 경우 CLI가 명확한 오류를 출력하는가?
- 텔레메트리 마이그레이션이 실행되지 않아 테이블이 없을 때 어떻게 처리하는가?
- MCP 도구 호출 중 DB 오류가 발생하면 에이전트 세션 전체가 중단되지 않는가?
- `period` 파라미터가 생략된 경우 기본값 24h가 자동 적용되는가?
- CLI 출력이 80컬럼 터미널에서 깨지지 않는가?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: CLI 명령(`npm run telemetry`)은 HTTP 서버 없이 DB에 직접 접근하여 텔레메트리 지표를 출력해야 한다.
- **FR-002**: CLI 명령은 `--period` 옵션으로 조회 기간(24h / 7d / 30d)을 지정할 수 있어야 하며, 미지정 시 24h가 기본값이다.
- **FR-003**: CLI 명령은 `--type` 옵션으로 지표 유형(search-quality / memory-quality / system / all)을 선택할 수 있어야 하며, 미지정 시 all이다.
- **FR-004**: CLI 출력은 터미널에서 가독성 높은 포맷(섹션 헤더, 들여쓰기, 단위 표시)을 사용해야 하며, 색상·이모지 없이도 이해 가능해야 한다.
- **FR-005**: `get_telemetry_summary` MCP 도구는 호출한 에이전트의 owner_id(ALS context)로 필터링된 검색 품질 지표와 메모리 품질 지표를 하나의 응답으로 반환해야 한다. owner_id가 없는 경우(null)에는 글로벌 집계를 반환한다.
- **FR-006**: `get_telemetry_summary` 도구는 `period` 파라미터(24h / 7d / 30d, 기본값 24h)를 받아야 한다.
- **FR-007**: MCP 도구는 기존 도구들과 동일하게 `executeTool` 경유로 호출되어야 한다. `executeTool`은 ALS context(requestId, ownerId)를 설정하여 동일 요청 내 다른 도구 호출(recall, remember 등)이 올바른 owner_id로 텔레메트리에 기록되도록 한다. `get_telemetry_summary` 자체는 읽기 전용 진단 도구이므로 `GetIntrospectionSummaryTool`과 동일하게 별도 `record()` 호출을 하지 않는다.
- **FR-008**: CLI와 MCP 도구는 기존 `TelemetryService`의 집계 메서드를 재사용해야 하며, 별도 집계 로직을 추가하지 않는다.
- **FR-009**: DB 오류 또는 마이그레이션 미실행 상태에서, CLI는 비정상 exit code와 원인 메시지를 출력하고, MCP 도구는 에러 응답을 반환하되 에이전트 세션을 중단시키지 않아야 한다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: CLI 명령 실행부터 결과 출력까지 2초 이내에 완료된다 (DB 10만 건 기준).
- **SC-002**: `get_telemetry_summary` MCP 도구 응답 시간이 2초 이내다.
- **SC-003**: CLI와 MCP 도구 모두 신규 집계 로직 추가 없이 기존 `TelemetryService` 메서드를 재사용한다.
- **SC-004**: CLI는 서버 프로세스 없이 독립 실행 가능하며, `DB_PATH` 환경 변수 또는 기본 경로만 있으면 동작한다.

## Clarifications

### Session 2026-03-29

- Q: `get_telemetry_summary`가 호출한 에이전트 자신의 데이터만 반환해야 하는가, 아니면 글로벌 데이터를 반환해야 하는가? → A: 호출한 에이전트의 owner_id로 필터링된 데이터만 반환 (Option A)

## Assumptions

- DB 경로는 기존 `DB_PATH` 환경 변수를 따른다.
- MCP 도구는 `get_telemetry_summary` 단일 도구로 추가한다 (4개 HTTP 엔드포인트를 각각 도구로 분리하지 않음).
- CLI는 `package.json` scripts에 `telemetry`로 등록한다 (`npm run telemetry`).
- CLI 출력 포맷은 텍스트 전용이다 (JSON 출력 옵션은 이 스펙 범위 밖).
- `get_telemetry_summary`는 권한 제한 없이 모든 에이전트에 노출된다. 데이터 범위는 ALS context의 owner_id로 자동 필터링되므로 에이전트는 자신의 지표만 볼 수 있다.
- `memory-quality` 지표는 기간 파라미터를 무시한다 (006 spec과 동일).
