# Implementation Plan: Observability & Telemetry

**Branch**: `006-observability-telemetry` | **Date**: 2026-03-29 | **Spec**: [spec.md](./spec.md)

## Summary

Memento 내부 동작(recall, remember, feedback, consolidation)에 이벤트 기반 텔레메트리를 추가하여 검색 품질, 메모리 품질, 시스템 성능을 정량적으로 측정한다. `TelemetryService`가 각 MCP 도구 호출에서 발생하는 이벤트를 fire-and-forget 방식으로 SQLite에 기록하고, HTTP admin API 4개 엔드포인트로 집계 지표를 제공한다. `AsyncLocalStorage`로 request_id를 전파하여 단일 호출 내 이벤트 추적이 가능하다.

## Technical Context

**Language/Version**: TypeScript (Node.js ≥ 20), ES modules
**Primary Dependencies**: better-sqlite3, zod, vitest (기존 의존성, 신규 추가 없음)
**Storage**: SQLite (better-sqlite3) — `telemetry_events` (027), `telemetry_daily_metrics` (028) 테이블 추가
**Testing**: vitest (unit `.spec.ts` + scenario `src/test/`)
**Target Platform**: Node.js 서버 (기존 memento-server)
**Project Type**: library + server (monorepo)
**Performance Goals**: recall/remember p95 latency 증가 ≤ 5ms (SC-002), admin API 응답 ≤ 2초 (SC-003)
**Constraints**: fire-and-forget 계측 (setImmediate), MCP 도구 계약 변경 없음, 신규 외부 의존성 없음
**Scale/Scope**: 단일 SQLite 인스턴스, 24시간 기준 수만 건 이하 이벤트

## Constitution Check

| 원칙 | 상태 | 비고 |
|------|------|------|
| I. Test-First Delivery | ✅ PASS | 자동화 테스트를 구현 직전에 두고 Red–Green–Refactor; `tasks.md` 실행 순서가 이를 따름 |
| II. Backward Compatibility | ✅ PASS | 기존 16개 MCP 도구 계약 변경 없음, admin 신규 엔드포인트만 추가 |
| III. Schema Migration Discipline | ✅ PASS | migration 027·028 및 schema.sql + TS 타입 동기화 |
| IV. Quality Gates | ✅ PASS | 각 Phase 완료 후 lint + type-check + test 통과 필수 |
| V. Observability & Failure Isolation | ✅ PASS | 이 기능 자체가 V 원칙의 구현. FR-011로 primary path 보호 |

## Project Structure

### Documentation (this feature)

```text
specs/006-observability-telemetry/
├── plan.md              ← 이 파일
├── research.md          ← Phase 0 완료
├── data-model.md        ← Phase 1 완료
├── quickstart.md        ← Phase 1 완료
├── contracts/
│   └── admin-api.md     ← Phase 1 완료
└── tasks.md             ← /speckit.tasks 로 생성 예정
```

### Source Code

```text
packages/memento-core/
├── src/
│   ├── domains/
│   │   └── telemetry/                          ← NEW 도메인
│   │       ├── types/
│   │       │   └── telemetry.types.ts           ← EventType, Outcome, 입출력 타입
│   │       ├── services/
│   │       │   └── telemetry-service.ts         ← 핵심 서비스 (record, context)
│   │       ├── repositories/
│   │       │   └── telemetry-repository.ts      ← DB 쿼리 (insert, upsert, query)
│   │       └── index.ts                         ← 도메인 공개 API
│   └── infrastructure/
│       ├── database/database/migration/migrations/
│       │   ├── 027-telemetry-events.ts          ← NEW
│       │   └── 028-telemetry-daily-metrics.ts   ← NEW
│       └── scheduler/jobs/
│           └── telemetry-cleanup-batch-job.ts   ← NEW

packages/memento-server/
└── src/server/routes/
    └── admin.routes.ts                         ← MODIFY: 4개 엔드포인트 추가
```

**수정되는 기존 파일:**
- `packages/memento-core/src/infrastructure/database/database/schema.sql` — 2개 테이블 + 인덱스 추가
- `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` — cleanup 잡 등록
- `packages/memento-core/src/bootstrap.ts` — TelemetryService 주입, AsyncLocalStorage context 설정
- `packages/memento-core/src/domains/memory/tools/recall-tool.ts` — 계측 추가 (검색 파이프라인 파일 동반 가능)
- `packages/memento-core/src/domains/memory/tools/remember-tool.ts` — 계측 추가
- `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.ts` — 계측 추가

## Implementation Phases

**실행 순서 (헌장 I — Test-First)**: 아래 Phase별 "작업/테스트"는 논리 묶음이다. **Red–Green–Refactor 및 구체적 Task ID 순서는 `tasks.md`가 권위**이다(예: 실패하는 `telemetry-repository.spec.ts` → `TelemetryRepository` 구현).

