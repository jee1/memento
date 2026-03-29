# Tasks: Sleep Consolidation

**Input**: Design documents from `/specs/005-sleep-consolidation/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Constitution I (Test-First)**: 모든 구현 태스크 전에 실패하는 테스트를 먼저 작성한다 (Red-Green-Refactor).

**Organization**: User Story 단위로 구성. Phase A(기반)→B(US1)→C(US2)→D(US3)→E(폴리시) 순서.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 병렬 실행 가능 (다른 파일, 의존성 없음)
- **[Story]**: 해당 User Story (US1, US2, US3)

---

## Phase 1: Setup (공유 인프라 준비)

**Purpose**: 신규 도메인 디렉토리 구조 생성

- [x] T001 `packages/memento-core/src/domains/consolidation/` 디렉토리 구조 생성 (`services/`, `repositories/`, `index.ts` 스텁)
- [x] T002 [P] `packages/memento-core/src/infrastructure/scheduler/jobs/sleep-consolidation-batch-job.ts` 빈 파일 생성 (스텁)
- [x] T003 [P] `packages/memento-core/src/domains/consolidation/index.ts` 공개 API export 스텁 생성

---

## Phase 2: Foundational — DB 스키마 + 타입 (모든 User Story 선행 조건)

**Purpose**: `is_consolidated` 컬럼 마이그레이션 + TypeScript 타입 동기화. 이 Phase 완료 전에는 어떤 US도 시작 불가.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 TS 마이그레이션 `packages/memento-core/src/infrastructure/database/database/migration/migrations/025-memory-item-is-consolidated.ts` — 컬럼·인덱스 멱등 적용 (고아 SQL `database/migrations/` 경로는 사용하지 않음)
- [x] T005 `packages/memento-core/src/infrastructure/database/database/schema.sql` 동기화 — `is_consolidated` 컬럼 + 인덱스 추가 (data-model.md §Migration 참조)
- [x] T006 `packages/memento-core/src/shared/types/index.ts`의 `MemoryItem`에 `isConsolidated?: boolean` 반영 (선택 필드; recall 매핑은 필요 시 확장)
- [x] T007 [P] `is_consolidated` 읽기/쓰기는 `ConsolidationRepository` 및 `initializeDatabase` 보강 경로에서 처리 (core_memory 테이블용 리포지토리와 별개)
- [x] T008 [P] `packages/memento-core/src/shared/types/` 에 `ConsolidationCluster`, `SleepConsolidationRunResult` 인터페이스 추가 (data-model.md §Entity Definitions 참조)
- [x] T009 마이그레이션 적용 확인: `npm run db:migrate -w @memento/core` 실행 후 `npm run db:check-migration` 통과 확인
- [x] T010 Quality gate: `npm run type-check` 통과 확인

**Checkpoint**: `npm run type-check` 통과 → User Story 구현 시작 가능

---

## Phase 3: User Story 1 — 에피소딕 → 시맨틱 자동 증류 (Priority: P1) 🎯 MVP

**Goal**: `is_consolidated=FALSE` 에피소딕들을 클러스터링하여 시맨틱 기억으로 통합

**Independent Test**: 에피소딕 10개 저장 후 `SleepConsolidationService.run()` 호출 → 시맨틱 1개 이상 생성 + 에피소딕 `is_consolidated=TRUE` 확인

### Tests for User Story 1 (Constitution I — Write FIRST, ensure FAIL before implementation)

- [x] T011 [P] [US1] `packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.spec.ts` 작성 — 클러스터링 대상 쿼리(is_consolidated=FALSE, pinned=FALSE, episodic), is_consolidated 업데이트 쿼리 테스트 (실패 확인 후 진행)
- [x] T012 [P] [US1] `packages/memento-core/src/domains/consolidation/services/clustering-service.spec.ts` 작성 — 유사 에피소딕 10개 → 1클러스터, consolidated/pinned 항목 제외, 최소 5개 미달 건너뜀, owner_id 격리 테스트 (실패 확인)
- [x] T013 [P] [US1] `packages/memento-core/src/domains/consolidation/services/summarization-service.spec.ts` 작성 — LLM fallback(API 키 없음 → importance 최고 에피소딕 content 반환), LLM mock 요약 생성 테스트 (실패 확인)
- [x] T014 [US1] `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.spec.ts` 작성 — 정상 플로우(semantic 생성 → memory_relation 저장 → is_consolidated 마킹), 시맨틱 저장 실패 시 마킹 없음(FR-003 순서), 클러스터 실패 시 다음 클러스터 계속(FR-009), pinned 변경 없음 테스트 (실패 확인)

### Implementation for User Story 1

- [x] T015 [US1] `packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.ts` 구현 — 클러스터링 대상 에피소딕 조회(최근 30일 기본, `CONSOLIDATION_LOOKBACK_DAYS` 환경변수), `is_consolidated` + `importance` 업데이트 쿼리 (T011 테스트 통과 목표)
- [x] T016 [P] [US1] `packages/memento-core/src/domains/consolidation/services/clustering-service.ts` 구현 — `memory_embedding` 테이블에서 임베딩 조회, 코사인 유사도 greedy 클러스터링, `CONSOLIDATION_SIMILARITY_THRESHOLD` 환경변수 지원(기본 0.75), owner_id 격리 (T012 테스트 통과 목표)
- [x] T017 [P] [US1] `packages/memento-core/src/domains/consolidation/services/summarization-service.ts` 구현 — LLM API 키 유무 감지, LLM 경로(OpenAI/Gemini) + extractive fallback, 오류 시 fallback 자동 전환 (T013 테스트 통과 목표)
- [x] T018 [US1] `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.ts` 구현 — 클러스터링→시맨틱 저장→`memory_relation`(`extracted_from`/`supported_by`)→에피소딕 마킹 순서 오케스트레이션, `SleepConsolidationRunResult` 반환 (T014 테스트 통과 목표)
- [x] T019 [US1] `packages/memento-core/src/domains/consolidation/index.ts` 완성 — `SleepConsolidationService`, `ClusteringService`, `SummarizationService` export
- [x] T020 [US1] Quality gate: `npm run lint -- --fix && npm run type-check && npm test` 통과 확인

**Checkpoint**: `SleepConsolidationService.run()` 단독 호출로 에피소딕→시맨틱 증류 동작 확인 → MVP 완료

---

## Phase 4: User Story 2 — 실시간 성능 무영향 (Priority: P2)

**Goal**: consolidation이 오프라인 배치로 실행되어 recall/remember 응답 시간에 10% 이내 영향만 미침

**Independent Test**: consolidation 실행 중 recall 10회 호출 → 평균 레이턴시가 미실행 시 대비 10% 이내

### Tests for User Story 2

- [x] T021 [P] [US2] `packages/memento-core/src/infrastructure/scheduler/jobs/sleep-consolidation-batch-job.spec.ts` 작성 — 배치 잡 실행 시 `SleepConsolidationService.run()` 호출 확인, 로그 기록 확인 (실패 확인)
- [x] T022 [P] [US2] `packages/memento-core/src/test/test-sleep-consolidation-isolation.spec.ts` 시나리오 테스트 스텁 작성 — consolidation 실행 중 recall 병렬 호출 레이턴시 측정 시나리오 (SC-002)

### Implementation for User Story 2

- [x] T023 [US2] `packages/memento-core/src/infrastructure/scheduler/jobs/sleep-consolidation-batch-job.ts` 구현 — `SleepConsolidationService` 호출, `FileLogger` 구조화 로그(FR-008), `SLEEP_CONSOLIDATION_INTERVAL_MS` 환경변수(기본 24h) (T021 테스트 통과 목표)
- [x] T024 [US2] `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` 수정 — `SleepConsolidationBatchJob` 등록 및 스케줄 설정 (Phase E plan 참조)
- [x] T025 [US2] `packages/memento-core/src/bootstrap.ts` 수정 — `SleepConsolidationService` 의존성 주입 및 서비스 초기화
- [x] T026 [US2] `packages/memento-core/src/test/test-sleep-consolidation-isolation.spec.ts` 시나리오 테스트 구현 및 실행 — SC-002 검증(레이턴시 10% 이내)
- [x] T027 [US2] Quality gate: `npm run lint -- --fix && npm run type-check && npm test` 통과 확인

**Checkpoint**: 배치 스케줄러에 등록되어 자동 실행 가능, recall 성능 영향 없음 확인

---

## Phase 5: User Story 3 — 추적 가능한 통합 이력 (Priority: P3)

**Goal**: Admin API로 수동 실행 및 결과 조회 가능. 생성된 시맨틱에서 소스 에피소딕 추적 가능.

**Independent Test**: `POST /admin/consolidation/run` 호출 → 응답에 `clustersProcessed`, `semanticsCreated`, `episodicsConsolidated` 포함 확인. 생성된 시맨틱의 `origin_source`에서 `source_episodic_ids` 확인 가능.

### Tests for User Story 3

- [x] T028 [P] [US3] `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.spec.ts` 추가 — `origin_source` JSON에 `source_episodic_ids` 배열 포함 확인, `memory_relation` `extracted_from` 링크 생성 확인 테스트 (실패 확인)
- [x] T029 [P] [US3] `packages/memento-server/src/server/routes/admin.routes.spec.ts` 작성(또는 기존에 추가) — `POST /admin/consolidation/run` 응답 스펙(`contracts/admin-api.md`) 검증, dryRun 파라미터 동작, 동시 실행 409 응답 테스트 (실패 확인)

### Implementation for User Story 3

- [x] T030 [US3] `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.ts` 수정 — 시맨틱 저장 시 `origin_source` JSON에 `source_episodic_ids`, `cluster_size`, `summarization_method` 포함 (T028 테스트 통과 목표)
- [x] T031 [US3] `packages/memento-server/src/server/routes/admin.routes.ts` 수정 — `POST /admin/consolidation/run` 엔드포인트 추가 (`contracts/admin-api.md` 스펙 준수, 동시 실행 방지, dryRun/ownerIdFilter 지원) (T029 테스트 통과 목표)
- [x] T032 [US3] Quality gate: `npm run lint -- --fix && npm run type-check && npm test` 통과 확인

**Checkpoint**: Admin API로 수동 실행 및 결과 추적 가능, 모든 US 독립 동작 확인

---

## Phase 6: 시나리오 테스트 + 폴리시

**Purpose**: SC-001, SC-004, SC-005 검증 + 최종 품질 확인

- [x] T033 `packages/memento-core/src/test/test-sleep-consolidation.spec.ts` 시나리오 테스트 작성 및 실행
  - SC-001: 동일 주제 에피소딕 10개 → consolidation 후 recall 에피소딕 수 40% 이상 감소 검증
  - SC-003: 생성된 시맨틱 기억의 content가 소스 에피소딕들의 핵심 키워드를 포함하는지 검증 (extractive fallback: 최고 importance 에피소딕 content 일치 확인; LLM: 핵심 키워드 포함 확인)
  - SC-004: 에피소딕 500개 기준 배치 120초 이내 완료 검증
  - SC-005: 핀된 기억 consolidation 전후 변경 없음 검증
- [x] T034 [P] 엣지 케이스 검증: 모든 에피소딕이 핀된 경우 정상 종료, 임베딩 없는 에피소딕 제외, 크래시 복구(is_consolidated 미마킹 항목 재처리) 확인
- [x] T035 [P] `CLAUDE.md` `Recent Changes` 섹션 업데이트 — 005-sleep-consolidation 항목 추가
- [x] T036 최종 빌드 검증: `npm run build && npm run lint && npm run type-check && npm test` 전체 통과

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
  → Phase 2 (Foundational: DB + Types) ← BLOCKS 모든 US
    → Phase 3 (US1: 증류 핵심 로직) ← MVP
      → Phase 4 (US2: 배치 격리) ← US1 완료 후
        → Phase 5 (US3: Admin API + 이력) ← US1 완료 후, US2와 병렬 가능
          → Phase 6 (시나리오 + 폴리시)
```

