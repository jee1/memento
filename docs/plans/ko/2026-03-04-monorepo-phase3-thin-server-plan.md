# Phase 3.1 서버 Thin화 계획

**목표:** memento-server 패키지에서 domains, shared, infrastructure, workers 복사본을 제거하고, MCP/HTTP 전송·라우트만 두고 필요한 것은 모두 `@memento/core`에서만 가져오도록 한다.

**배경:** 현재 서버에 동일 소스 복사본이 있어 core 인스턴스와 서버 쪽 클래스 타입이 불일치하여 TypeScript 에러가 발생한다. 서버를 thin화하면 타입 단일화와 유지보수성이 확보된다.

---

## 1. Core에 추가할 Export 목록

서버가 **domains/shared/infrastructure** 없이 동작하려면 core에서 아래를 export해야 한다.

### 1.1 shared (설정·유틸·타입)

| 항목 | 경로 (core 내) | 용도 (서버) |
|------|----------------|-------------|
| mementoConfig | shared/config/index.js | serverName, dbPath, embeddingProvider 등 |
| validateConfig | shared/config/index.js | 시작 시 설정 검증 |
| DatabaseUtils | shared/utils/database.js | ListResources, ReadResource, admin/quality 라우트 |
| logger | shared/utils/logger.js | http-server, mcp-logger, routes, middleware, handlers |
| loggingRateLimiter | shared/utils/logging-rate-limiter.js | mcp-logger |
| withErrorHandling | shared/utils/error-handling.js | index.ts |
| MemoryItem | shared/types/index.js | 타입 (리소스 응답 등) |
| IErrorLoggingService, ErrorSeverity, ErrorCategory | shared/interfaces, shared/types | error-handler.middleware |
| AppErrorContract | shared/types/error-types.js | error-handler.middleware |

### 1.2 domains (서비스·도구)

