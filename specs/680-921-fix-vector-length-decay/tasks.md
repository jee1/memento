# Tasks: Vector score soft length decay (#921)

**Input**: [plan.md](./plan.md) · [spec.md](./spec.md) · [research.md](./research.md)  
**Branch**: `feature/fix-search`  
**AUTO-APPROVE**: phase checkpoints (canonical — no human pause)

## Phase 1: Setup

- [x] T001 Confirm hybrid vector path applies `filterByVectorThreshold` at executor lines ~166/~337 and `VectorSearchResult.content` is available
- [x] T002 [P] Add provisional `[vector_length_decay]` keys to `config/ranking-weights.toml` (enabled + characteristic_length=40)

## Phase 2: Foundational / TDD

- [x] T003 [TDD] Add `vector-length-decay.ts` + RED specs: factor monotone in length; apply short(21/22) vs long(663) inverts ranking given issue-like raw scores — `vector-length-decay.spec.ts`
- [x] T004 [TDD] Extend ranking-weights-loader / version payload expectations for decay fields — RED then GREEN with loader change
- [x] T005 [TDD] Executor/outcome integration: decay runs before threshold (fixture) — RED until wired

## Phase 3: Implementation (US1–US3)

- [x] T006 Implement pure factor + `applyVectorLengthDecay`
- [x] T007 Extend `RankingWeightsConfig` / loader validation + `getRankingVersionPayload`
- [x] T008 Wire apply before both `filterByVectorThreshold` calls in `hybrid-vector-search-executor.ts`
- [x] T009 GREEN all new/updated specs; no create-path length gate

## Phase 4: Quality + Docs + Gates

- [x] T010 [P] Document formula in `docs/agents/search-ranking.md`
- [x] T011 Run quality/nightly harness before/after (or record blocker if env lacks embeddings); update `research.md` / progress.yml with numbers or skip rationale
- [x] T012 [P] `npm run type-check`
- [x] T013 [P] Domain vitest for touched specs
- [x] T014 Rebuild graphify after code change
- [x] T015 [REVIEW] simplify + superspec.review vs FR-001..008 / SC-001..005

## Dependencies

T001 → T002/T003 → T004/T005 → T006/T007/T008 → T009 → T010/T011/T012/T013/T014 → T015

## Checkpoint

After T015 PASS: summary report; commit/PR only on explicit user request.
