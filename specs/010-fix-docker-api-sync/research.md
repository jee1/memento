# Research: Docker HTTP API 엔드포인트 동기화 (010-fix-docker-api-sync)

**Date**: 2026-04-04  
**Branch**: `010-fix-docker-api-sync`

---

## 1. 문제 원인 분석

### Decision
루트 `src/server/routes/admin.routes.ts`에 6개 엔드포인트가 누락된 상태. 도커 빌드는 루트 `src/server/`를 진입점으로 사용하므로 packages 버전에만 있는 기능들이 404를 반환.

### Rationale
- 도커 Dockerfile의 빌드 진입점: 루트 `src/server/` (변경 대상 아님)
- 누락된 6개 라우트: `/telemetry/search-quality`, `/telemetry/memory-quality`, `/telemetry/system`, `/telemetry/events`, `/graph`, `/consolidation/run`
- packages 버전(`packages/memento-server/src/server/routes/admin.routes.ts`)에는 이 6개가 구현됨
- 가장 낮은 리스크 접근: 루트 파일에만 6개 라우트 추가

---

## 2. 루트 `ServerServices` 인터페이스 현황

### Decision
루트 `src/server/bootstrap.ts`의 `ServerServices` 인터페이스에 `telemetryService?`와 `sleepConsolidationService?`를 옵셔널로 추가하고, `initializeServices()`에서 초기화해야 한다.

### Findings
- 루트 `ServerServices`에는 현재 `telemetryService`, `sleepConsolidationService`가 **없음** (누락)
- `@memento/core`의 `ServerServices`(packages/memento-core/src/bootstrap.ts)에는 이미 존재:
  ```typescript
  sleepConsolidationService?: SleepConsolidationService;
  telemetryService?: TelemetryService;
  ```
- `@memento/core`의 `initializeServices()`에서는 이미 두 서비스를 초기화하여 반환
- 루트 `http-server.ts`는 `@memento/core`의 `createMementoCore()`를 호출하는 흐름이므로, `@memento/core`의 `ServerServices`가 실제 런타임 서비스 집합

### Alternatives Considered
- **Option B** (진입점 변경): 도커 빌드를 packages 버전으로 전환 — 리스크 크고 범위 외
- **Option C** (별도 import 파일): `@memento/core`에서 ServerServices를 import — 타입 일관성을 위해 루트 인터페이스 확장이 더 명확

---

## 3. `@memento/core` Export 목록 확인

### Decision
루트 `admin.routes.ts`에서 아래를 `@memento/core`에서 직접 import한다.

### Confirmed Exports (packages/memento-core/src/index.ts 기준)
| 심볼 | 종류 | 확인 여부 |
|------|------|-----------|
| `ConsolidationAlreadyRunningError` | 클래스 | ✅ export |
| `TelemetryPeriod` | export type | ✅ export |
| `EventType` | export type | ✅ export |
| `TelemetryService` | 클래스 | ✅ export |
| `SleepConsolidationService` | 클래스 | ✅ export |

### NOT Exported from @memento/core
| 심볼 | 위치 | 처리 방법 |
|------|------|-----------|
| `GraphNode` | packages-only 인터페이스 | 루트 `admin.routes.ts`에 직접 선언 |
| `GraphEdge` | packages-only 인터페이스 | 루트 `admin.routes.ts`에 직접 선언 |
| `GraphFilter` | packages-only 인터페이스 | 루트 `admin.routes.ts`에 직접 선언 |
| `GraphResponse` | packages-only 인터페이스 | 루트 `admin.routes.ts`에 직접 선언 |
| `buildGraphResponse()` | packages-only 함수 | 루트 `admin.routes.ts`에 직접 복사 |
| `effectiveTelemetryPeriod()` | packages-only 함수 | 루트 `admin.routes.ts`에 직접 선언 |
| `TELEMETRY_PERIODS` | packages-only 상수 | 루트 `admin.routes.ts`에 직접 선언 |

---

## 4. 텔레메트리 서비스 메서드 시그니처

### Findings
`TelemetryService` 메서드 (packages/memento-core/src/domains/telemetry/services/telemetry-service.ts):
```typescript
getSearchQuality(period: TelemetryPeriod, ownerId?: string | null): SearchQualityResult
getMemoryQuality(ownerId?: string | null): MemoryQualityResult
getSystemMetrics(period: TelemetryPeriod, ownerId?: string | null): SystemMetricsResult
getEvents(filters: TelemetryEventQueryFilters): { events: TelemetryEvent[]; total: number }
```

