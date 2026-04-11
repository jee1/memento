---

description: "Task list for 012-fix-memory-structuring — memory structuring pipeline fixes"
---

# Tasks: Memento 기억 구조화 파이프라인 수정

**Input**: Design documents from `/home/jee1lee/git/memento/specs/012-fix-memory-structuring/`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md)

**Tests**: **포함** — [plan.md](./plan.md) Constitution Check I (Test-First MUST) 및 각 구현 단계별 실패 테스트 선행.

**Organization**: 사용자 스토리( spec.md ) 우선순위(P1→P3)별 페이즈. 모노레포 경로는 `@memento/core` / `memento-server` 기준.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 미완료 태스크와 파일 충돌 없이 병렬 실행 가능
- **[Story]**: US1~US5 ( spec.md 사용자 스토리 매핑)
- 설명에 **정확한 파일 경로** 포함

## Path Conventions (this repo)

- Core: `packages/memento-core/src/`
- Server: `packages/memento-server/src/`
- 루트: `env.example`, `npm` 워크스페이스

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 환경·품질 게이트 기준선 확보

**Goal**: 구현 전 동일한 의존성·린트·테스트 베이스라인

**Independent Test**: `npm run lint && npm run type-check && npm test` 가 현재 브랜치에서 통과(또는 알려진 기준)

- [X] T001 Document new and changed env vars in `env.example` at repo root (`CONSOLIDATION_MIN_CLUSTER_SIZE`, `CONSOLIDATION_LOOKBACK_DAYS`, `FORGETTING_CLEANUP_INTERVAL_MS`, `SOFT_DELETE_GRACE_PERIOD_DAYS`, `SLEEP_CONSOLIDATION_INTERVAL_MS` 등 — defaults per `plan.md`)
- [X] T002 [P] Run `npm install` at repo root and capture baseline: `npm run lint && npm run type-check && npm test`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: P1 사용자 스토리(US1·US2) 전에 완료해야 하는 스키마·스케줄·클러스터·후보 쿼리 기반

**⚠️ CRITICAL**: User Story 페이즈(US1~)는 이 페이즈 완료 후 시작

**Checkpoint**: Migration 030 적용 가능, 공고화 스케줄이 망각 정리보다 빈번, 클러스터 기본값·룩백·후보 필터가 plan과 일치

- [X] T003 Create migration `packages/memento-core/src/infrastructure/database/database/migration/migrations/030-triple-extraction-fields.ts` and sync `packages/memento-core/src/infrastructure/database/database/schema.sql` (`triple_extracted`, `triple_extracted_status`, `triple_extraction_metadata`; idempotent column add per plan)
- [X] T004 [P] Add failing-then-pass migration tests in `packages/memento-core/src/infrastructure/database/database/migration/migrations/030-triple-extraction-fields.spec.ts` (up/down/validate column presence)
- [X] T005 Implement env-based defaults in `packages/memento-core/src/domains/consolidation/services/clustering-service.ts` (`CONSOLIDATION_MIN_CLUSTER_SIZE` default 2, `getSimilarityThreshold()` default 0.65)
- [X] T006 [P] Extend tests in `packages/memento-core/src/domains/consolidation/services/clustering-service.spec.ts` for default and overridden env behavior
- [X] T007 Adjust intervals in `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` (`sleepConsolidationInterval` default 1h, `FORGETTING_CLEANUP_INTERVAL_MS` default 24h)
- [X] T008 [P] Extend tests in `packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts` for default intervals
- [X] T009 Update `packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.ts`: `getLookbackDays()` default 90d + `CONSOLIDATION_LOOKBACK_DAYS`; `findEpisodicCandidates()` add `(is_deleted IS NULL OR is_deleted = 0)` filter
- [X] T010 [P] Extend tests in `packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.spec.ts` for lookback and deleted filter

**Checkpoint**: Foundation ready — US1/US2 implementation can proceed

---

## Phase 3: User Story 1 — 에피소딕이 시맨틱으로 공고화된다 (Priority: P1) 🎯 MVP

**Goal**: Sleep consolidation이 시맨틱을 생성·병합하고, 중복 시맨틱을 재요약 병합으로 방지 (FR-001, FR-002, SC-001, SC-003, SC-004)

**Independent Test** (스펙 그대로): **FR-001·수용 시나리오** — 90일 내 같은 주제 에피소딕 **2개 이상** 저장 후 공고화 시 시맨틱 생성·병합. **US1 독립 테스트** — 관련 에피소딕 **3개 이상** 저장 후 **1시간 이내** 시맨틱 생성 확인 가능. 재공고화 시 기존 시맨틱 UPDATE·INSERT 생략·`semanticsMerged` 반영.

