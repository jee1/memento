# Implementation Plan: 037-infrastructure-refactor

## Architecture

`async-optimizer.ts`(746줄)과 `reflexion-procedural-memory-service.ts` god node를 **composition**으로 분해한다. Public import 경로와 export는 유지하고, 내부 책임만 sub-module로 이동한다.

```text
async-optimizer.ts                     # re-export orchestrator (≤500 lines)
async-optimizer/
  async-optimizer.types.ts
  async-optimizer-parsers.ts
  async-task-queue.ts
  async-task-worker.ts
  batch-processor.ts

reflexion-procedural-memory-service.ts # orchestrator (convert, updateProceduralMemory)
reflexion-procedural-memory-service/
  reflexion-procedural-extraction.ts
  reflexion-procedural-create.ts
  reflexion-procedural-update-replace.ts
  reflexion-procedural-update-incremental.ts
  reflexion-procedural-update-versioned.ts
```

## Changes

| 파일 | 변경 |
|------|------|
| `async-optimizer/*.ts` | 신규 — 큐·워커·파서·배치 책임 분리 |
| `async-optimizer.ts` | 축소 — re-export only |
| `reflexion-procedural-memory-service/*.ts` | 신규 — 추출·생성·업데이트 모드 분리 |
| `reflexion-procedural-memory-service.ts` | 축소 — delegate + early-return |

## Test Strategy

- 선행: reflexion-worker·failure-detector vitest baseline green 확인
- 분리 후: 동일 spec 재실행
- 전체: `npm run lint && npm run type-check && npm test`

## Constitution Alignment

- Structural refactoring exception: CI green = regression signal
- Backward compatibility: import path·public API 유지
- Mechanical extraction only — no behavior changes
