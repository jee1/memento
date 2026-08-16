# Tasks: Epic #785 Production Recall 격차 진단 및 검색 정확성 복원

**Input**: `specs/061-785-epic-search-production-recall/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md
**Branch**: `jee1/epic-search-production-recall`

Tests are required (constitution I). Write failing tests first.

## Phase 1: Setup

- [x] T001 Write spec.md / plan.md / research.md / data-model.md / tasks.md under `specs/061-785-epic-search-production-recall/`

---

## Phase 2: Foundational

- [x] T002 Confirm current production/search baselines still green:
  `npm test -- packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts scripts/agent-memory-production-adapter.spec.ts scripts/agent-memory-benchmark.spec.ts`

**Checkpoint**: Foundation recorded. No ranking behavior changed yet.

---

## Phase 3: User Story 1 - funnel·재현성 (#786, P1) 🎯 MVP

**Goal**: Query별 단계 funnel과 clean git SHA / ranking-sha256가 artifact에 남고, Recall@k 스키마는 유지된다. 알고리즘은 바꾸지 않는다.

**Independent Test**: 합성 fixture production run → funnel 필드 + hashes 존재, FTS/fusion/threshold 값 불변.

### Tests (fail first)

- [x] T003 [US1] Extend `scripts/agent-memory-production-adapter.spec.ts` to require per-query ordered stages `raw_text → text_topN → raw_vector → thresholded_vector → union → final_top10` plus gold any/all/fraction
- [x] T004 [P] [US1] Extend `scripts/agent-memory-benchmark.spec.ts` so `reproduction.git_sha` is the current tree SHA, `ranking_version` matches `ranking-sha256:[a-f0-9]{12}`, and Recall@5/10/MRR/nDCG keys still exist

### Implementation

- [x] T005 [US1] Surface any missing stage counts from `packages/memento-core/src/domains/search/algorithms/hybrid-search-engine.ts` / vector executor (raw vs thresholded) without storing document bodies
- [x] T006 [US1] Record funnel + gold hits + provider/fallback/threshold/prefetch/weights in `scripts/agent-memory-production-adapter.ts`
- [x] T007 [US1] Write ranking_version, weights-path override, fixture/evaluator/eligible-excluded hashes in `scripts/agent-memory-benchmark.ts` reproduction/scorecard
- [x] T008 [US1] Add targeted tests for funnel field meaning and stage ordering (adapter or hybrid-search-engine spec)
- [x] T009 [US1] Run adapter + benchmark specs; confirm no FTS/fusion/threshold production constant edits in this phase

**Checkpoint**: US1 independently testable. Algorithms unchanged.

---

## Phase 4: User Story 2 - FTS5·BM25 (#787, P1)

**Goal**: SQLite FTS5 rank 계약(낮은 값이 더 좋음, 음수 허용)과 선택한 query semantics가 테스트로 고정된다.

**Independent Test**: in-memory FTS5에서 best match가 먼저 오고, 음수 rank가 relevance로 변환되며 순서가 보존된다.

### Tests (fail first)

- [x] T010 [US2] Add real in-memory FTS5 ordering test in `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts` (or sibling spec): best BM25 match first
- [x] T011 [P] [US2] Add negative-rank relevance test covering `packages/memento-core/src/domains/search/algorithms/search-engine/search-engine-ranking.ts` (`ftsRank > 0` must not be required)

### Implementation

- [x] T012 [US2] Fix `ORDER BY fts_rank` in `packages/memento-core/src/domains/search/algorithms/search-engine/search-engine-sql-builder.ts` to SQLite BM25 contract (keep filters-before-LIMIT)
- [x] T013 [US2] Convert signed FTS5 rank to relevance with order preserved in `search-engine-ranking.ts`
- [x] T014 [US2] Ablate short-AND / long first-8 OR / all-token OR via `packages/memento-core/src/domains/search/algorithms/search-engine/search-engine-fts-query.ts` + `HYBRID_SEARCH` constants; record results under this spec dir; pick the semantics that improves zero-hit and candidate recall within latency budget
- [x] T015 [US2] Report SQL candidate recall and engine top-N recall separately in scorecard types (`scripts/agent-memory-benchmark.ts` / adapter)
- [x] T016 [US2] Run search-engine + hybrid-search-engine targeted tests, type-check, lint, core search specs

**Checkpoint**: US2 independently testable. Funnel still records text stages.

---

## Phase 5: User Story 3 - fusion 점수 보존 (#788, P1)

**Goal**: combiner 결합 relevance가 final rank까지 살아 있고 text/vector monotonic contract가 통과한다.

**Independent Test**: overlap 후보 final relevance = weighted combination; vector 고정 시 text↑가 relevance를 낮추지 않음 (역도 성립).

### Tests (fail first)

- [x] T017 [US3] Add overlap + monotonic tests next to `packages/memento-core/src/domains/search/algorithms/hybrid-result-ranker.ts` (existing ranker/combiner specs)
- [x] T018 [P] [US3] Add text-only / vector-only scale-fallback tests in combiner/ranker specs
- [x] T019 [US3] Add adaptive-weight final-ordering integration test in `packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts`

### Implementation

- [x] T020 [US3] Stop overwriting combiner relevance with `vectorScore || textScore` in `hybrid-result-ranker.ts`; do not fold importance/recency/usage/feedback into relevance
- [x] T021 [US3] Align `packages/memento-core/src/test/helpers/vector-search-quality-metrics/report-comparison.ts` with the same relevance contract
- [x] T022 [US3] Record current / weighted-preserved / RRF-sim comparison note under this spec dir (synthetic CI + local LoCoMo if present)
- [x] T023 [US3] Run ranker + combiner + hybrid-search-engine targeted tests

**Checkpoint**: US3 independently testable. No vector threshold change yet.

---

## Phase 6: User Story 4 - vector threshold·prefetch (#789, P2)

**Goal**: provider 분포 근거로 threshold/prefetch(또는 top-k fill)를 고르고 ranking hash에 반영한다.

**Independent Test**: under-filled vector results get documented policy; zero-hit down and p95 < 1s on recorded run.

### Tests (fail first)

- [x] T024 [US4] Add executor tests in `packages/memento-core/src/domains/search/algorithms/` covering threshold 0/0.2/0.38 behavior and under-fill fallback

### Implementation

- [x] T025 [US4] Record provider raw similarity gold/non-gold from adapter runs (artifact only; no LoCoMo DF in core)
- [x] T026 [US4] Ablate prefetch 20/32/60 × thresholds; record in spec dir; implement chosen policy in `hybrid-vector-search-executor.ts` + `packages/memento-core/src/shared/config/constants.ts`
- [x] T027 [US4] Measure min-max normalization on/off; hashed tfidf vs sparse baseline under same reranker; do not add a new embedding dependency
- [x] T028 [US4] Ensure chosen constants change `getRankingVersion()` / recorded ranking hash
- [x] T029 [US4] Run hybrid-vector + hybrid-search-engine targeted tests

**Checkpoint**: US4 independently testable. Fusion tests still green.

---

## Phase 7: User Story 5 - memory_injection parity·gate (#790, P2)

**Goal**: engine primitive와 실제 injection이 별도 전략이고, 제안 gate가 동일 fixture에서 평가된다.

**Independent Test**: synthetic fixture shows two named paths, provenance engine→selected, adversarial excluded, gate unit tests for 0.80 / 0.20 / 1s.

### Tests (fail first)

- [ ] T030 [US5] Adapter/benchmark tests: engine strategy keeps an explicit `production_path: hybridSearchEngine.search`; injection strategy invokes real injection/bundle path
- [ ] T031 [P] [US5] Provenance test: engine IDs connect to selected injection IDs/content on `tests/fixtures/agent-memory-benchmark/locomo-shape-sample.json`
- [ ] T032 [US5] Gate unit tests for Recall@10 ≥ 0.80, zero-hit < 20%, p95 < 1s, category regression flag

### Implementation

- [ ] T033 [US5] Add injection arm using `packages/memento-core/src/domains/memory/services/knowledge-context-bundle-builder.ts` (or `memory_injection` tool path) from `scripts/agent-memory-production-adapter.ts` without requiring MCP to grow a new public ID list field
- [ ] T034 [US5] Record requested vs serialized tokens (headers/query/footer) and split fixed-item Recall@k vs fixed-token coverage in `scripts/agent-memory-benchmark.ts`
- [ ] T035 [US5] Keep LoCoMo adversarial/empty-evidence out of retrieval metrics; abstention QA separate (existing adapter rules)
- [ ] T036 [US5] Optional reader arms (no-context / oracle / production injection / FTS context) behind a flag; default off in CI
- [ ] T037 [US5] Update `docs/_work/testing/ko/benchmark-datasets.md` so internal session-retrieval ≠ official LoCoMo QA
- [ ] T038 [US5] Run `npm run quality:locomo:test` and benchmark/adapter specs

**Checkpoint**: US5 independently testable. Full 1,536 gate is local/nightly, not CI.

---

## Phase 8: Polish

- [ ] T039 [P] CHANGELOG Unreleased for #785 children actually shipped
- [ ] T040 [P] Update `docs/agents/search-ranking.md` with FTS5 BM25 sign and fusion relevance contracts
- [ ] T041 `npm run lint` && `npm run type-check`
- [ ] T042 Targeted tests (search-engine, hybrid-search-engine, ranker/combiner, adapter, benchmark)
- [ ] T043 `npm test`
- [ ] T044 graphify rebuild: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
- [ ] T045 Record LoCoMo 1,536 solo-run scorecard (if `.local/locomo/` present) against SC-006; do not commit corpus

---

## Dependencies & Execution Order

- Setup T001 done.
- Foundational T002 blocks behavior changes.
- US1 (#786) before US2–US5 (need funnel to judge later diffs).
- US2 (#787) and US3 (#788) after US1; they may proceed in parallel (different files).
- US4 (#789) after US1 and US3.
- US5 (#790) after US2, US3, US4.
- Polish after desired stories. Epic complete only when SC-006–SC-008 hold.

### Parallel opportunities

- T003/T004 after T002
- T010/T011 after US1 checkpoint
- T017/T018 after US1 checkpoint (parallel to US2)
- T030/T031/T032 after US4

## Implementation Strategy

1. Land #786 funnel/repro as the first PR if splitting.
2. Land #787 and #788 as separate PRs so scorecard deltas are attributable.
3. Land #789 only after fusion monotonic tests are green.
4. Land #790 last; engine scorecard stays comparable.

Do not retune `config/ranking-weights.toml` in these tasks.
