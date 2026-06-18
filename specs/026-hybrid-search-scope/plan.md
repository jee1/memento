# Implementation Plan: Issue #387

**Branch**: `026-hybrid-search-scope`

## Changes

- `packages/memento-core/src/domains/search/repositories/vector-search.repository.ts`
  - `hybridSearch`: `search()`의 `whereParts` / `scopeParams` 패턴을 vector·text CTE 및 벡터 전용 분기에 적용
- `packages/memento-core/src/domains/search/repositories/__tests__/vector-search.repository.spec.ts`
  - project_id / owner_id 스코프 `hybridSearch` 테스트
- `CHANGELOG.md` (Unreleased 한 줄)