### Tests for User Story 1 (Test-First)

- [X] T011 [US1] Add failing scenario/unit tests in `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.spec.ts` and/or `packages/memento-core/src/infrastructure/scheduler/jobs/sleep-consolidation-batch-job.spec.ts` for: merge-on-≥0.85, fallback on summarization failure, **concurrent `run()` while a consolidation is in-progress is rejected/no-op**, and **lookback period > TTL — only records still in DB are processed, no extra candidates appear** (spec.md 엣지 케이스)

### Implementation for User Story 1

- [X] T012 [P] [US1] Add `findSemanticsByOwner()` / semantic listing helpers needed for merge in `packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.ts`
- [X] T013 [US1] Implement re-summarize merge loop, `origin_source` merge, `semanticsMerged` counter, INSERT skip, and **in-progress guard** (no overlapping runs per plan Phase B2) in `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.ts`
- [X] T014 [US1] Make T011 tests pass; ensure merge failure falls back to independent INSERT without corrupting existing semantic (plan Risk table)

**Checkpoint**: US1 independently verifiable — duplicate semantic accumulation stopped under consolidation

---

## Phase 4: User Story 2 — 트리플 추출이 개별 에피소딕을 처리한다 (Priority: P1)

**Goal**: 트리플 추출 배치가 스키마 오류 없이 상태를 기록 (FR-003, FR-011, SC-002)

**Independent Test**: 단일 에피소딕 저장 후 배치 실행 → `triple_extracted`/`triple_extracted_status` 갱신, 로그에 스키마 누락 WARN 없음 ( spec.md US2 )

### Tests for User Story 2 (Test-First)

- [X] T015 [US2] Add failing integration/unit tests asserting triple extraction UPDATE paths succeed after Migration 030 — exercise SQL in `packages/memento-core/src/domains/memory/tools/remember-tool.ts` (episodic save 후 `triple_extraction_*` 스케줄 콜백 구간) and/or `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` (`triple_extraction_batch` job handler)

### Implementation for User Story 2

- [X] T016 [P] [US2] Align triple-extraction paths with Migration 030 columns where gaps remain: `packages/memento-core/src/domains/memory/tools/remember-tool.ts` (triple extraction scheduled callback), `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` (`triple_extraction_batch`), and any repository SQL under `packages/memento-core/src/infrastructure/database/repositories/` that updates `triple_extracted*` fields
- [X] T017 [US2] Green: T015 passes; confirm fresh `db:init` + `db:migrate` DB matches `schema.sql` for triple columns (FR-011)

**Checkpoint**: US2 independently verifiable — no missing-column warnings on normal operation

---

## Phase 5: User Story 3 — 삭제된 기억이 검색에서 완전히 제외된다 (Priority: P2)

**Goal**: TTL 소프트 삭제, 유예 후 하드 삭제, 모든 에이전트 조회 경로에서 제외 (FR-006, FR-007, SC-005)

**Independent Test**: 소프트 삭제 트리거 후 recall/search_local/memory_injection/공고화 후보에서 미포함; 유예 경과 후 물리 삭제 ( spec.md US3 )

### Tests for User Story 3 (Test-First)

- [X] T018 [US3] Add failing tests for `softDeleteMemory` / cleanup / hard delete sweep in `packages/memento-core/src/domains/forgetting/services/forgetting-policy-service.ts` (co-located `*.spec.ts` if present)

### Implementation for User Story 3

- [X] T019 [P] [US3] Create `packages/memento-core/src/infrastructure/database/database/migration/migrations/031-soft-delete-fields.ts` and sync `packages/memento-core/src/infrastructure/database/database/schema.sql` (`is_deleted`, `deleted_at`)
- [X] T020 [P] [US3] Add `031-soft-delete-fields.spec.ts` next to migration
- [X] T021 [US3] Reimplement `softDeleteMemory()` and grace-period hard delete in `packages/memento-core/src/domains/forgetting/services/forgetting-policy-service.ts` (`SOFT_DELETE_GRACE_PERIOD_DAYS`, pinned skip)
- [X] T022 [P] [US3] Add `is_deleted` filters to `packages/memento-core/src/infrastructure/database/repositories/core-memory-repository-sqlite.impl.ts`
- [X] T023 [P] [US3] Add `is_deleted` filters to `packages/memento-core/src/domains/search/algorithms/vector-search-engine.ts`
- [X] T024 [P] [US3] Add `is_deleted` filters to `packages/memento-core/src/domains/memory/services/memory-neighbor-service.ts` and memory recall/injection SQL paths (search `memory_item` under `packages/memento-core/src/domains/memory/` and `packages/memento-core/src/infrastructure/database/repositories/`)
- [X] T025 [US3] Green T018; add assertion tests that soft-deleted rows never appear in hybrid search / injection flows