`TelemetryPeriod` 허용 값: `'24h' | '7d' | '30d'`

`EventType` 허용 값 (12가지):
```
memory.search.requested, memory.search.candidates_retrieved, memory.search.reranked,
memory.search.selected, memory.search.empty, memory.search.failed,
memory.write.requested, memory.write.completed,
memory.feedback.positive, memory.feedback.negative,
consolidation.performed, telemetry.cleanup.performed
```

---

## 5. Sleep Consolidation 서비스 시그니처

### Findings
`SleepConsolidationService.run()` (packages/memento-core/src/domains/consolidation/):
```typescript
run(opts: { dryRun: boolean; ownerIdFilter: string | null }): Promise<SleepConsolidationRunResult>
```
- 이미 실행 중일 경우: `ConsolidationAlreadyRunningError` throw → HTTP 409
- 성공 시 반환: `{ success: true, result: SleepConsolidationRunResult }`

---

## 6. buildGraphResponse 함수 분석

### Decision
packages 버전의 `buildGraphResponse()` 함수 전체를 루트 `admin.routes.ts`에 복사한다.

### Key Implementation Details
- `MemoryItemRow`, `MemoryRelationRow` 인터페이스 포함 필요
- json_each CTE를 사용해 SQLite 999 변수 한계 회피
- `limit + 1` 조회로 truncated 판단
- 노드 집합(Set) 내 엣지만 조회

---

## 7. 루트 bootstrap.ts 수정 범위

### Decision
루트 `src/server/bootstrap.ts`의 `ServerServices` 인터페이스에 옵셔널 필드 2개 추가.

### 수정 사항
```typescript
// 추가할 옵셔널 필드
sleepConsolidationService?: import('@memento/core').SleepConsolidationService;  // type import
telemetryService?: import('@memento/core').TelemetryService;                    // type import
```

**주의**: 루트 `initializeServices()`는 `@memento/core`의 `initializeServices`를 **호출하지 않음** (독립적으로 구현됨). 따라서 루트 bootstrap에서 `TelemetryService`와 `SleepConsolidationService`를 직접 초기화해야 한다.

- `TelemetryService`는 `TelemetryRepository` 인스턴스가 필요
- `SleepConsolidationService`는 `db`, `{ embeddingService, scoreService?, telemetryService }` 필요

---

## 8. 테스트 전략

### Decision
단위 테스트 신규 생성 없음 (spec.md Q5 결론). 수동 smoke test로 SC-001~SC-005 검증.

### Smoke Test 명령어 예시
```bash
# 도커 컨테이너 실행 후
curl -s http://localhost:9001/admin/telemetry/search-quality | jq .
curl -s http://localhost:9001/admin/telemetry/memory-quality | jq .
curl -s "http://localhost:9001/admin/telemetry/system?period=7d" | jq .
curl -s "http://localhost:9001/admin/telemetry/events?limit=5" | jq .
curl -s http://localhost:9001/admin/graph | jq .meta
curl -s -X POST http://localhost:9001/admin/consolidation/run -H 'Content-Type: application/json' -d '{"dryRun":true}' | jq .
```

---

## 9. 헬퍼 함수 및 상수 (루트 파일에 직접 선언)

```typescript
const TELEMETRY_PERIODS: TelemetryPeriod[] = ['24h', '7d', '30d'];

function effectiveTelemetryPeriod(periodRaw: string | undefined): string {
  return periodRaw === undefined ? '24h' : periodRaw;
}
```

---

## 결론: 모든 NEEDS CLARIFICATION 해소됨

| 항목 | 상태 |
|------|------|
| 루트 ServerServices에 텔레메트리/통합 서비스 주입 방법 | ✅ 해소 — 인터페이스에 옵셔널 추가 + initializeServices 수정 |
| 그래프 타입/헬퍼 확보 방법 | ✅ 해소 — 루트 파일에 직접 복사 |
| effectiveTelemetryPeriod 위치 | ✅ 해소 — 라우터 파일 내 로컬 함수 |
| 타입 import 경로 | ✅ 해소 — @memento/core에서 직접 import |
| 테스트 범위 | ✅ 해소 — smoke test로 충분 |
| TelemetryRepository 초기화 방법 | ✅ 해소 — 루트 bootstrap에서 직접 생성 |
