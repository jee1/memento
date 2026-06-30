# Implementation Plan: 033-semantic-memory-update-split

## Architecture

`SemanticMemoryUpdateService` god node(1168줄)를 **composition**으로 분해한다. Public import 경로(`semantic-memory-update-service.js`)와 `SemanticMemoryUpdateService` class export는 유지하고, 내부 책임만 sub-module로 이동한다.

```text
semantic-memory-update-service.ts   # 오케스트레이션, public API 위임
semantic-memory-update-types.ts     # 타입·상수·generateId
semantic-memory-scoring.ts          # confidence·importance·triple 정규화
semantic-memory-similarity.ts       # 중복 검색·임베딩 유사도
semantic-memory-crud.ts             # create·update semantic memory
semantic-memory-relations.ts        # relation type·episodic edge
semantic-memory-update-pipeline.ts  # validate·apply·process triple
```

## Changes

| 파일 | 변경 |
|------|------|
| `semantic-memory-update-types.ts` | 신규 — 공유 타입·상수 |
| `semantic-memory-scoring.ts` | 신규 — scoring·normalization |
| `semantic-memory-similarity.ts` | 신규 — dedupe·similarity |
| `semantic-memory-crud.ts` | 신규 — CRUD |
| `semantic-memory-relations.ts` | 신규 — relation setup·edges |
| `semantic-memory-update-pipeline.ts` | 신규 — update pipeline |
| `semantic-memory-update-service.ts` | 축소 — delegate only |

## Test Strategy

- 선행: `semantic-memory-update-service.spec.ts` green 확인
- 분리 후: 동일 spec 재실행
- 전체: `npm run build && npm test && npm run lint && npm run type-check`

## Constitution Alignment

- Structural refactoring exception (Constitution I): CI green = regression signal
- Backward compatibility (Constitution II): import path·public API 유지
- Quality gates (Constitution IV) 필수
