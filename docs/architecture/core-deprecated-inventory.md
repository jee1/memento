# Core Deprecated API Inventory

Issue #586 · 부모 [#580](https://github.com/jee1/memento/issues/580)

`packages/memento-core` 프로덕션 경로의 `@deprecated`·런타임 레거시 경고를 추적한다.  
제거 일정은 **2026-Q4** (v1.18+) unless noted.

| Symbol / location | Replacement | Notes |
|-------------------|-------------|-------|
| `type-param-validator` runtime warning `[LEGACY TYPE]` | Always pass MCP `type` param | [type-param-rollout.md](../guides/ko/type-param-rollout.md) — 제거 조건: `MEMENTO_TYPE_PARAM_MODE` 기본값이 `error`로 전환된 후 |
| `@google/generative-ai` (llm-client-initializer note) | `@google/genai` migration | 아직 광범위 사용 중; 마이그레이션 미완료 |

## Removed in #617

| Item | Reason |
|------|--------|
| `FeedbackRepository` (`feedback-repository.ts`) | 모든 호출자가 `FeedbackRepositorySQLite` 직접 사용으로 전환; `sigmoidNormalizedNet`은 `feedback-repository.interface.ts`로 이동 |
| `CoreMemoryRepository` (`core-memory-repository.ts`) | 타입 re-export 전용 shim 삭제; 호출자가 `core-memory-repository.interface.ts` 직접 import로 전환 |
| `KgTripleRepository` (`kg-triple-repository.ts`) | 모든 호출자가 `KgTripleRepositorySqlite` 직접 사용으로 전환 |
| `KnowledgeVaultRepository` (`knowledge-vault-repository.ts`) | 모든 호출자가 `KnowledgeVaultRepositorySqlite` 직접 사용으로 전환 |
| `ProcessAttributeRepository` (`process-attribute-repository.ts`) | 모든 호출자가 `ProcessAttributeRepositorySqlite` 직접 사용으로 전환 |
| `EmbeddingService` (`embedding-service.ts`) | 사용처 없음; `EmbeddingManager` / `MemoryEmbeddingService` 사용 |
| `AnchorManager.getSearchService()` / `.getCacheService()` | private 필드 직접 접근으로 대체; 테스트에서만 사용됐던 no-op wrapper |
| `PerformanceMonitor.getMemoryMetrics().heapUsagePercent` | `heapShareOfBudgetPercent` 사용 |
| `ReflexionWorker` legacy queue hook (`removeOldestQueuedEvent`) | `AsyncTaskQueue` 자동 처리; no-op private 메서드 |

## Removed in #586

| Item | Reason |
|------|--------|
| `VectorSearchEngineMigration` | Refactor complete; zero imports |
| `RememberTool` private `getMemoryById` / `getExistingMemoriesForRelationExtraction` shims | Tests use `remember-tool-db-helpers` directly |

## Verification

```bash
npm run check-debt-markers -- --production-only
```

Scanner allowlist aligns with rows above; new `@deprecated` APIs MUST be added here before merge.
