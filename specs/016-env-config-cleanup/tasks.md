# Tasks: Environment Config Cleanup

**Input**: Design documents from `/specs/016-env-config-cleanup/`  
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: 이 기능은 설정 동작과 온보딩 경로에 영향을 주므로 테스트 작업을 포함한다.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 작업 대상 파일과 검증 스크립트 기반을 준비한다.

- [x] T001 기준 스펙/계획 산출물 최신화 확인 in `specs/016-env-config-cleanup/spec.md`, `specs/016-env-config-cleanup/plan.md`
- [x] T002 [P] 현재 환경변수 사용 지점 인덱싱 in `env.example`, `services/agent/`, `packages/`
- [x] T003 [P] 비교 검증용 체크리스트 기준 정리 in `specs/016-env-config-cleanup/contracts/config-consistency.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 사용자 스토리 구현 전 공통 기준을 고정한다.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 환경변수 단일 출처 정책 초안 작성 in `docs/guides/ko/` (필요 시 신규 문서)
- [x] T005 [P] 루트/에이전트 변수 매핑표 작성 in `specs/016-env-config-cleanup/research.md`
- [x] T006 [P] 보안 변수 라벨링 규칙 정의 in `specs/016-env-config-cleanup/contracts/config-consistency.md`
- [x] T007 테스트 대상 시나리오 확정 in `specs/016-env-config-cleanup/quickstart.md`
- [x] T008 [P] `data-model.md` 엔터티/규칙 동기화 검수 in `specs/016-env-config-cleanup/data-model.md`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 온보딩 가능한 환경변수 기준 정립 (Priority: P1) 🎯 MVP

**Goal**: `env.example`만으로 신규 기여자가 설정 누락 없이 시작할 수 있게 한다.

**Independent Test**: 신규 환경에서 템플릿 기반 `.env` 구성 후 실행 시 필수 설정 누락이 발생하지 않는다.

### Tests for User Story 1

- [x] T009 [P] [US1] 환경변수 템플릿 정합성 테스트 추가 in `packages/memento-server/src/server/env-config.spec.ts`
- [x] T010 [P] [US1] 온보딩 시나리오 테스트/검증 항목 추가 in `specs/016-env-config-cleanup/quickstart.md`

### Implementation for User Story 1

- [x] T011 [US1] 루트 템플릿 항목 동기화 in `env.example`
- [x] T012 [US1] 루트 템플릿 주석/기본값 정책 정리 in `env.example`
- [x] T013 [US1] 온보딩 설명 업데이트 in `README.md` 또는 `docs/guides/ko/`

**Checkpoint**: User Story 1 independently deliverable

---

## Phase 4: User Story 2 - 에이전트 환경변수 출처 단일화 (Priority: P2)

**Goal**: 에이전트 관련 환경변수의 기준 파일과 네이밍 규칙을 단일화한다.

**Independent Test**: 중복/충돌 변수 목록이 제거되고 기준 소스가 문서로 확인된다.

### Tests for User Story 2

- [x] T014 [P] [US2] 에이전트 변수 중복/충돌 검증 테스트 추가 in `packages/memento-server/src/server/env-config.spec.ts`
- [x] T015 [P] [US2] 파일 역할 정합성 검증 테스트 또는 체크 로직 추가 in `scripts/` 또는 `packages/`

### Implementation for User Story 2

- [x] T016 [US2] `services/agent/.env` 역할 정리 (rename 또는 정책 반영) in `services/agent/`
- [x] T017 [US2] `MEMENTO_AGENT_*`/`AGENT_*` 단일 출처 정책 반영 in `env.example`, `services/agent/`
- [x] T018 [US2] 로컬 `.env` 비파괴 전환 규칙 및 예외 케이스 문서화 in `docs/guides/ko/` 또는 `services/agent/README*`
- [x] T019 [US2] 변수 전환/호환 안내 문서화 in `docs/guides/ko/` 또는 `services/agent/README*`

**Checkpoint**: User Story 2 independently deliverable

---

## Phase 5: User Story 3 - 보안 필수 변수 가시성 강화 (Priority: P3)

**Goal**: 보안 민감 설정의 필수 여부와 위험 옵션 경고를 명확히 표시한다.

**Independent Test**: 템플릿만 읽어도 프로덕션 필수/위험 설정이 식별된다.

### Tests for User Story 3

- [x] T020 [P] [US3] `ADMIN_API_KEY` 미설정 시 admin 인증 런타임 동작 검증 테스트 추가 in `packages/memento-server/src/server/middleware/admin-auth.middleware.spec.ts`

### Implementation for User Story 3

- [x] T021 [US3] `ADMIN_API_KEY` 필수 표기 강화 in `env.example`
- [x] T022 [US3] insecure 옵션 경고 주석 강화 in `env.example`
- [x] T023 [US3] 보안 설정 안내 문서 반영 in `README.md` 또는 `docs/security/`

**Checkpoint**: User Story 3 independently deliverable

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 전체 정합성과 품질 게이트를 마무리한다.

- [x] T024 [P] FR-009 검증 기준(문서 vs 실제 로딩 경로) 점검 스크립트/체크 추가 in `scripts/` 또는 `packages/memento-server/`
- [x] T025 [P] 실행 경로별 `.env` 로딩 규칙 점검 및 문서화 (`memento`/`memento-mcp-server`/`http-server`) in `docs/guides/ko/` 또는 `README.md`
- [x] T026 [P] 배포 전 환경변수 검증 체크리스트 산출물 작성 in `docs/guides/ko/` 또는 `docs/operations/`
- [x] T027 [P] 스펙/플랜/태스크 traceability 점검 in `specs/016-env-config-cleanup/`
- [x] T028 graphify 코드그래프 재생성 실행 in repository root
- [x] T029 lint/type-check/test 실행 및 실패 항목 수정
- [x] T030 [P] plan 산출물과 동일하게 에이전트 컨텍스트 업데이트 스크립트 실행/기록 in `.specify/scripts/bash/update-agent-context.sh`, `AGENTS.md`

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3/4/5 → Phase 6
- US2/US3는 Phase 2 이후 병렬 진행 가능하나, 템플릿 기준 확정 전에는 T017 수행을 보류한다.
- 테스트 태스크는 각 사용자 스토리 구현 태스크보다 먼저 수행

## Parallel Opportunities

- T002, T003 병렬 가능
- T005, T006 병렬 가능
- 각 사용자 스토리 내 `[P]` 테스트 태스크 병렬 가능

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Setup + Foundational 완료
2. US1 테스트 작성 후 템플릿 동기화 구현
3. 온보딩 경로 검증

### Incremental Delivery

1. US1으로 기준 템플릿 확정
2. US2로 출처 단일화
3. US3으로 보안 가시성 강화
4. Cross-cutting 품질 게이트 통과