### User Story Dependencies

- **US1 (P1)**: Phase 2 완료 후 시작 가능. 다른 US에 의존 없음
- **US2 (P2)**: Phase 2 완료 + US1 완료 후 시작 (배치 잡이 SleepConsolidationService 사용)
- **US3 (P3)**: Phase 2 완료 + US1 완료 후 시작. US2와 병렬 가능

### Within Each User Story (Constitution I 준수)

1. 테스트 작성 → 실패 확인 → 구현 → 테스트 통과 → 리팩터 (Red-Green-Refactor)
2. Repository → Service → Orchestrator → Integration 순서
3. Quality gate (`lint + type-check + test`) 각 US 완료 후 통과 필수

### Parallel Opportunities

- T011, T012, T013 동시 실행 가능 (서로 다른 파일)
- T016, T017 동시 구현 가능 (T015 완료 후)
- T021, T022 동시 작성 가능
- US2와 US3의 테스트 작성(T028, T029) 동시 진행 가능

---

## Parallel Example: User Story 1

```bash
# Tests: 동시 작성 가능 (모두 다른 파일)
T011: consolidation-repository.spec.ts
T012: clustering-service.spec.ts
T013: summarization-service.spec.ts

# Implementation: T015 완료 후 T016/T017 병렬 가능
T015: consolidation-repository.ts
T016 + T017 병렬: clustering-service.ts + summarization-service.ts
T018: sleep-consolidation-service.ts (T016, T017 완료 후)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001~T003)
2. Phase 2: Foundational (T004~T010) — CRITICAL
3. Phase 3: US1 Tests (T011~T014) → 실패 확인
4. Phase 3: US1 Implementation (T015~T020)
5. **STOP and VALIDATE**: `SleepConsolidationService.run()` 단독 동작 확인
6. MVP 완료 → Phase 4, 5로 확장

### Incremental Delivery

1. Setup + Foundational → 타입 기반 완성
2. US1 → 에피소딕→시맨틱 증류 동작 (MVP)
3. US2 → 배치 자동화로 운영 가능
4. US3 → Admin API로 운영 가시성 확보

---

## Notes

- `SleepConsolidation*` prefix 일관 사용 (기존 `ConsolidationScoreWorker`와 명확히 구분)
- `is_consolidated` 마킹은 반드시 시맨틱 저장 성공 후 실행 (FR-003, 자기수복 특성)
- `owner_id` 필드로 agent_id 범위 격리 (memory_item에 agent_id 컬럼 없음)
- `memory_relation`의 `extracted_from`/`supported_by` 기존 relation type 재사용 (신규 테이블 없음)
- [P] tasks = 다른 파일, 의존성 없음 → 병렬 실행 가능