---

### Phase A: DB 스키마 + 타입 기반 작업

**목표**: 마이그레이션 + 타입 추가. 다른 모든 단계의 선행 조건.

**작업:**
1. `telemetry.types.ts` 작성 — `EventType`, `Outcome`, `TelemetryEventInput`, `TelemetryEventRow`, `DailyMetricRow`
2. `027-telemetry-events.ts` 마이그레이션 작성 및 러너 등록
3. `028-telemetry-daily-metrics.ts` 마이그레이션 작성 및 러너 등록
4. `schema.sql` 동기화 (2개 테이블 + 인덱스)

**테스트**: `npm run db:migrate` 성공, `npm run db:check-migration` 통과

**완료 기준**: `npm run type-check` 통과, migration 적용 성공

---

### Phase B: TelemetryRepository + TelemetryService

**목표**: 이벤트 기록 + 집계 쿼리 + fire-and-forget 로직의 핵심 서비스.

**참고**: 테스트 선행·구현 순서는 `tasks.md` Phase 2.

**작업:**
1. `telemetry-repository.ts` 작성
   - `insertEvent(event)` — `telemetry_events` INSERT
   - `upsertDailyMetric(event)` — `telemetry_daily_metrics` UPSERT (running avg 공식 포함)
   - `querySearchQuality(period, ownerId?)` — p95 실시간 계산 포함
   - `queryMemoryQuality(ownerId?)` — `memory_item` + `memory_relation` 조인
   - `querySystemMetrics(period, ownerId?)` — 도구별 집계
   - `queryEvents(filters)` — 원시 이벤트 페이지네이션 쿼리
   - `deleteExpiredEvents(retentionDays)` — cleanup 잡용
2. `telemetry-service.ts` 작성
   - `AsyncLocalStorage` 기반 request context (`requestId`, `ownerId`)
   - `record(input: TelemetryEventInput): void` — `setImmediate` fire-and-forget
   - `runWithContext(ownerId, fn)` — MCP 도구 래퍼용 context 진입점
   - `getSearchQuality(period, ownerId?)`, `getMemoryQuality(ownerId?)`, `getSystemMetrics(period, ownerId?)`, `getEvents(filters)` — admin API 위임
3. `telemetry/index.ts` 작성

**테스트** (`telemetry-service.spec.ts`, `telemetry-repository.spec.ts`):
- 이벤트 기록 후 telemetry_events에 행이 추가됨
- 이벤트 기록 후 telemetry_daily_metrics가 UPSERT됨 (avg 계산 검증)
- `record()` 실패 시 예외가 호출자에 전파되지 않음 (FR-011)
- p95 계산 정확성 (알려진 latency 배열로 검증)
- duplicate write 감지 (content_hash 24h 중복)

**완료 기준**: telemetry 도메인 spec 전체 통과

---

### Phase C: MCP 도구 계측

**목표**: recall, remember, feedback, consolidation에 계측 코드 삽입. MCP 계약 변경 없음.

**참고**: 통합 스펙 선행 포함 실행 순서는 `tasks.md` Phase 2.

**작업:**
1. `bootstrap.ts` 수정
   - `TelemetryService` 인스턴스화 및 `ServerServices`에 추가
2. `tool-registry.ts` (또는 `tools/index.ts`) `executeTool` 수정
   - `telemetryService.runWithContext(ownerId, fn)` 으로 래핑 (tasks.md T013 기준; bootstrap.ts는 인스턴스화만 담당)
2. recall 경로 계측 (`recall-tool` 및 검색 파이프라인)
   - `memory.search.requested` (호출 시작)
   - `memory.search.candidates_retrieved` (후보 수집 후)
   - `memory.search.reranked` (rerank 후)
   - `memory.search.selected` or `memory.search.empty` (최종 결과)
   - `memory.search.failed` (검색 실행 단계 예외 시 터미널 이벤트, `outcome: failure`)
3. remember 경로 계측 (`remember-tool`)
   - `memory.write.requested` (호출 시작)
   - `memory.write.completed` (저장 후, content_hash + is_duplicate 포함)
4. feedback 경로 계측 (`feedback-tool`)
   - `memory.feedback.positive` or `memory.feedback.negative` (결과 기준)
5. `SleepConsolidationService` 계측
   - `consolidation.performed` (run() 완료 후)

**테스트** (`recall-telemetry.spec.ts` 등 통합 테스트):
- recall 호출 후 telemetry_events에 search 이벤트가 기록됨
- remember 호출 후 write 이벤트가 기록됨 (is_duplicate 필드 포함)
- 계측 실패(DB 오류)가 recall/remember 응답을 실패시키지 않음
- 동일 recall 호출 내 모든 이벤트가 동일 request_id를 공유함

