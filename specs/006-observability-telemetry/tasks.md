---
description: "Task list for Observability & Telemetry (006)"
---

# Tasks: Observability & Telemetry

**Input**: Design documents from `/home/jee1lee/git/memento/specs/006-observability-telemetry/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/admin-api.md, quickstart.md

**Tests**: Constitution **I. Test-First (MUST)** 준수: 동일 페이즈 내에서 **해당 구현 직전**에 실패하는 테스트를 두고 Red–Green–Refactor. 아래 **Task ID 순서가 권장 실행 순서**이다.

**Organization**: 사용자 스토리별 페이즈. Foundational에 스키마·TelemetryService·MCP 계측을 두어 US1~US4 Admin API가 실제 데이터로 검증 가능.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일·선행 미완료 의존 없이 병렬 가능
- **[Story]**: 사용자 스토리(US1–US4) 페이즈에만 표기
- 설명에 수정/생성 파일의 **워크스페이스 기준 경로** 포함

## Path Conventions

- Core: `packages/memento-core/src/`
- Server: `packages/memento-server/src/server/`
- 스펙: `specs/006-observability-telemetry/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 환경·설정만 보강 (모노레포는 이미 존재)

- [X] T001 Add `TELEMETRY_RETENTION_DAYS`, `TELEMETRY_CLEANUP_INTERVAL_MS`, `TELEMETRY_STORE_QUERY_PLAINTEXT` to `env.example` at repository root

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 모든 사용자 스토리 전에 완료해야 하는 DB·도메인·계측·컨텍스트 전파

**⚠️ CRITICAL**: 이 페이즈가 끝나기 전에는 Admin API 사용자 스토리 구현을 시작하지 말 것

- [X] T002 [P] Define `EventType`, `Outcome`, `TelemetryEventInput`, `TelemetryEventRow`, `DailyMetricRow` in `packages/memento-core/src/domains/telemetry/types/telemetry.types.ts` per `specs/006-observability-telemetry/data-model.md`
- [X] T003 [P] Create migration `packages/memento-core/src/infrastructure/database/database/migration/migrations/027-telemetry-events.ts` (`telemetry_events` + indexes)
- [X] T004 [P] Create migration `packages/memento-core/src/infrastructure/database/database/migration/migrations/028-telemetry-daily-metrics.ts` (`telemetry_daily_metrics` + indexes + UNIQUE)
- [X] T005 Sync DDL: append `telemetry_events` and `telemetry_daily_metrics` definitions and indexes to `packages/memento-core/src/infrastructure/database/database/schema.sql` (T003·T004 DDL과 일치하도록 마이그레이션 확정 후 반영)
- [X] T006 [P] Add failing-first `packages/memento-core/src/domains/telemetry/repositories/telemetry-repository.spec.ts` (insert, upsert avg, p95 helper accuracy, `deleteExpiredEvents` — 마이그레이션 적용된 테스트 DB 사용)
- [X] T007 Implement `TelemetryRepository` to satisfy specs in `packages/memento-core/src/domains/telemetry/repositories/telemetry-repository.ts` per `specs/006-observability-telemetry/data-model.md` (UPSERT 공식·per-event extra_data 스키마), `specs/006-observability-telemetry/research.md`, and `contracts/admin-api.md`
- [X] T008 [P] Add failing-first `packages/memento-core/src/domains/telemetry/services/telemetry-service.spec.ts` (fire-and-forget, FR-011 no throw to caller, duplicate `content_hash` 24h) — `TelemetryRepository`는 mock/스텁으로 주입 가능
- [X] T009 Implement `TelemetryService` (`AsyncLocalStorage`, `runWithContext`, `record` via `setImmediate`, getters) in `packages/memento-core/src/domains/telemetry/services/telemetry-service.ts`
- [X] T010 Add domain barrel exports in `packages/memento-core/src/domains/telemetry/index.ts`
- [X] T011 Add `telemetryService` to `ServerServices`, instantiate with DB in `initializeServices` in `packages/memento-core/src/bootstrap.ts`
- [X] T012 Extend `ToolContext` / `createToolContextFromServerContext` to pass `telemetryService` in `packages/memento-core/src/tools/types.ts` and `packages/memento-core/src/context.ts`
- [X] T013 Wrap tool execution with `telemetryService.runWithContext(ownerId, fn)` in `packages/memento-core/src/tools/tool-registry.ts` or `packages/memento-core/src/tools/index.ts` `executeTool`, resolving `owner_id` per `spec.md` Clarifications: `owner_id`, `ownerId`, `context.owner_id`, `context.agent_id`, else `null`
- [X] T014 Add failing-first instrumentation integration spec `packages/memento-core/src/test/test-recall-telemetry.spec.ts` (or `packages/memento-core/src/domains/memory/tools/__tests__/telemetry-instrumentation.integration.spec.ts`): recall/remember emit events, shared `request_id` per tool call, telemetry DB failure does not fail tool (T010–T013 배선·래핑 동작을 통합적으로 검증)
- [X] T015 [P] Instrument recall flow per FR-001/FR-005/FR-006 in `packages/memento-core/src/domains/memory/tools/recall-tool.ts` and needed files under `packages/memento-core/src/domains/search/algorithms/`
- [X] T016 [P] Instrument remember per FR-002 in `packages/memento-core/src/domains/memory/tools/remember-tool.ts`
- [X] T017 [P] Instrument feedback per FR-003 in `packages/memento-core/src/domains/memory/tools/feedback-tool.ts`
- [X] T018 Emit `consolidation.performed` in `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.ts` per FR-004

