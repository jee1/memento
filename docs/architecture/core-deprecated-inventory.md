# Core Deprecated API Inventory

Issue #586 · 부모 [#580](https://github.com/jee1/memento/issues/580)

`packages/memento-core` 프로덕션 경로의 `@deprecated`·런타임 레거시 경고를 추적한다.  
제거 일정은 **2026-Q4** (v1.18+) unless noted.

| Symbol / location | Replacement | Notes |
|-------------------|-------------|-------|
| `FeedbackRepository` (`feedback-repository.ts`) | `IFeedbackRepository` + `FeedbackRepositorySQLite` | Re-export shim; import interface/impl directly |
| `CoreMemoryRepository` (`core-memory-repository.ts`) | domain repository interface + SQLite impl | Compatibility re-export |
| `KgTripleRepository` (`kg-triple-repository.ts`) | interface + SQLite impl | Compatibility re-export |
| `KnowledgeVaultRepository` (`knowledge-vault-repository.ts`) | `IKnowledgeVaultRepository` + `KnowledgeVaultRepositorySqlite` | Compatibility re-export |
| `ProcessAttributeRepository` (`process-attribute-repository.ts`) | `IProcessAttributeRepository` + SQLite impl | Compatibility re-export |
| `EmbeddingService` (`embedding-service.ts`) | `EmbeddingManager` / factory | Class unused; file retained for import stability |
| `AnchorManager` search/cache helpers | `searchService` / `cacheService` directly | Private deprecated wrappers |
| `PerformanceMonitor.getMemoryMetrics().heapUsagePercent` | `heapShareOfBudgetPercent` | Same value; misleading name |
| `ReflexionWorker` legacy queue hook | `AsyncTaskQueue` | No-op deprecated method |
| `type-param-validator` runtime warning `[LEGACY TYPE]` | Always pass MCP `type` param | [type-param-rollout.md](../guides/ko/type-param-rollout.md) |
| `@google/generative-ai` (llm-client-initializer note) | `@google/genai` migration | Upstream SDK sunset 2025-08-31 |

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
