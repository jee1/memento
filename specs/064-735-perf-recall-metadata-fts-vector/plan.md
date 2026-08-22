# Implementation Plan: Recall metadata wait removal & FTS·vector parallelism

**Branch**: `jee1/perf-recall-metadata-fts-vector`
**Spec**: `specs/064-735-perf-recall-metadata-fts-vector/spec.md`
**Issue**: #735
**Parent Epic**: #733

## Summary

두 곳만 고친다.

1. **Meta stats read-your-write**: `getStats` / `getStatsById`가 기존 `statsBuffer`(pending debounce writes)를 DB row 위에 overlay한다. `getMetaStatsForResults`의 `setTimeout(..., 150)`을 삭제한다.
2. **Hybrid 분기 병렬**: `HybridSearchEngine.search`에서 `executeTextSearch`와 `vectorExecutor.execute`를 `Promise.all`로 동시에 시작한다. vector promise를 먼저 띄워 embedding async가 FTS 동기 I/O와 겹치게 한다. `resultRanker.combineAndSortResults` 입력/로직은 그대로다.

새 cache, queue, ranking weight, provider 내부 병렬화는 없다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules
**Primary Dependencies**: 기존 `@memento/core` (better-sqlite3, sqlite-vec, Vitest). 신규 dependency 없음.
**Storage**: 기존 `meta_memory_stats` + in-memory `statsBuffer` (100ms debounce). 스키마 변경 없음.
**Testing**: Vitest. fake timers 또는 무대기 단언 + delayed-mock hybrid timing.
**Target Platform**: MCP server / HTTP admin (동일 core 경로)
**Project Type**: npm workspaces library (`packages/memento-core`)
**Performance Goals**: metadata 경로에서 고정 150ms 제거. delayed-mock hybrid ≈ max(FTS, vector).
**Constraints**: ranking 공식·weight 불변. 새 cache/queue 금지. #736 scope-filter 회귀 유지.
**Scale/Scope**: 2–3 production files + 해당 spec.

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Test-First | PASS — 실패 테스트 먼저 (무대기 meta_stats, max-not-sum hybrid). 기존 ranking 테스트는 회귀 신호. |
| II. Public contracts | PASS — MCP recall 응답 필드 유지. `meta_stats`가 이번 호출을 더 정확히 반영 (버그 수정에 가깝고 breaking 아님). |
| III. Schema/migration | PASS — 마이그레이션 없음. |
| IV. Quality gates | PASS — lint, type-check, targeted tests, graphify. |
| V. Observability | PASS — 기존 로그/telemetry 경로 유지. sleep 제거로 `query_time`이 실제 검색에 가까워짐. |

Re-check after implementation: ranking tests still green; no `setTimeout(..., 150)` in envelope.

## Architecture

```text
RecallTool.handle
  ├─ HybridSearchEngine.search
  │     Promise.all([
  │       vectorExecutor.execute(...),   // start first (embedding async)
  │       executeTextSearch(...),        // FTS
  │     ])
  │     → resultRanker.combineAndSortResults(text, vector, ...)  // unchanged
  ├─ collectMetaMemoryStats → MetaMemoryService.recordRecall  // buffers statsBuffer
  └─ include_metadata
        getMetaStatsForResults
          (no sleep)
          metaMemoryService.getStats({ memory_ids })
            → DB row overlay statsBuffer  // pending visible immediately
```

## Module boundaries

| Module | Role |
|--------|------|
| `packages/memento-core/src/domains/memory/introspection/meta-memory-service.ts` | `getStats`/`getStatsById`가 `statsBuffer` overlay. debounce flush 유지. |
| `packages/memento-core/src/domains/memory/recall/recall-tool-envelope.ts` | `getMetaStatsForResults`에서 150ms sleep 삭제. |
| `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts` | FTS·vector `Promise.all`. ranker 호출 불변. |
| `meta-memory-service.spec.ts` | 무대기 read-your-write. |
| `recall-tool.spec.ts` | meta_stats 테스트에서 내부 sleep 의존 제거. |
| `hybrid-search-engine.spec.ts` | delayed-mock max-not-sum. |

## Data flow

### Meta stats

