# Implementation Plan: Docker HTTP API 엔드포인트 동기화

**Branch**: `010-fix-docker-api-sync` | **Date**: 2026-04-04 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/010-fix-docker-api-sync/spec.md`

## Summary

루트 `src/server/routes/admin.routes.ts`에 6개의 누락된 엔드포인트(`GET /admin/telemetry/search-quality`, `GET /admin/telemetry/memory-quality`, `GET /admin/telemetry/system`, `GET /admin/telemetry/events`, `GET /admin/graph`, `POST /admin/consolidation/run`)를 추가하여 도커 빌드 환경에서 404 오류를 해소한다. 루트 bootstrap.ts의 `ServerServices`에 `TelemetryService`와 `SleepConsolidationService`를 옵셔널 필드로 추가하고 초기화한다.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+), ES modules  
**Primary Dependencies**: Express 4.x, better-sqlite3, @memento/core  
**Storage**: SQLite (better-sqlite3) — 스키마 변경 없음 (읽기 전용 쿼리 추가)  
**Testing**: vitest (단위 테스트 신규 생성 없음 — smoke test로 검증)  
**Target Platform**: Docker Linux 컨테이너  
**Project Type**: web-service (HTTP Admin API)  
**Performance Goals**: 기존 엔드포인트와 동일 수준 (p95 < 200ms)  
**Constraints**: 기존 21개 엔드포인트 회귀 없음, 도커 빌드 오류 없음  
**Scale/Scope**: 6개 엔드포인트 추가, 2개 파일 수정 (admin.routes.ts, bootstrap.ts)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Rule | Status | Notes |
|------|--------|-------|
| **I. Test-First Delivery** | ⚠️ EXCEPTION | Q5 결론: 루트에 admin.routes.spec.ts 없음. packages 버전도 integration 성격. Smoke test로 SC-001~005 검증. 단위 테스트 미생성 정당화됨. |
| **II. Backward Compatibility** | ✅ PASS | 기존 21개 엔드포인트 수정 없음. 기존 MCP tool contract 변경 없음. |
| **III. Schema and Migration Discipline** | ✅ PASS | DB 스키마 변경 없음. 기존 telemetry 테이블(027, 028) 읽기 전용 조회. |
| **IV. Quality Gates Before Completion** | ✅ REQUIRED | 완료 전 `npm run lint`, `npm run type-check`, `npm test` 통과 필수. |
| **V. Observability and Failure Isolation** | ✅ PASS | 신규 엔드포인트 모두 try-catch + logger.error 패턴 적용. 서비스 미초기화 시 HTTP 500 반환. |

**Gate 평가**: Constitution I 예외는 spec.md Q5에서 사전 합의됨. 나머지 모든 Gate 통과. **진행 승인.**

## Project Structure

### Documentation (this feature)

```text
specs/010-fix-docker-api-sync/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── telemetry-api.md
│   ├── graph-api.md
│   └── consolidation-api.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/server/
├── bootstrap.ts           # 수정: ServerServices에 telemetryService?, sleepConsolidationService? 추가
└── routes/
    └── admin.routes.ts    # 수정: 6개 엔드포인트 + 타입/헬퍼 추가