**Checkpoint**: `npm run db:migrate -w @memento/core`, `npm run db:check-migration -w @memento/core`, 텔레메트리·계측 스펙 통과, recall/remember 기존 스펙 회귀 없음

---

## Phase 3: User Story 1 — 검색 품질 지표 (Priority: P1) 🎯 MVP

**Goal**: `GET /admin/telemetry/search-quality` (FR-007, SC-003)

**Independent Test**: `GET /admin/telemetry/search-quality?period=24h` 가 계약 JSON 필드를 200으로 반환

### Tests then implementation (User Story 1)

- [X] T019 [US1] Add failing-first search-quality route tests (contract shape, `period=7d`, empty DB 200 with nulls, invalid period 400) in `packages/memento-server/src/server/routes/admin.routes.spec.ts`; SC-003: in-memory fixture(약 1000건)에서 `GET /admin/telemetry/search-quality?period=24h` 1회가 **2000ms 미만** — **CI(`test:ci:server`·`test:ci:core`)에서도 실행** (Vitest 테스트 타임아웃 10s)
- [X] T020 [US1] Implement `GET /admin/telemetry/search-quality` in `packages/memento-server/src/server/routes/admin.routes.ts` using `serverServices.telemetryService.getSearchQuality` per `contracts/admin-api.md`

**Checkpoint**: quickstart §4

---

## Phase 4: User Story 2 — 메모리 품질 지표 (Priority: P2)

**Goal**: `GET /admin/telemetry/memory-quality` (FR-008); `period` 미적용(FR-013)

**Independent Test**: `type_distribution`, `duplicate_write_rate_24h`, relation/orphan 비율 JSON

### Tests then implementation (User Story 2)

- [X] T021 [US2] Add failing-first memory-quality tests (response shape, `owner_id` only — no `period`) in `packages/memento-server/src/server/routes/admin.routes.spec.ts`
- [X] T022 [US2] Implement `GET /admin/telemetry/memory-quality` in `packages/memento-server/src/server/routes/admin.routes.ts` per `contracts/admin-api.md`

**Checkpoint**: quickstart §5

---

## Phase 5: User Story 3 — 시스템 성능 지표 (Priority: P2)

**Goal**: `GET /admin/telemetry/system` (FR-009)

**Independent Test**: `tools.recall|remember|feedback`, `background_jobs.sleep_consolidation`; `telemetry_cleanup`는 Phase 7 후 완전

### Tests then implementation (User Story 3)

- [X] T023 [US3] Add failing-first system metrics tests (tool buckets, `period` validation, `background_jobs.*`에 `success_runs_24h`·`failure_runs_24h`·`avg_duration_ms` 필드 존재 또는 null 처리) in `packages/memento-server/src/server/routes/admin.routes.spec.ts`; SC-002 계측 오버헤드 본측정은 T030
- [X] T024 [US3] Implement `GET /admin/telemetry/system` with `period`/`owner_id` and `background_jobs` 확장 필드 per `contracts/admin-api.md` in `packages/memento-server/src/server/routes/admin.routes.ts`

**Checkpoint**: quickstart §6

---