**완료 기준**: Phase C spec 전체 통과, 기존 recall/remember 테스트 회귀 없음

---

### Phase D: Admin API 엔드포인트

**목표**: 4개 텔레메트리 admin 엔드포인트 추가 (contracts/admin-api.md 계약 준수).

**작업:**
1. `admin.routes.ts` 수정
   - `GET /admin/telemetry/search-quality` (FR-007, US1)
   - `GET /admin/telemetry/memory-quality` (FR-008, US2)
   - `GET /admin/telemetry/system` (FR-009, US3)
   - `GET /admin/telemetry/events` (FR-010, US4)
   - 쿼리 파라미터: **`search-quality`·`system`** → `period`(허용값 검증) + `owner_id`(선택). **`memory-quality`** → `owner_id`만(FR-013, `period` 없음). **`events`** → 계약의 필터·페이지네이션만.
   - null DB 처리, 에러 핸들링

**참고**: 라우트 단위 테스트 선행 순서는 `tasks.md` Phase 3–6.

**테스트** (`admin.routes.spec.ts` — 기존 파일에 추가):
- 각 엔드포인트의 응답 구조가 contracts/admin-api.md와 일치
- 이벤트 없을 때 null 필드 포함 200 반환
- `period` 지원 엔드포인트에서 유효하지 않은 `period` → 400 반환
- `period=7d` → search-quality·system에서 7일치 데이터만 반환(계약 Notes 준수)
- memory-quality는 `period` 미적용(무시 또는 거부는 구현과 계약을 일치)

**완료 기준**: admin.routes spec 테스트 전체 통과

---

### Phase E: Cleanup 배치 잡 + 보존 정책

**목표**: 90일 보존 정책 자동 실행 (FR-012, SC-005).

**작업:**
1. `telemetry-cleanup-batch-job.ts` 작성
   - `TelemetryRepository.deleteExpiredEvents(days)` 호출
   - `TELEMETRY_RETENTION_DAYS` 환경변수 읽기 (기본 90)
   - 실행 결과 로그 기록
2. `batch-scheduler.ts` 수정
   - `TELEMETRY_CLEANUP_INTERVAL_MS` 환경변수 읽기 (기본 86400000 = 24시간)
   - cleanup 잡 등록

**테스트** (`telemetry-cleanup-batch-job.spec.ts`):
- 90일 이상 이벤트 삭제 확인
- `telemetry_daily_metrics`는 삭제되지 않음 확인
- 잡 실행 결과 로그 기록 확인

**완료 기준**: cleanup spec 통과, 스케줄러 등록 확인

---

### Phase F: 시나리오 테스트

**목표**: SC-001~SC-005 통합 검증.

**작업:**
1. `src/test/test-telemetry.ts` 시나리오 테스트 작성
   - SC-001: 100건 recall 후 events 기록 성공률 ≥ 99%
   - SC-002: 텔레메트리 있는/없는 recall latency 비교 (p95 증가 ≤ 5ms)
   - SC-003: search-quality API 응답 시간 ≤ 2초 (24h, 이벤트 1000건)
   - SC-004: 동일 기간 2회 조회 → 동일 결과 (집계 일관성)
   - SC-005: 91일 이전 이벤트 삽입 → cleanup 후 삭제 확인

**완료 기준**: 시나리오 테스트 전체 통과

---

## Quality Gates (각 Phase 완료 후)

```bash
npm run lint -- --fix
npm run type-check
npm test
```

Phase A~F 전체 완료 후:
```bash
npm run build
npm run test:search   # 기존 검색 품질 회귀 없음
```

## Dependency Chain

```
Phase A (스키마/타입)
  → Phase B (TelemetryService)
    → Phase C (계측)
    → Phase D (Admin API)
      → Phase E (Cleanup 잡)
        → Phase F (시나리오)
```

## Risk & Mitigation

| 리스크 | 완화 방법 |
|-------|---------|
| setImmediate 지연 중 프로세스 종료 → 이벤트 유실 | 허용 가능 (telemetry는 best-effort) |
| UPSERT avg 공식 floating point 오차 | 검증 테스트로 ±1ms 허용 범위 확인 |
| p95 실시간 계산이 SC-003 위반 | created_at 인덱스 + LIMIT로 최적화; 24h 기준 수만 건 이하에서 충분 |
| AsyncLocalStorage context 누락 | record() 호출 시 context 없으면 request_id 'no-context'로 fallback |
| recall/remember 기존 테스트 깨짐 | Phase C에서 기존 테스트 회귀 확인 필수 |