# 변경 없음 (참조용)
src/server/http-server.ts  # 기존 그대로 (createAdminRouter 호출 위치)
packages/memento-server/src/server/routes/admin.routes.ts  # 복사 원본 참조
```

**Structure Decision**: 단일 프로젝트 구조. 2개 파일만 수정 (최소 변경 원칙).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Constitution I (Test-First) 예외 | 루트 src/server/routes/에 기존 spec 파일 없음. packages 버전도 integration 테스트만 존재. SC-001~005는 HTTP 응답 코드/구조 확인이므로 smoke test로 충분. | 단위 테스트 신규 작성 시 express + DB mock 설정에 불필요한 복잡성 추가. Feature 범위 밖. |

---

## Phase 0: Research (완료)

**산출물**: [research.md](./research.md)

### 핵심 결론
1. **진입점**: 루트 `src/server/`가 도커 빌드 대상 → 루트 파일에만 추가
2. **import 경로**: `ConsolidationAlreadyRunningError`, `TelemetryPeriod`, `EventType`, `TelemetryService`, `SleepConsolidationService` → `@memento/core`에서 직접 import
3. **Graph 타입/헬퍼**: `@memento/core`에 미포함 → 루트 `admin.routes.ts`에 직접 선언
4. **bootstrap 수정**: 루트 `ServerServices`에 2개 옵셔널 필드 추가 + `initializeServices()`에서 초기화
5. **테스트**: smoke test로 충분 (단위 테스트 미생성)

---

## Phase 1: Design & Contracts (현재 단계)

### 수정 파일 목록

#### 파일 1: `src/server/bootstrap.ts`

**변경 내용**:
1. `ServerServices` 인터페이스에 추가:
   ```typescript
   sleepConsolidationService?: SleepConsolidationService;
   telemetryService?: TelemetryService;
   ```
2. import 추가:
   ```typescript
   import { SleepConsolidationService, TelemetryService, TelemetryRepository } from '@memento/core';
   ```
   (단, `@memento/core`는 패키지이므로 루트 src/의 자체 경로 확인 필요. 루트 src/는 packages 참조 없이 독립적으로 동작할 가능성 있음 — contracts에서 명시)
3. `initializeServices()` 내부에 초기화 로직 추가

#### 파일 2: `src/server/routes/admin.routes.ts`

**변경 내용**:
1. import 추가: `ConsolidationAlreadyRunningError`, `TelemetryPeriod`, `EventType`
2. 파일 상단에 상수/타입/헬퍼 추가:
   - `TELEMETRY_PERIODS` 상수
   - `GraphNode`, `GraphEdge`, `GraphFilter`, `GraphResponse`, `MemoryItemRow`, `MemoryRelationRow` 인터페이스
   - `buildGraphResponse()` 함수
   - `effectiveTelemetryPeriod()` 함수
3. router 끝에 6개 엔드포인트 추가 (packages 버전과 동일 구현)

---

## Phase 2: Implementation (tasks.md에서 진행)

**tasks.md 생성 명령**: `/speckit.tasks`

### 예상 Task 목록 (tasks.md에서 세분화)
- T-001: 루트 bootstrap.ts의 `ServerServices` 인터페이스에 옵셔널 필드 추가
- T-002: 루트 bootstrap.ts의 `initializeServices()`에 TelemetryService, SleepConsolidationService 초기화 추가
- T-003: 루트 admin.routes.ts에 필요한 import 추가
- T-004: 루트 admin.routes.ts에 Graph 관련 타입/헬퍼 추가
- T-005: 루트 admin.routes.ts에 `POST /consolidation/run` 추가 (FR-006)
- T-006: 루트 admin.routes.ts에 `GET /telemetry/search-quality` 추가 (FR-001)
- T-007: 루트 admin.routes.ts에 `GET /telemetry/memory-quality` 추가 (FR-002)
- T-008: 루트 admin.routes.ts에 `GET /telemetry/system` 추가 (FR-003)
- T-009: 루트 admin.routes.ts에 `GET /telemetry/events` 추가 (FR-004)
- T-010: 루트 admin.routes.ts에 `GET /graph` 추가 (FR-005)
- T-011: `npm run lint && npm run type-check && npm test` 통과 확인
- T-012: 도커 빌드 확인 및 smoke test 실행

### 구현 순서
1. bootstrap.ts 수정 (T-001 → T-002)
2. admin.routes.ts import/타입/헬퍼 추가 (T-003 → T-004)
3. 6개 엔드포인트 추가 (T-005 ~ T-010)
4. Quality gates (T-011 → T-012)
