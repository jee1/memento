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
4. **다음 (순위 2 잔여):** `vector-search-quality-metrics.ts` 등 대형 헬퍼 — 재스캔 후 단일 파일 PR 권장.
5. **다음 (순위 3):** `triple-extraction-service.ts` 중심 트리플 추출 파이프라인 분해.

## 진행 기록

| 날짜 (UTC) | 대상 | PR | 요약 |
|------------|------|-----|------|
| 2026-05-10 | `.../database/migrate.ts` | [#322](https://github.com/jee1/memento/pull/322) | duplicate column / `catch (err: unknown)` 정리 |
| 2026-05-10 | `.../database/init.ts` | [#325](https://github.com/jee1/memento/pull/325) | `_ensureLegacySchema` → `ensureLegacyMemoryEmbeddingColumns` 등 분해, VEC 차원 주석 유지 |
| 2026-05-10 | `.../anchor/n-hop-search-service.ts` | [#327](https://github.com/jee1/memento/pull/327) | hop 병합·랭킹 헬퍼 추출, `requireVectorContext`로 초기화 통일 |
| 2026-05-10 | `.../memory/services/memory-embedding-service.ts` | [#328](https://github.com/jee1/memento/pull/328) | 호환성/INSERT·vec SQL·맵 헬퍼, stderr ASCII 태그 |

## 갱신

재스캔 후 상위 파일이 바뀌면 이 표를 갱신하고 [#315](https://github.com/jee1/memento/issues/315)에 링크한다.