1. `recordRecall`이 `statsBuffer`에 쓰고 100ms debounce flush를 스케줄한다 (기존).
2. 같은 요청에서 `getStats`가 DB SELECT 후 `statsBuffer`에 같은 `memory_id`가 있으면 buffer 값으로 overlay한다.
3. 응답 `meta_stats`는 pending을 포함한다. DB 반영은 기존처럼 debounce 후(또는 `destroy()` flush).

Overlay가 flush-on-read보다 맞다: 이슈 문구가 “pending을 즉시 읽기”이고, recall hot path에 강제 DB write를 넣지 않는다. 새 자료구조 없음.

`getStatsById`도 overlay해야 한다. `recordRecall`이 호출 시작 시 DB만 보면 같은 debounce 창의 이전 호출과 합산 의미가 달라질 수 있다. overlay하면 in-call `currentCallBuffer`와 함께 일관된다. 기존 “창 안 마지막 쓰기” debounce는 `statsBuffer.set` last-write-wins로 유지한다.

### Hybrid parallel

1. `vectorExecutor.execute` promise를 먼저 만든다 (query embedding await 지점).
2. `executeTextSearch` promise를 만든다.
3. `Promise.all`로 둘 다 기다린다.
4. 기존처럼 `combineAndSortResults(textResults, vectorOut.results, ...)`.

실패: 지금 `executeTextSearch`는 throw → `SearchError`. vector executor의 기존 fallback/`fallback_used`를 바꾸지 않는다. `Promise.all`은 한쪽 reject 시 전체를 reject하므로, 현재 직렬 경로와 동일한 전파다. vector가 내부에서 catch하고 빈 결과+fallback을 돌려주면 그것도 그대로다.

## Config / env

없음. ranking-weights.toml 수정 없음.

## Test strategy

Red → Green. Constitution I.

1. **US1**: `getStats` after `recordRecall` without `setTimeout`/`vi.advanceTimers` → `recall_count` includes this call. Envelope: grep/assert no `setTimeout(..., 150)`. `recall-tool.spec.ts` meta_stats 케이스에서 handle 이후 150ms 대기를 제거하거나 destroy-only로 바꾼다 (응답 단언은 handle 직후).
2. **US2**: text/vector mock에 `delay(A)`/`delay(B)` (예: 80ms/40ms). `search()` elapsed < A+B − margin 이고 ≥ max(A,B). ranker `combineAndSortResults` spy 인자가 직렬과 동일 집합.
3. **US3**: 기존 `hybrid-search-engine.spec.ts` / `hybrid-search-engine-consolidation.spec.ts` / recall score_breakdown 테스트 그대로 실행. 이 이슈에서 ranker·weights 파일 수정 금지.
4. **US4**: CI gate는 delayed-mock. 실제 p95는 `recall_profile` 또는 #737 `memento_prod` p95를 로컬로 한 줄 기록 (CHANGELOG 또는 spec 폴더 note). CI에서 전체 LongMemEval 강제 안 함.
5. Scope-filter 회귀: 기존 recall-tool scope 테스트 유지.
6. `npm run lint` && `npm run type-check` && targeted vitest && graphify rebuild.

## Risks

| Risk | Mitigation |
|------|------------|
| better-sqlite3 FTS가 동기라 Promise.all이 CPU를 안 겹침 | 계약은 mock async delay + vector embedding await. vector를 먼저 start. |
| overlay가 debounce “마지막만 반영”을 깨뜨림 | buffer는 계속 last-write-wins. overlay는 읽기만. |
| `getStatsById` overlay가 recordRecall 누적에 영향 | 의도됨: pending을 봐야 같은 창의 연속 recall이 DB stale을 안 본다. in-call `currentCallBuffer`는 유지. |
| Promise.all이 vector 내부 fallback을 삼킴 | executor가 reject하지 않고 fallback object를 반환하는 현재 계약을 유지. 새 catch 넣지 않음. |
| 테스트가 실제 150ms sleep에 의존 | 해당 단언을 무대기로 교체. meta-memory debounce 테스트(버퍼 flush 자체)는 유지. |

## Complexity Tracking

해당 없음. 기존 모듈 두 경로의 최소 변경.
