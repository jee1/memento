# Implementation Plan: 032-relation-graph-split

## Architecture

`RelationGraph` god node(1235줄)를 **composition**으로 분해한다. Public import 경로(`relation-graph.js`)와 `RelationGraph` class export는 유지하고, 내부 책임만 sub-module로 이동한다.

```text
relation-graph.ts              # 오케스트레이션, IRelationGraph 위임
relation-graph-cache.ts        # L1/L2 캐시 키·인덱스·무효화
relation-graph-cycle-detector.ts  # DFS 순환 감지
relation-graph-query.ts        # getRelations, getRelationsBatch
relation-graph-traversal.ts    # BFS getRelatedMemories
relation-graph-mutations.ts    # add/remove/update/batch
relation-graph-row-utils.ts    # row → MemoryRelation 매핑
```

## Changes

| 파일 | 변경 |
|------|------|
| `relation-graph-row-utils.ts` | 신규 — row 매핑 |
| `relation-graph-cache.ts` | 신규 — 캐시 계층 |
| `relation-graph-cycle-detector.ts` | 신규 — DFS |
| `relation-graph-query.ts` | 신규 — 조회 |
| `relation-graph-traversal.ts` | 신규 — BFS |
| `relation-graph-mutations.ts` | 신규 — 변경 |
| `relation-graph.ts` | 축소 — delegate only |

## Test Strategy

- 선행: `relation-graph.spec.ts` + `relation-graph.integration.spec.ts` green 확인
- 분리 후: 동일 spec 재실행
- 전체: `npm run build && npm test && npm run lint && npm run type-check`

## Constitution Alignment

- Structural refactoring exception (Constitution I): CI green = regression signal
- Backward compatibility (Constitution II): import path·public API 유지
- Quality gates (Constitution IV) 필수
