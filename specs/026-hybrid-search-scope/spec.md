# Feature Specification: VectorSearchRepository.hybridSearch Scope Filters

**Feature Branch**: `026-hybrid-search-scope`  
**Created**: 2026-06-18  
**Issue**: [#387](https://github.com/jee1/memento/issues/387)

## Requirements

- FR-001: `VectorSearchOptions.project_id` / `owner_id`를 `hybridSearch` SQL(vector CTE·text CTE·벡터 전용 분기)에 `search()`와 동일 규칙으로 반영한다.
- FR-002: 빈 문자열·빈 배열 owner_id는 스코프 미적용(`search()`와 동일).
- FR-003: 스코프 필터가 있을 때 prefetch limit 배수는 `search()`와 동일하게 `limit * 5`를 사용한다.
- FR-004: `vector-search.repository.spec.ts`에 스코프가 적용된 `hybridSearch` 회귀 테스트를 추가한다.

## Success Criteria

- `hybridSearch`가 project_id/owner_id로 결과를 필터링한다.
- lint, type-check, test pass.
