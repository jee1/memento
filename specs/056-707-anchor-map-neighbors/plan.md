# Implementation Plan: Epic #707 Anchor Map 이웃 복구

**Branch strategy**: 이슈별 worktree + PR  
`~/git/memento-worktrees/issue-<num>-<slug>` · base `origin/main`

**Architecture**: 배선 누락 수정 → Dashboard link 소스 정합 → vec cosine 계약 → embedding/persist 보강 → hardening

## Tech Stack
TypeScript, better-sqlite3, sqlite-vec, Vitest, Express admin handlers

## File Map (by issue)

### #708 — Wiring
- Modify: `packages/memento-core/src/bootstrap.ts`
- Keep: `packages/memento-core/src/bootstrap/anchor-stack.ts` (이미 `anchorSearchService` 반환)
- Test: `packages/memento-core/src/bootstrap/__tests__/bootstrap-relation-graph-wiring.spec.ts` (신규) 또는 기존 bootstrap/anchor 통합 테스트 확장

### #709 — Map links
- Modify: `packages/memento-server/src/server/handlers/anchor-map.handler.ts`
- Test: handler 단위/통합 테스트
- Out: hop 2/3 path edge → #715

### #713 — Cosine
- Modify: `database/schema.sql` (경로 확인 후 core schema), `init-legacy-schema.ts`, `migrate.ts`, 신규 `041-vec-cosine-metric.ts`(번호는 최신+1)
- Modify: vector result mapper, vec table DDL helpers
- Test: 비례 벡터 similarity≈1, cardinality native 필터

### #710 — Semantic embedding
- Modify: semantic 생성 경로 + backfill job/script
- Depends: #713

### #711 — Persist extraction
- Modify: `remember-tool-augmentation.ts`
- Use: `relationGraph.addRelationsBatch`

### #714 — Auto-anchor
- Modify: auto-anchor 후보 점수 로직
- Rule: 감점은 relation==0 **and** embedding 부재만

### #715 — Path edges
- Modify: n-hop result provenance + `anchor-map.handler.ts`
- Depends: #709

## Phased Delivery / PR order

1. PR #708 (specs/056 포함 가능)
2. PR #709
3. PR #713
4. PR #710 (after #713 merge or base on #713 branch)
5. PR #711 (parallel after #708)
6. PR #714, #715

## Test Strategy
- Unit: wiring mock, map builder fixtures, cosine mapper, batch persist idempotency
- Integration: searchLocal with relationGraph, map API with memory_relation only
- Quality gates per PR: `lint` · `type-check` · 관련 vitest (전체 `npm test`는 PR 전)

## Constraints (Constitution)
- Test-first for bug fixes
- Schema changes ship with migration + synchronized artifacts
- No MCP contract breaks
- Failure isolation: embedding/relation persist failures must not fail remember
