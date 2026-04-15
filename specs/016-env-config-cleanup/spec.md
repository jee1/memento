# Feature Specification: Environment Config Cleanup

**Feature Branch**: `016-env-config-cleanup`  
**Created**: 2026-04-14  
**Status**: Ready for Implementation  
**Input**: User description: "Issue #153: 환경변수(.env) 관리 정리 — env.example 동기화 및 분산 구조 개선"

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - 온보딩 가능한 환경변수 기준 정립 (Priority: P1)

신규 기여자는 저장소를 처음 클론한 뒤 `env.example`만 보고도 필요한 환경설정을 빠짐없이 구성할 수 있어야 한다.

**Why this priority**: 환경변수 기준이 맞지 않으면 개발 시작 자체가 실패하거나 잘못된 기본값으로 동작하여 모든 후속 작업에 영향을 준다.

**Independent Test**: 비어 있는 로컬 환경에서 `env.example` 기반으로 `.env`를 구성한 뒤 지원되는 실행 경로별(`memento` CLI, `memento-mcp-server`, `http-server`) 적용 규칙에 따라 필수 항목 누락 없이 시작 가능한지 확인하면 독립적으로 검증된다.

**Acceptance Scenarios**:

1. **Given** 신규 기여자가 저장소를 클론한 상태, **When** `env.example`를 기준으로 `.env`를 생성할 때, **Then** 필수 설정 항목과 기본값/가이드가 명확히 제공된다.
2. **Given** 기존 `.env`에 최신 설정 항목이 추가된 상태, **When** `env.example`를 점검할 때, **Then** 동일 범주의 설정 항목이 누락 없이 동기화된다.

---

### User Story 2 - 에이전트 환경변수 출처 단일화 (Priority: P2)

유지보수자는 에이전트 관련 환경변수가 루트와 `services/agent`에 중복 정의되지 않고, 어느 파일이 기준인지 즉시 파악할 수 있어야 한다.

**Why this priority**: 이중 관리가 남아 있으면 배포/로컬 실행 시 다른 값이 적용되어 재현 불가 장애가 발생할 수 있다.

**Independent Test**: 에이전트 관련 환경변수 목록을 비교해 동일 의미 변수의 중복 정의가 제거되었고, 기준 파일/네이밍 규칙이 문서화되었는지 확인하면 독립 검증이 가능하다.

**Acceptance Scenarios**:

1. **Given** 루트 `.env`와 `services/agent` 환경설정 파일에 동일 의미 변수가 존재하던 상태, **When** 정리 정책을 적용하면, **Then** 중복 없이 단일 기준으로 관리된다.
2. **Given** 에이전트 설정 파일명이 실제 역할과 불일치한 상태, **When** 파일명 또는 운영 규칙을 정리하면, **Then** 파일명만으로 용도를 오해하지 않는다.

---

### User Story 3 - 보안 필수 변수 가시성 강화 (Priority: P3)

운영 담당자는 보안 민감 환경변수의 필수 여부와 위험도를 템플릿에서 즉시 인지하고 누락 없이 설정해야 한다.

**Why this priority**: 보안 변수 누락은 즉시 취약점으로 이어질 수 있어 기능 개선보다 우선순위가 낮더라도 반드시 명확히 안내되어야 한다.

**Independent Test**: 템플릿 주석만 검토해도 프로덕션 필수 변수와 위험 옵션 경고를 식별할 수 있으면 독립적으로 검증된다.

**Acceptance Scenarios**:

1. **Given** 운영자가 `env.example`를 읽는 상황, **When** 보안 관련 항목을 확인하면, **Then** 프로덕션 필수 설정 항목이 명시적으로 표시된다.
2. **Given** 비보안 옵션 사용 가능성이 있는 상황, **When** 해당 옵션을 확인하면, **Then** 위험성과 사용 제한 조건이 함께 안내된다.

---

