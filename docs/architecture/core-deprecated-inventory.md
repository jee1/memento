# Core Deprecated API Inventory

`packages/memento-core`에 남아 있는 `@deprecated` 표시와 런타임 레거시 경고는 **언제 제거할지**를 추적하기 위한 표입니다. 부모 이슈 [#580](https://github.com/jee1/memento/issues/580), 정리 작업 [#586](https://github.com/jee1/memento/issues/586)을 따르며, 기본 제거 시점은 **2026-Q4 (v1.18+)** 입니다(별도 표기 없는 한). merge 전에는 이 표와 [CHANGELOG](../../CHANGELOG.md)를 함께 갱신하세요.

현재 **활성 deprecated 항목은 없습니다.** 아래는 이미 제거된 항목의 기록입니다.

## Disabled in #1230 / #1235

| Item | Reason |
|------|--------|
| 자동 triple 추출 (`remember` 직후 `runTripleExtraction`, 매시간 `triple_extraction_batch`) | 운영 `TRIPLE_EXTRACTION_ENABLED=false`. 생성 semantic 의 78% 가 맥락 없는 조각, triple 구조를 읽는 곳 없음 (#1230) |
| `kg_triple` 데이터 · triple semantic (`origin_source.tool = extract_triples`) | 운영 DB 에서 2026-10-03 폐기. 그래프 재설계는 측정 결과 불필요로 만들지 않음 (#1235) |
| `extract_triples` MCP 도구 | 코드는 남아 있으나 권장하지 않음. 제거 시점 미정 |

## Removed in #636

| Item | Reason |
|------|--------|
| `type-param-validator` runtime warning `[LEGACY TYPE]` | `MEMENTO_TYPE_PARAM_MODE` 기본값 `error` 전환; `type` 미지정 시 거절. `warn`/`deprecate`는 명시적 env로만 사용 |

## Removed in #628

| Item | Reason |
|------|--------|
| `@google/generative-ai` SDK (전체 런타임 경로) | `@google/genai`로 통일 완료; package.json·package-lock.json에서 제거; root quality gate가 재유입 방지 |

## Removed in #617

| Item | Reason |
|------|--------|
| `FeedbackRepository` (`feedback-repository.ts`) | 모든 호출자가 `FeedbackRepositorySQLite` 직접 사용으로 전환; `sigmoidNormalizedNet`은 `feedback-repository.interface.ts`로 이동 |
| `CoreMemoryRepository` (`core-memory-repository.ts`) | 타입 re-export 전용 shim 삭제; 호출자가 `core-memory-repository.interface.ts` 직접 import로 전환 |
| `KgTripleRepository` (`kg-triple-repository.ts`) | 모든 호출자가 `KgTripleRepositorySqlite` 직접 사용으로 전환 |
| `KnowledgeVaultRepository` (`knowledge-vault-repository.ts`) | 모든 호출자가 `KnowledgeVaultRepositorySqlite` 직접 사용으로 전환 |
| `ProcessAttributeRepository` (`process-attribute-repository.ts`) | 모든 호출자가 `ProcessAttributeRepositorySqlite` 직접 사용으로 전환 |
| `EmbeddingService` (`embedding-service.ts`) | 사용처 없음; `MemoryEmbeddingService` 사용 (`EmbeddingManager`도 이후 제거됨) |
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
