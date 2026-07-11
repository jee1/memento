# Implementation Plan: Epic #680

**Branch**: `049-tech-debt-680-epic`
**Worktree**: `~/git/memento-worktrees/issue-680-tech-debt`

## Phases

### P0 — Transport parity (#681)
- `message-processor.ts` / `http-server-websocket.ts`: `result: toolResult`
- `runtime-transport-parity.spec.ts`

### P1 — God nodes (#682, #683, #684)
- LLM initializer: `llm-client-initializer/` subdir (tests mirror)
- Search ranking: `search-ranking/` pure functions + thin class
- Batch scheduler: `batch-scheduler/` job-processor, status, wiring

### P2 — Medium files (#685–#689)
- Reflexion worker: health, event-queue, metrics modules
- Memento client: domain clients under `client/`
- Embedding migration, database utils, relation validator: topic splits

### P3 — Chore (#690–#692)
- Minor `npm update` (wanted only)
- Major deps spike markdown
- `vector-search-quality-metrics/` split by Kendall/Spearman/TopK

## Test Strategy

- Per-issue existing vitest specs must stay green
- `npm run lint && npm run type-check && npm test` before PR
- graphify rebuild after code changes

## PR

Single PR `chore(tech-debt): epic #680` with `Fixes #681` … `Fixes #692`, `Part of #680`
