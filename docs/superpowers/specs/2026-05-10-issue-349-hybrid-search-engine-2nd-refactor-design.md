# Issue 349: hybrid-search-engine.ts 2차 복잡도 감소 (실행층)

> 상위: [#348](https://github.com/jee1/memento/issues/348), [#315](https://github.com/jee1/memento/issues/315)  
> 이슈: [#349](https://github.com/jee1/memento/issues/349)

## 배경

`slop-detector` 재스캔 기준 `hybrid-search-engine.ts`가 여전히 프로덕션 Critical 후보다. [#172](https://github.com/jee1/memento/issues/172) 1차에서 factory·`buildRankingContext` 등 정리가 있었으나, 엔진 파일은 대형 메서드가 남아 있다.

## 목적

`HybridSearchEngine`의 **벡터·멀티 프로바이더 실행 경로** 복잡도를 낮춘다. **검색 동작·랭킹·공개 API는 변경하지 않는다.**

## 1차 범위 (승인된 추천: A)

- 단일 프로바이더 검색 본문(`runProviderSearchTaskBody`에 해당)과 **프로바이더별 타임아웃이 있는 태스크 생성**(`createProviderSearchTask`에 해당)을 `hybrid-search-provider-parallel.ts`로 이동한다.
- 엔진은 `ProviderVectorSearchDeps`(콜백)로 `generateQueryVector`, `vectorSearchEngine.search`, 로깅을 주입한다. `SearchError` 등 도메인 예외는 기존처럼 `generateQueryVector` 경로에 남긴다(순환 import 방지).

## 비범위 (이슈와 동일)

- 랭킹 공식·가중치 변경
- `recall` / batch scheduler / relation extractor 정리
- search subsystem 전면 재설계
- **2차 이후(별 PR)**: 랭킹·정규화 파이프라인(`normalizeAndDeduplicateResults` 체인) 분리 검토

## 완료 기준

- `hybrid-search-engine.ts` 라인 수·해당 메서드 복잡도 감소
- `npm run type-check`, 관련 Vitest 통과
- PR 또는 이슈 코멘트에 `slop-detector` 재스캔 결과 요약(가능 시)

## 검증

- `packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts`
- `hybrid-search-engine-consolidation.spec.ts` (회귀)