### Edge Cases
- 사용자가 기존 `.env`에만 존재하는 임시/로컬 전용 변수를 보유한 경우, 표준 템플릿 동기화가 해당 변수를 강제로 삭제하지 않아야 한다.
- 루트와 `services/agent`에 이름이 다르지만 의미가 같은 변수가 있는 경우, 마이그레이션 안내 없이 이름만 바꾸면 안 된다.
- 필수 보안 변수에 기본값을 둘 수 없는 경우, 비어 있는 템플릿 값과 명시적 설명을 함께 제공해야 한다.
- 문서상 권장값과 실제 런타임 기본값이 다를 때, 사용자에게 우선 적용 규칙(명시값 우선/기본값 적용)을 설명해야 한다.

## Requirements *(mandatory)*

**Security Scope Note**: 본 기능의 보안 범위는 HTTP admin 관련 환경변수(`ADMIN_API_KEY`, insecure admin 옵션)에 한정하며, MCP 도구 계약 자체 변경은 범위에서 제외한다.

### Functional Requirements

- **FR-001**: 시스템은 루트 `env.example`에 현재 프로젝트 실행에 필요한 공통 환경변수 항목을 누락 없이 제공해야 한다.
- **FR-002**: 시스템은 `env.example`의 각 항목에 대해 기본값, 빈 값 허용 여부, 사용 목적을 구분 가능하게 표현해야 한다.
- **FR-003**: 시스템은 루트 `.env`와 에이전트 환경설정 파일 간 중복되거나 충돌하는 에이전트 관련 변수의 기준 소스를 단일화해야 한다.
- **FR-004**: 시스템은 `services/agent` 환경설정 템플릿 파일의 명칭과 실제 역할이 일치하도록 정리해야 한다.
- **FR-005**: 시스템은 `ADMIN_API_KEY`와 같은 보안 중요 변수에 대해 프로덕션 필수 여부를 명시해야 한다.
- **FR-006**: 시스템은 보안 위험이 있는 옵션(예: insecure admin 허용)에 대해 위험 경고와 사용 조건을 템플릿에 명시해야 한다.
- **FR-007**: 시스템은 변경된 환경변수 구조가 신규 기여자 온보딩 절차에서 바로 이해되도록 관련 안내 문구를 제공해야 한다.
- **FR-008**: 시스템은 기존 사용자 설정을 파괴하지 않는 방식으로 마이그레이션 또는 전환 안내를 제공해야 한다.
- **FR-009**: 시스템은 환경변수 문서와 실제 로딩 경로 간 불일치를 확인할 수 있는 검증 가능한 기준을 제공하고, 실행 경로별 로딩 규칙 차이를 명시해야 한다.

### Key Entities *(include if feature involves data)*

- **Environment Variable Definition**: 변수명, 기본값 정책(고정/비움), 민감도(일반/보안), 적용 범위(루트/에이전트/공통), 설명을 가진 설정 단위.
- **Environment Template File**: `env.example` 또는 에이전트 템플릿 파일처럼 변수 정의를 담는 문서형 파일.
- **Configuration Source Policy**: 동일 의미 변수의 단일 기준 소스와 우선순위 규칙을 정의하는 정책 항목.
- **Security Requirement Annotation**: 변수별 프로덕션 필수 여부와 위험 경고 문구를 나타내는 메타 정보.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 신규 기여자가 템플릿 파일만 읽고 30분 이내에 로컬 실행 가능한 `.env`를 완성할 수 있다.
- **SC-002**: 공통/에이전트 변수 사전 점검 시 동일 의미 변수의 중복 정의가 0건이어야 한다.
- **SC-003**: 보안 중요 변수 목록에서 프로덕션 필수 표시 누락이 0건이어야 한다.
- **SC-004**: 배포 전 체크리스트에 환경변수 관련 검증 항목과 측정 기준이 100% 문서화되어 운영자가 동일 기준으로 점검할 수 있다.