**Checkpoint**: US3 independently verifiable — FR-006 satisfied for agent-facing queries

---

## Phase 6: User Story 4 — 중복 기억 저장 시 에이전트에게 경고한다 (Priority: P2)

**Goal**: `remember` 응답에 선택적 `similarity_warning`; 저장은 항상 성공; 검색 실패 시 경고 생략 (FR-008, SC-006)

**Independent Test**: 유사 내용 연속 저장 시 경고 포함; 질 다른 내용은 미포함; 실패 시 저장 성공 ( spec.md US4 )

**Depends on**: US3 query/filter behavior recommended before similarity search ( plan.md: D after C3 )

### Tests for User Story 4 (Test-First)

- [X] T026 [US4] Add failing tests in `packages/memento-core/src/domains/memory/tools/__tests__/remember-tool.spec.ts` for `similarity_warning` shape and ownerID null scope

### Implementation for User Story 4

- [X] T027 [US4] Post-insert vector search (same owner, ≥0.85) and attach `similarity_warning` in `packages/memento-core/src/domains/memory/tools/remember-tool.ts` (try/catch — never block save)
- [X] T028 [US4] Green T026 including edge cases from spec (검색 실패·느림 → 경고 생략)

**Checkpoint**: US4 independently verifiable

---

## Phase 7: User Story 5 — 운영자가 기억 구조화 상태를 모니터링할 수 있다 (Priority: P3)

**Goal**: `consolidation_quality` in telemetry summary + admin consolidation stats (FR-009, FR-010, **SC-007** — FR-009 다섯 항목 포함 `pipeline_error_count`; [plan.md](./plan.md) Spec traceability)

**Independent Test**: `get_telemetry_summary`에 블록 존재(다섯 번째 지표 포함); `GET /admin/stats/consolidation` 응답 필드 채움; 신규 설치는 0/null 안전 ( spec.md US5 )

### Tests for User Story 5 (Test-First)

- [X] T029 [US5] Add failing tests for `consolidation_quality` aggregation in `packages/memento-core/src/domains/telemetry/repositories/telemetry-repository.ts` (co-located or new `telemetry-repository.spec.ts`) including **`pipeline_error_count`** (최근 7일 `telemetry_events` 실패/오류 집계) 포함 5개 지표 전체

### Implementation for User Story 5

- [X] T030 [P] [US5] Implement `consolidation_quality` metrics in `packages/memento-core/src/domains/telemetry/repositories/telemetry-repository.ts`: `episodic_consolidation_rate`, `triple_extraction_success_rate`, `cluster_processing_efficiency` (from `telemetry_events`), `recent_semantic_count_7d`, **`pipeline_error_count`** (최근 7일 `telemetry_events` 실패/오류 건수 — FR-009 다섯 번째 지표, SC-007)
- [X] T031 [US5] Expose full `consolidation_quality` (including pipeline errors) in `packages/memento-core/src/domains/telemetry/tools/get-telemetry-summary-tool.ts` (null-safe)
- [X] T032 [P] [US5] Author or update `specs/012-fix-memory-structuring/contracts/admin-api-consolidation-stats.md` per [plan.md](./plan.md) Phase E3 and `spec.md` FR-010 (response shape, field names, nested objects); this contract is the source of truth for T033–T034
- [X] T033 [P] [US5] Add `GET /admin/stats/consolidation` in `packages/memento-server/src/server/routes/admin.routes.ts` per **T032** contract (weekly semantic series, triple status distribution, recent consolidation run summary, **pipeline error count/summary** aligned with T030)
- [X] T034 [US5] Add HTTP route tests in `packages/memento-server/src/server/routes/` (e.g. `admin.routes.spec.ts` or existing HTTP test pattern) asserting consolidation stats payload matches **T032** contract keys/shape (including pipeline error summary when applicable)

**Checkpoint**: US5 independently verifiable

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 문서·품질 게이트·스펙 동기화

