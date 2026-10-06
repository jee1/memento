# Core Deprecated API Inventory

`packages/memento-core`에 남아 있는 `@deprecated` 표시와 런타임 레거시 경고는 **언제 제거할지**를 추적하기 위한 표입니다. 부모 이슈 [#580](https://github.com/jee1/memento/issues/580), 정리 작업 [#586](https://github.com/jee1/memento/issues/586)을 따르며, 기본 제거 시점은 **2026-Q4 (v1.18+)** 입니다(별도 표기 없는 한). merge 전에는 이 표와 [CHANGELOG](../../CHANGELOG.md)를 함께 갱신하세요.

현재 **활성 deprecated 항목은 없습니다.** 아래는 이미 제거된 항목의 기록입니다.

## Removed in v2.0.0 (#1246)

| Item | Reason |
|------|--------|
| ζ `relation_weight` 랭킹 항 · `[ranking_weights].zeta` · `[relation_weights]` | 관계 수가 질의와 무관한 prior 라 정답 순위를 뒤집음 (#1185 에서 기본 0). 남은 TOML 키는 무시 (#1245) |
| consolidation 랭킹 블렌드 · `[ranking_weights].consolidation` | 반환 후보마다 점수를 다시 써 자기강화 (#1184 에서 기본 0). 남은 키는 무시 (#1244) |
| `ConsolidationScoreService` · 워커 · `consolidation_score_incremental` / `_full_sweep` 배치 잡 · `CONSOLIDATION_SCORE_ENABLED` | #1189 이후 운영에서 꺼져 있던 쓰기 경로 (#1244) |
| `memory_item.consolidation_score` · `g_value` 컬럼 | migration `051-drop-consolidation-score-columns` 로 DROP. `recall_count`·`last_accessed_at` 은 유지 (#1244) |
| quality `consolidation` namespace · `test:vector-search-quality(:ci)` · `benchmark:consolidation-quality` · `CONSOLIDATION_TEST_*` env | 측정 대상 점수 제거 (#1244) |
| `MEMENTO_TYPE_PARAM_MODE` `warn` / `deprecate` | `type` 은 항상 필수. 변수 자체를 제거 (#1242) |
| `ADMIN_API_KEY` → synthetic `legacy-admin` programmatic 토큰 | programmatic HTTP 는 `MEMENTO_API_TOKENS` 만 인증. `ADMIN_API_KEY` 는 대시보드 로그인 키로만 남음 (#1241) |
| `remember` `enable_triple_extraction` 호환 처리 | strict schema 가 거절 (#1240) |
| relation recall candidate expansion · `quality` relation-recall PoC 명령 | 운영 경로 없음 (#1243) |
| `event_outbox` 테이블 · `EventOutboxService` · `ConsolidationOutboxWorker` · `MEMENTO_EVENT_OUTBOX_ENABLED` | 쓰기만 있고 `publishPending()` 운영 호출자 없음. migration `052-drop-event-outbox` 로 DROP (#1259) |

## Removed in #1237

| Item | Reason |
|------|--------|
| 자동 triple 추출 (`runTripleExtraction`, `triple_extraction_batch`) | 생성 semantic 의 78% 가 맥락 없는 조각, triple 구조를 읽는 곳 없음 (#1230). Phase 1 opt-in 후 Phase 2/3 에서 코드·스키마 전부 제거 |
| `remember` `enable_triple_extraction` | #1238 의 호환 처리(받아서 무시·경고) 를 #1240 (v2.0.0) 에서 제거. 이제 strict schema 가 거절한다 |
| `extract_triples` MCP 도구 · `ConvertEpisodicToSemanticTool` | 명시 triple 추출·episodic→semantic 변환 경로 제거. 대체 추출 경로 없음 |
| `kg_triple` 테이블 · `memory_item.triple_extracted*` 컬럼 | migration `050-drop-triple-schema` 로 DROP. 운영 데이터는 2026-10-03 폐기 (#1235) |
| `TripleExtractionService` · `KgTripleRepository` · triple 관련 npm script (`memory:repair-triple-sentences`, `memory:kg-triple-predicate-quality`) | 런타임·운영 도구 일괄 제거 |
| `LLM_PROVIDER_TRIPLE_EXTRACTION` / `LLM_MODEL_TRIPLE_EXTRACTION` / `TRIPLE_EXTRACTION_*` env | 설정·compose·env.example 에서 제거 |

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