## Phase 6: User Story 4 — 원시 이벤트 쿼리 (Priority: P3)

**Goal**: `GET /admin/telemetry/events` (FR-010)

### Tests then implementation (User Story 4)

- [X] T025 [US4] Add failing-first events endpoint tests (filters, pagination, limit max 100) in `packages/memento-server/src/server/routes/admin.routes.spec.ts`
- [X] T026 [US4] Implement `GET /admin/telemetry/events` in `packages/memento-server/src/server/routes/admin.routes.ts` per `contracts/admin-api.md`

**Checkpoint**: quickstart §7–§8

---

## Phase 7: Retention & Cleanup (FR-012, SC-005)

**Purpose**: raw 90일 보존·`telemetry_daily_metrics` 유지·스케줄 등록

**Last-run metadata**: `background_jobs.telemetry_cleanup`는 BatchScheduler가 잡 완료 시 기록하는 기존 패턴을 재사용하거나, 동일 DB에 scheduler 메타가 없으면 `consolidation.performed`와 같이 **telemetry 이벤트 또는 구조화 로그**로 마지막 성공 시각을 노출 가능함을 구현 시 한 가지 방식으로 선택해 `querySystemMetrics`와 맞출 것.

- [X] T027 [P] Add failing-first `packages/memento-core/src/infrastructure/scheduler/jobs/telemetry-cleanup-batch-job.spec.ts` (91일 이전 삭제, `telemetry_daily_metrics` 유지, 로깅)
- [X] T028 Implement `packages/memento-core/src/infrastructure/scheduler/jobs/telemetry-cleanup-batch-job.ts` calling `TelemetryRepository.deleteExpiredEvents` with `TELEMETRY_RETENTION_DAYS`
- [X] T029 Register job with `TELEMETRY_CLEANUP_INTERVAL_MS` default 86400000 in `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` and connect last-run/outcome to `GET /admin/telemetry/system` contract fields

**Checkpoint**: SC-005, US3 contract의 `telemetry_cleanup` 필드

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: SC-001~005 시나리오, export, 품질 게이트

- [X] T030 Add scenario `packages/memento-core/src/test/test-telemetry.ts` (또는 레포 Vitest 패턴에 맞는 `test-telemetry.spec.ts`) covering SC-001–SC-005 per `plan.md` Phase F including SC-002/SC-003 measurable thresholds
- [X] T031 Export minimal telemetry types/API from `packages/memento-core/src/index.ts` only if `packages/memento-server` or tests require it
- [X] T032 Run full quality gates at repository root `/home/jee1lee/git/memento` via `package.json`: `npm run lint`, `npm run type-check`, `npm test`, `npm run build`, `npm run test:search` per `plan.md`

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 → Phase 2 (blocks all US) → Phase 3–6 (US1–US4) → Phase 7 → Phase 8
```

### User Story Dependencies

| Story | Depends on | Notes |
|-------|------------|--------|
| US1 | Phase 2 | search 이벤트·집계 |
| US2 | Phase 2 | 스냅샷 쿼리 + write 이벤트 |
| US3 | Phase 2; Phase 7 권장 | `telemetry_cleanup` 완전 |
| US4 | Phase 2 | `queryEvents` |

### Within Each User Story

- `admin.routes.ts` / `admin.routes.spec.ts` 단일 파일 — 순차 커밋 권장

---

## Parallel Execution Examples

```text
T002, T003, T004 (types + migrations)
T006, T008 (spec files) after T005 — 서로 다른 파일
T015, T016, T017 (instrumentation) after T014 + T013
```

---

## Implementation Strategy

### MVP

1. Phase 1–2
2. Phase 3 (T019–T020)
3. 검증 후 확장

### Constitution I

각 구현 태스크 바로 앞의 테스트 태스크에서 **의도적으로 실패** 확인 후 구현한다.

---

## Notes

- FR-013: `memory-quality`는 `owner_id`만; `period`는 `search-quality`·`system`만
- Format: `- [X] Tnnn` + 스토리 페이즈에 `[USn]` + 파일 경로
- T006·T008 병렬 시 T008은 Repository mock 전제; 순차 시 T007 완료 후 T008 작성도 가능
- `querySystemMetrics`의 `background_jobs` 확장 필드는 `contracts/admin-api.md` Notes 및 Phase 7 메타 출처와 일치시킬 것