- [X] T035 [P] Cross-check `docs/architecture/ko/memory-structuring-problem-analysis.md` against shipped behavior only if implementation diverged (minimal edits)
- [x] T036 Run full quality gates from repo root: `npm run lint && npm run type-check && npm test`
- [ ] T037 [P] Optional NFR: per [plan.md](./plan.md) Technical Context (클러스터당 < 5초 목표), add non-flaky mock-based test or documented verification note in `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.spec.ts` — skip strict wall-clock asserts if environment-dependent
- [ ] T038 Run [plan.md](./plan.md) **Release verification** (SC-001, SC-003, SC-004) on staging or production after pipeline fixes are deployed: record metrics snapshots / conclusions in PR, issue, or release notes (not a substitute for T029–T034 unit coverage)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2** → **Phase 3 (US1)** & **Phase 4 (US2)** can overlap after Phase 2 if staffed (US2 leans on T003–T004; US1 leans on T005–T010, T012–T014)
- **Phase 5 (US3)** after US1/US2 recommended (schema 031 + filters touch shared queries)
- **Phase 6 (US4)** after **Phase 5** ( plan: similarity search after `is_deleted` filters )
- **Phase 7 (US5)** after pipeline metrics are meaningful ( spec assumption — typically after US1–US4 ); **T032 before T033–T034**
- **Phase 8** after targeted user stories complete; **T038** after deploy to staging/production (can follow T036)

### User Story Dependencies

- **US1 (P1)**: After Phase 2 — no dependency on US2 for core merge logic (uses T009–T010 + consolidation services)
- **US2 (P1)**: After Phase 2 (Migration 030 in T003–T004)
- **US3 (P2)**: After Phase 2; preferably after US1/US2 stabilized
- **US4 (P2)**: After US3 (recommended: soft-delete filtering before similarity warning queries)
- **US5 (P3)**: After US1–US4 for meaningful metrics ( spec )

### Within Each User Story

- Tests (T011, T015, T018, T026, T029) before or in lockstep with implementation per Test-First
- T037 is optional polish after US1 stabilizes; **T038** is post-deploy validation (see plan Release verification)
- Migrations before services that rely on new columns
- Repository helpers before orchestration services

### Parallel Opportunities

- T002 parallel with doc-only T001
- T004 ∥ T006 ∥ T008 after T003,T005,T007 respectively (tests parallel)
- T012 parallel with parts of T013 only if different files — prefer T012 before T013
- T022 ∥ T023 ∥ T024 after T019–T021 (filter sweep)
- T030 ∥ T032 after E3 scope clear; **T033 ∥ T034 only after T032** (contract-first)

---

## Parallel Example: User Story 3 (query filters)

```bash
# After T021, launch filter tasks in parallel:
Task T022 — core-memory-repository-sqlite.impl.ts
Task T023 — vector-search-engine.ts
Task T024 — memory-neighbor-service.ts + remaining memory SQL paths
```

---

## Parallel Example: User Story 1

```bash
# After T011 written, sequential implementation:
Task T012 — consolidation-repository.ts (findSemanticsByOwner)
Task T013 — sleep-consolidation-service.ts (merge loop)
Task T014 — green tests
```

---

## Implementation Strategy

### MVP First (User Story 1 + foundational)

1. Complete Phase 1–2
2. Complete Phase 3 (US1) — core product value ( consolidation + merge )
3. **STOP and VALIDATE**: SC-001 / SC-004 — see [plan.md](./plan.md) Release verification and **T038** after deploy
4. Add Phase 4 (US2) for triple extraction parity on fresh installs

### Incremental Delivery

1. Foundation → US1 → US2 (both P1) → US3 → US4 → US5 → Polish
2. Each phase leaves system in testable state

### Suggested MVP Scope

- **Minimum**: Phase 1–2 + **Phase 3 (US1)** — episodic→semantic with merge; triple columns still need Phase 2 T003 for production DB health

- **Recommended MVP for spec P1 complete**: Phase 1–2 + **Phase 3 + Phase 4** (both P1 stories)

---

## Notes

- `[P]` = 다른 미완료 태스크와 파일 충돌 없을 때만 병렬
- Constitution IV: every phase exit should run lint, type-check, test
- MCP 계약: `remember`에만 선택적 필드 추가 (backward compatible)
- **스펙 일치**: FR-009와 SC-007 모두 공고화 품질 지표 5개를 요구 — `consolidation_quality`에 **파이프라인 오류 수** 포함 (FR-009 다섯 번째 지표)
- **용어**: [plan.md](./plan.md) “Terminology (spec ↔ implementation)” — 기억 주입 ↔ `memory_injection`, 검색 ↔ recall/search_local 등
- **SC-001 / SC-003 / SC-004**: 시간·플릿 기준은 [plan.md](./plan.md) Release verification + **T038**로 스테이징/프로덕션에서 확인
