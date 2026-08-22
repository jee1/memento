# Implementation Plan: remember write-path near-duplicate

**Branch**: `jee1/feat-memory-remember-write-path-near-duplicate`
**Spec**: `specs/059-730-remember-write-path-near-duplicate/spec.md`
**Issue**: #730
**Parent Epic**: #727
**Date**: 2026-08-13

## Summary

012 `buildSimilarityWarning`를 **설정 가능·스코프 확장·pre-insert·merge/strict**로 진화시킨다.
새 MCP 도구·스키마 마이그레이션·LLM merge 없음. 검색 `duplication_penalty` 불변.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules
**Primary Dependencies**: 기존 `@memento/core` (better-sqlite3, sqlite-vec, Zod, Vitest). 신규 dependency 없음.
**Storage**: 기존 `memory_item` + vector index. 스키마 변경 없음.
**Testing**: Vitest — mock embedding/vector search로 identical / similar / dissimilar.
**Target Platform**: MCP `remember` + HTTP admin tools (동일 core 경로)
**Project Type**: npm workspaces (`packages/memento-core`)
**Performance Goals**: remember 경로에 벡터 검색 1회 추가(기존과 동일 상한 limit≈8). p95에 큰 영향 없어야 함; 실패 시 fail-open.
**Constraints**: MCP remember 기존 성공 필드 유지; additive warning만. Constitution I Test-First.
**Scale/Scope**: config + remember-tool-memory-item(+가능 시 소형 helper 모듈) + tests + docs.

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Test-First | PASS — 실패 테스트 먼저 (warning shape, scope, strict, incremental). |
| II. Public contracts | PASS — additive `similarity_warning` 확장; 기본 warn은 저장 성공 유지. |
| III. Schema/migration | PASS — 마이그레이션 없음. |
| IV. Quality gates | PASS — lint, type-check, **full `npm test`** (T019). T018 targeted는 선행 회귀용. graphify rebuild. |
| V. Observability | PASS — 기존 `memory.write.completed`에 dedup action/mode 힌트 가능(선택). |

## Architecture

```text
RememberTool.handleMemoryItem
  ├─ parse DedupPolicy from mementoConfig / env
  │     threshold ← MEMENTO_REMEMBER_DEDUP_THRESHOLD (default 0.85)
  │     mode      ← MEMENTO_REMEMBER_DEDUP_MODE (warn|strict|off)
  ├─ if mode != off:
  │     candidates ← findNearDuplicateCandidates(content, {type,owner,project}, threshold)
  │       (VectorSearchEngine + embedding; filter soft-delete, scope)
  ├─ branch (Assumptions §9):
  │     1) type=procedural && update_mode set && findExistingProceduralMemory hit
  │          → 기존 procedural replace/incremental/versioned (near-dup merge 미적용)
  │     2) else if update_mode=incremental && candidates[0]
  │          && type ∈ {working,episodic,semantic}
  │          → near-dup UPDATE (Assumption §6)
  │     3) else if MODE=strict && candidates.length > 0 → reject (no INSERT)
  │     4) else if MODE=off → INSERT (검색 스킵)
  │     5) else → INSERT (+ warn if candidates && MODE=warn)
  │     search failure → fail-open INSERT
  └─ response.similarity_warning? = { count, similar_ids, candidates, suggestion?, action? }
```

Reuse:

- `getVectorSearchEngine()` / embedding path already in `buildSimilarityWarning`
- sleep-consolidation **threshold 철학(0.85)** 만 참고 — 배치 re-summarize 로직은 복사하지 않음
- procedural `update_mode` 경로(`findExistingProceduralMemory`)는 그대로; near-dup는 공통 경고만
  (procedural hit 시 near-dup incremental merge 미적용)

## Module boundaries

| Path | Change |
|------|--------|
| `packages/memento-core/src/shared/config/` | env 파서: threshold, mode |
| `packages/memento-core/src/domains/memory/remember/remember-tool-memory-item.ts` | pre-insert candidate + branch |
| `packages/memento-core/src/domains/memory/remember/remember-near-duplicate.ts` (신규, 선택) | candidate 검색·warning shape 순수 함수 — 파일 비대화 시 추출 |
| `packages/memento-core/src/domains/memory/tools/__tests__/remember-tool.spec.ts` 또는 전용 spec | FR-009 케이스 |
| `docs/agents/agent-workflow.md` (또는 remember 가이드) | warn→incremental 습관 |
| `docs/agents/commands.md` | env 표 |
| `CHANGELOG.md` | Unreleased |

## Data / Config

| Env | Default | Notes |
|-----|---------|-------|
| `MEMENTO_REMEMBER_DEDUP_THRESHOLD` | `0.85` | (0, 1]; invalid → default + stderr warn |
| `MEMENTO_REMEMBER_DEDUP_MODE` | `warn` | `warn` \| `strict` \| `off` |

No DB columns. No migration.

## Response contract (additive)

```ts
similarity_warning?: {
  count: number;
  similar_ids: string[];
  candidates: Array<{ id: string; similarity: number }>;
  suggestion?: 'incremental';
  action?: 'warned' | 'merged' | 'rejected';
}
```

`strict` 거절 시 (ToolResult error — 구현 시 `createErrorResult` 시그니처에 맞춰 조정):

```ts
{
  success: false,
  error: { code: 'NEAR_DUPLICATE', message: '...' },
  data: {
    similarity_warning: {
      count: number;
      similar_ids: string[];
      candidates: Array<{ id: string; similarity: number }>;
      suggestion: 'incremental';
      action: 'rejected';
    }
  }
}
```

## Test strategy

1. **Unit (mock vector)**: identical → warn; similar ≥ threshold → warn; dissimilar → no warn
2. **Scope**: other project_id / other owner_id → no warn
3. **strict**: no new row; rejected payload has candidates
4. **incremental**: row count stable; content/importance/tags updated
5. **fail-open**: vector throws → INSERT succeeds, no warning
6. **mode=off**: no search call (spy) or no warning
7. **procedural regression**: existing update_mode replace/incremental tests still green

## Risks

| Risk | Mitigation |
|------|------------|
| Pre-insert로 latency↑ | limit 8 유지; mode=off로 완전 스킵; 실패 fail-open |
| incremental content replace가 정보 손실 | Assumption 문서화; LLM merge는 비범위 |
| 012 post-insert 대비 self-hit | pre-insert라 self id 없음; post path 제거로 단순화 |
| Serena/worktree 경로 혼선 | 이 worktree에서만 편집·테스트 |

## Phased delivery

1. **Phase A (MVP)**: config + pre-insert candidates + warn response + tests + docs env
2. **Phase B**: strict mode
3. **Phase C**: episodic/semantic incremental merge + agent habit docs
4. **Polish**: CHANGELOG, graphify, lint/type-check/test

## Complexity Tracking

N/A — 기존 경로 확장, 새 추상화 최소.
