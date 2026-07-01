# Implementation Plan: 035-search-orchestrator-split

## Architecture

`VectorSearchRepositoryImpl`(936줄)과 `SearchEngine`(824줄) god node를 **composition**으로 분해한다. Public import 경로와 class export는 유지하고, 내부 책임만 sub-module로 이동한다.

```text
vector-search.repository.ts          # 오케스트레이션
vector-search/
  vector-search.types.ts
  vector-search-availability.ts
  vector-search-runtime-context.ts
  vector-search-scope.ts
  vector-search-result-mapper.ts
  vector-search-knn-query.ts
  vector-search-hybrid-query.ts

search-engine.ts                     # search() 파이프라인 오케스트레이션
search-engine/
  search-engine.types.ts
  search-engine-fts-query.ts
  search-engine-fts-availability.ts
  search-engine-ranking.ts
  search-engine-sql-builder.ts
```

## Changes

| 파일 | 변경 |
|------|------|
| `vector-search/*.ts` | 신규 — 벡터 검색 책임 분리 |
| `vector-search.repository.ts` | 축소 — delegate only |
| `search-engine/*.ts` | 신규 — 텍스트 검색·랭킹 책임 분리 |
| `search-engine.ts` | 축소 — search() pipeline only |

## Test Strategy

- 선행: vector-search·search-engine vitest baseline green 확인
- 분리 후: 동일 spec 재실행 (FTS5 fallback, reflection_notes 포함)
- 전체: `npm run build && npm run lint && npm run type-check`

## Constitution Alignment

- Structural refactoring exception: CI green = regression signal
- Backward compatibility: import path·public API 유지
- Mechanical extraction only — no behavior changes