| 항목 | 경로 (core 내) | 용도 (서버) |
|------|----------------|-------------|
| getVectorSearchEngine | domains/search/algorithms/vector-search-engine.js | index, http-server, api.routes, mcp.routes |
| MemoryNeighborService, MemoryNotFoundError | domains/memory/services/memory-neighbor-service.js | index, api.routes, mcp.routes |
| ErrorLoggingService (+ ErrorSeverity, ErrorCategory) | domains/monitoring/services/error-logging-service.js | index.ts |
| getPerformanceMonitor | domains/monitoring/services/performance-monitor.js | admin.routes |
| QualityAssuranceService | domains/monitoring/services/quality-assurance/quality-assurance-service.js | quality.routes |
| QualityThresholdManager | domains/monitoring/services/quality-assurance/quality-threshold-manager.js | quality.routes |
| createRelationGraph | infrastructure/relation-graph-factory.js | admin.routes |
| RelationExtractor | domains/relation/services/relation-extractor.js | admin.routes |
| ExtractRelationsTool, GetRelationsTool, AddRelationTool, RemoveRelationTool, VisualizeRelationsTool | domains/relation/tools/*.js | admin.routes |
| RestoreAnchorsTool | domains/anchor/tools/restore-anchors-tool.js | admin.routes |
| ConvertEpisodicToSemanticTool | domains/memory/tools/convert-episodic-to-semantic-tool.js | admin.routes |
| GetMetaMemoryStatsTool | domains/monitoring/tools/get-meta-memory-stats-tool.js | admin.routes |
| MigrateEmbeddingsTool | tools/migrate-embeddings-tool.js (core에 있으면) | admin.routes |

### 1.3 infrastructure (스케줄러)

| 항목 | 경로 (core 내) | 용도 (서버) |
|------|----------------|-------------|
| getBatchScheduler | infrastructure/scheduler/batch-scheduler.js | index, http-server (start/stop), admin.routes |

- **배치 스케줄러:** 현재 core의 `initializeServices` 반환값에 `batchScheduler`가 없음. core의 bootstrap에서 `getBatchScheduler()` 호출 후 `start(db, services.reflexionWorker)` 하고 `services.batchScheduler`에 넣어 반환하도록 변경.
- core의 `batch-scheduler.ts`는 이미 `../../server/mcp-logger.js`(core의 스텁 mcp-logger)를 사용하므로 core 내부에서 그대로 사용 가능.
- 서버 종료 시 `getBatchScheduler().stop()` 호출만 하면 되므로, core에서 `getBatchScheduler`를 export하면 서버는 이를 재export하거나 직접 호출 가능.

---

## 2. 서버 패키지에서 제거할 디렉터리

thin화 후 **삭제**할 디렉터리:

- `packages/memento-server/src/domains`
- `packages/memento-server/src/shared`
- `packages/memento-server/src/infrastructure`
- `packages/memento-server/src/workers`
- `packages/memento-server/src/tools` (단, 아래 3은 유지·조정)

**유지·조정:**

- `packages/memento-server/src/server` — 전부 유지. import만 `@memento/core` 및 서버 로컬(예: mcp-logger 실구현)으로 변경.
- `packages/memento-server/src/tools/types.ts` — core 타입 재내보내기만 유지 (이미 적용됨).
- `packages/memento-server/src/tools` — `types.ts` 외에는 제거 가능. `getToolRegistry`는 core에서 가져옴.
- `packages/memento-server/src/server/mcp-logger.ts` — 서버 전용 **실구현** 유지 (MCP stderr 등). core는 스텁만 제공.

---

## 3. 단계별 실행 순서

### Step 1: Core에 공통 export 추가

1. **core/src/index.ts**에 다음 re-export 추가:
   - `mementoConfig`, `validateConfig` (shared/config)
   - `DatabaseUtils` (shared/utils/database)
   - `logger` (shared/utils/logger)
   - `loggingRateLimiter` (shared/utils/logging-rate-limiter)
   - `withErrorHandling` (shared/utils/error-handling)
   - `MemoryItem` (shared/types)
   - 필요 시 `IErrorLoggingService`, `ErrorSeverity`, `ErrorCategory`, `AppErrorContract` (shared/interfaces, shared/types/error-types)
2. **검증:** `cd packages/memento-core && npm run build` 성공.

### Step 2: Core bootstrap에 batchScheduler 포함

1. **core/src/bootstrap.ts**의 `initializeServices` 마지막에:
   - `getBatchScheduler()` 호출,
   - `await batchScheduler.start(db, reflexionWorker)` 실행,
   - 반환 객체에 `batchScheduler` 추가.
2. **core/src/index.ts**에서 `getBatchScheduler` export.
3. **검증:** core 빌드 성공, 기존 테스트 유지.

### Step 3: Core에 도메인·인프라 export 추가

1. core index에 아래를 re-export:
   - `getVectorSearchEngine`, `MemoryNeighborService`, `MemoryNotFoundError`
   - `ErrorLoggingService`, `getPerformanceMonitor`
   - `QualityAssuranceService`, `QualityThresholdManager`
   - `createRelationGraph`, `RelationExtractor`, relation 도구 5종, `RestoreAnchorsTool`, `ConvertEpisodicToSemanticTool`, `GetMetaMemoryStatsTool`
   - `MigrateEmbeddingsTool` (core에 해당 파일이 있으면 export, 없으면 core로 이동 후 export)
2. **검증:** core 빌드 성공.

### Step 4: 서버 import를 전부 @memento/core로 전환

1. **server/index.ts**: `../shared/*`, `../domains/*`, `../infrastructure/*` → `@memento/core`.
2. **server/http-server.ts**: 동일.
3. **server/mcp-logger.ts**, **server/simple-mcp-server.ts**: `../shared/*` → `@memento/core`.
4. **server/routes/*.ts**: `../../domains/*`, `../../shared/*`, `../../infrastructure/*`, `../../tools/*` → `@memento/core` (getToolRegistry, createToolContext는 이미 core).
5. **server/middleware/*.ts**: `../../shared/*`, `../../tools/types` → `@memento/core` (ToolContext는 이미 core 재내보내기).
6. **server/handlers/*.ts**: `../../shared/*` → `@memento/core`.
7. **검증:** `packages/memento-server`에서 `npx tsc --noEmit` 성공.

### Step 5: 서버에서 복사본 디렉터리 제거

1. 아래 디렉터리 삭제:
   - `packages/memento-server/src/domains`
   - `packages/memento-server/src/shared`
   - `packages/memento-server/src/infrastructure`
   - `packages/memento-server/src/workers`
2. `packages/memento-server/src/tools`는 `types.ts`만 남기고 나머지 삭제 (또는 types.ts를 server로 옮겨 core 재내보내기만 유지).
3. **검증:** `cd packages/memento-server && npm run build` 성공, `node dist/server/index.js` 및 HTTP 서버 기동 확인.

### Step 6: 테스트·스펙 정리

- `**/*.spec.ts`는 빌드 exclude에 포함되어 있으므로, 필요 시 import를 `@memento/core`로 바꾸거나 서버 thin화 후 별도 단계에서 수정.
- 루트 `npm run build`가 core → server 순서로 동작하는지 확인.

---

## 4. 위험 요소·참고

- **MigrateEmbeddingsTool:** 현재 루트 `src/tools/migrate-embeddings-tool.ts`에 있을 수 있음. core에 없으면 core로 복사 후 export하거나, admin 전용이면 서버에만 최소한으로 두고 타입만 core에 맞춘다.
- **quality.routes:** QualityAssuranceService, QualityThresholdManager는 core에 있으므로 export만 하면 됨.
- **에러 타입:** IErrorLoggingService, AppErrorContract 등은 core의 shared에 있으면 re-export; 없으면 core에 타입만 정의해도 됨.

---

## 5. 완료 기준

- 서버 패키지에 `src/domains`, `src/shared`, `src/infrastructure`, `src/workers` 없음.
- 서버의 모든 비테스트 소스가 `@memento/core`와 `server/*` 로컬(mcp-logger 등)만 import.
- `cd packages/memento-server && npm run build` 성공.
- MCP stdio 및 HTTP 서버 기동 및 도구 호출 동작 확인.

이 문서는 [2026-03-04-monorepo-memento-core-implementation-plan.md](./2026-03-04-monorepo-memento-core-implementation-plan.md) Phase 3.1 보완용이다.
