# Issue #315 — Production slop 백로그 (JS/TS Critical 후보)

> **상위:** [#239](https://github.com/jee1/memento/issues/239) · [#315](https://github.com/jee1/memento/issues/315)  
> **전제:** [#313](https://github.com/jee1/memento/issues/313) 정책 A(저장소 `.slopconfig`에 spec 대량 ignore 없음). 스캔은 `slop-detector --project packages --js --config .slopconfig.yaml` 등으로 재현.

## 우선순위 (제안)

| 순위 | 영역 | 후보 경로(패키지 루트 기준) | 제안 PR 제목 (예시) |
|------|------|---------------------------|---------------------|
| 1 | DB 초기화·마이그레이션 | `packages/memento-core/src/infrastructure/database/database/init.ts`, `.../migrate.ts` | refactor(core): slim DB init/migrate for slop readability |
| 2 | 검색·임베딩 | `packages/memento-core/src/domains/anchor/services/anchor/n-hop-search-service.ts`, `packages/memento-core/src/domains/memory/services/memory-embedding-service.ts`, `packages/memento-core/src/test/helpers/vector-search-quality-metrics.ts`(대형 헬퍼; `quality-metrics-collector` 등에서 import) | refactor(core): reduce complexity in search/embedding paths |
| 3 | 트리플 추출 | `packages/memento-core/src/domains/relation/services/triple-extraction/` (우선 `triple-extraction-service.ts`) | refactor(core): split triple extraction pipeline |
| 4 | HTTP admin | `packages/memento-server/src/**` admin 라우트 | refactor(server): modularize admin routes |

## PR 쪼개기 규칙

- 한 PR에 **한 주제**(한 디렉터리 또는 1~2 파일)만; `any` 제거·함수 분해·중첩 완화 중심.
- **스키마·동작 변경 없음** 원칙은 [AGENTS.md](../../../AGENTS.md) 품질 게이트 준수.
- 머지 전: 해당 패키지 `npm run test`·`lint`·`type-check` (또는 루트 스크립트).

## 착수 순서 (첫 1~2건)

1. ~~**PR-A:** `database/init.ts` / `database/migrate.ts`~~ — 머지됨: [`migrate.ts` #322](https://github.com/jee1/memento/pull/322), [`init.ts` 레거시 스키마 분해 #325](https://github.com/jee1/memento/pull/325). 추가 분해는 재스캔 후 필요 시만.
2. ~~**PR-B (1/2):** `n-hop-search-service.ts`~~ — 단일 파일 slop 비교로 선정 후 [#327](https://github.com/jee1/memento/pull/327)에서 `searchNHop` 분해·`any` 초기화 제거.
3. ~~**PR-B (2/2):** `memory-embedding-service.ts`~~ — [#328](https://github.com/jee1/memento/pull/328): 저장/검색 헬퍼 분리, stderr 이모지 → ASCII 진단 태그.
4. ~~**순위 2 잔여:** `vector-search-quality-metrics.ts`~~ — [#329](https://github.com/jee1/memento/pull/329): Kendall tau-b·vector-only/consolidation 점수 헬퍼 분리(동작·export 동일).
5. ~~**순위 3:** `triple-extraction-service.ts` + 파이프라인~~ — [#330](https://github.com/jee1/memento/pull/330): `triple-extraction-llm-pipeline.ts`로 LLM 호출·파싱·초기화 로깅 분리, `enqueueExtractionLog`로 중복 제거.
6. ~~**순위 4:** `memento-server` admin 라우트~~ — [#331](https://github.com/jee1/memento/pull/331): `admin.routes.ts`를 `routes/admin/*` 등록 모듈로 분할(경로·핸들러 동일).
7. ~~**재스캔:** `slop-detector --project packages --js --config .slopconfig.yaml`~~ — 아래 **재스캔 스냅샷** 반영(2026-05-10).
8. **다음 (프로덕션 소스 우선):** 아래 표의 **비-spec·비-test** `CRITICAL_DEFICIT`부터 단일 주제 PR. `llm-based-relation-extractor.ts` 1차 분해는 [#347](https://github.com/jee1/memento/pull/347)(머지 후 재스캔 권장). 그 외 우선 후보: `batch-scheduler.ts`, `hybrid-search-engine.ts`, `recall-tool.ts`(별도 PR 미열렸다면 여전히 상위), `triple-extraction-llm-providers.ts`(SUSPICIOUS·참고). 테스트 전용 노이즈는 [#221](https://github.com/jee1/memento/issues/221) 정책대로 **커밋된** `.slopconfig`에 대량 ignore 없음; 로컬은 [DEVELOPMENT_RULES.md](../../../DEVELOPMENT_RULES.md)의 `.slopconfig.local.yaml` 권장.

## 재스캔 스냅샷 (2026-05-10, PR #347 워킹트리 기준 2차)

- **도구:** `ai-slop-detector==3.7.3`, 명령: `slop-detector --project packages --js --config .slopconfig.yaml --no-color`
- **관찰:** `CRITICAL_DEFICIT` 다수가 `*.spec.ts`, `src/test/**`, `mcp-client/examples/**` — 백로그 1차 범위(프로덕션)와 분리해 해석할 것.
- **프로덕션 `CRITICAL_DEFICIT` (`packages/` 기준·`*.spec.ts`·`__tests__`·`src/test/**` 제외한 상위):**

| 우선(가칭) | 경로 |
|-------------|------|
| A | `memento-core/src/infrastructure/scheduler/batch-scheduler.ts` |
| B | `memento-core/src/domains/search/algorithms/hybrid-search-engine.ts` |
| C | `memento-core/src/domains/memory/tools/recall-tool.ts` |
| D | `memento-core/src/domains/relation/services/llm-based-relation-extractor.ts` — [#347](https://github.com/jee1/memento/pull/347)에서 Ollama 파싱·JSON trim·에러 로그 공통화 후에도 도구상 CRITICAL 잔존(`determineProvider`, `filterCandidatesByEmbedding`, `extractWithOpenAI`, `extractWithOllama` 등); 머지 후 재스캔으로 점수 변화 확인 |
| (테스트 헬퍼, 지속) | `memento-core/src/test/helpers/vector-search-quality-metrics.ts` — [#329](https://github.com/jee1/memento/pull/329) 이후에도 도구상 Critical 잔존 가능; `generateOrderPreservationReport` 등 추가 분해 시 재평가 |

- **SUSPICIOUS 예시 (참고):** `triple-extraction-llm-providers.ts` 등 — 필요 시 별도 소과제 PR.

## 진행 기록

| 날짜 (UTC) | 대상 | PR | 요약 |
|------------|------|-----|------|
| 2026-05-10 | `.../database/migrate.ts` | [#322](https://github.com/jee1/memento/pull/322) | duplicate column / `catch (err: unknown)` 정리 |
| 2026-05-10 | `.../database/init.ts` | [#325](https://github.com/jee1/memento/pull/325) | `_ensureLegacySchema` → `ensureLegacyMemoryEmbeddingColumns` 등 분해, VEC 차원 주석 유지 |
| 2026-05-10 | `.../anchor/n-hop-search-service.ts` | [#327](https://github.com/jee1/memento/pull/327) | hop 병합·랭킹 헬퍼 추출, `requireVectorContext`로 초기화 통일 |
| 2026-05-10 | `.../memory/services/memory-embedding-service.ts` | [#328](https://github.com/jee1/memento/pull/328) | 호환성/INSERT·vec SQL·맵 헬퍼, stderr ASCII 태그 |
| 2026-05-10 | `.../test/helpers/vector-search-quality-metrics.ts` | [#329](https://github.com/jee1/memento/pull/329) | Kendall tau-b·하이브리드 점수 pick 헬퍼 추출 |
| 2026-05-10 | `.../triple-extraction/triple-extraction-service.ts` (+ pipeline) | [#330](https://github.com/jee1/memento/pull/330) | LLM raw 호출·파싱·init 로깅 모듈 분리, 로깅 enqueue 헬퍼 |
| 2026-05-10 | `memento-server/.../routes/admin.routes.ts` (+ admin/*.routes) | [#331](https://github.com/jee1/memento/pull/331) | 통계·리뷰·배치·성능·도구·프로젝트 메모리 라우트 모듈화 |
| 2026-05-10 | `slop-detector` packages 재스캔 | (문서) | `ai-slop-detector` 3.7.3; 프로덕션 후보 batch-scheduler / hybrid-search-engine / recall-tool / llm-based-relation-extractor |
| 2026-05-10 | `.../relation/services/llm-based-relation-extractor.ts` | [#347](https://github.com/jee1/memento/pull/347) | Ollama 응답 파싱·JSON 정리 헬퍼 분리, `buildOllamaErrorLogContext`, `checkOllamaModel` 타입 보강; slop 잔여 이슈는 PR 본문·머지 후 재스캔 참고 |

## 갱신

재스캔 후 상위 파일이 바뀌면 이 표를 갱신하고 [#315](https://github.com/jee1/memento/issues/315)에 링크한다.
