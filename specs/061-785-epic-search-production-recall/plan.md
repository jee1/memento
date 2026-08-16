# Implementation Plan: Epic #785 Production Recall 격차 진단 및 검색 정확성 복원

**Branch**: `jee1/epic-search-production-recall`
**Date**: 2026-08-16
**Spec**: [spec.md](./spec.md)
**Issue**: #785
**Children**: #786 #787 #788 #789 #790

## Summary

LoCoMo production Recall@10 격차(0.38 vs FTS 0.88)를 **관측 → 텍스트 계약 → fusion 계약 → 벡터 후보 정책 → 실제 injection gate** 순으로 최소 수정한다. 새 모델·reranker·parser·마이그레이션 없음. 전역 ranking weight 튜닝은 P0 복원 이후에도 이 에픽의 기본 경로가 아니다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules
**Primary Dependencies**: 기존 `@memento/core` (better-sqlite3, sqlite-vec, Vitest). 신규 dependency 없음.
**Storage**: SQLite 스키마 불변. Scorecard JSON artifact만 확장.
**Testing**: Vitest. in-memory FTS5 for BM25; synthetic locomo-shape fixture in CI; full LoCoMo 1,536 local/nightly.
**Target Platform**: MCP server / HTTP admin (동일 core 검색 경로)
**Project Type**: npm workspaces library (`packages/memento-core`) + benchmark scripts
**Performance Goals**: 제안 gate p95 < 1s; 기존 hybrid p95 예산 유지
**Constraints**: 전역 weight 튜닝 금지(P0 전). LoCoMo 원본 커밋 금지. MCP 응답 필드 유지.
**Scale/Scope**: search ranking + production adapter + injection provenance. 대략 8–12 production files + specs/tests.

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Test-First | PASS — 각 US는 실패 테스트 먼저 (funnel schema, FTS order, monotonic fusion, threshold fallback, injection provenance). |
| II. Public contracts | PASS — MCP recall/`memory_injection` 필드 유지. 결과 **순서**는 correctness 복원으로 바뀔 수 있음. 문서에 명시. |
| III. Schema/migration | PASS — DB 마이그레이션 없음. |
| IV. Quality gates | PASS — lint, type-check, targeted + full test, graphify. |
| V. Observability | PASS — 기존 engine funnel counts를 artifact로 승격. 새 telemetry stack 없음. |

Re-check after each child issue: ranking tests green; `production_vs_fts` still defined; LoCoMo license paths unchanged.

## Architecture

```text
HybridSearchEngine.search
  ├─ executeTextSearch
  │     buildFTSQuery          # AND vs first-8 OR vs all-token OR (#787 ablation)
  │     SQL ORDER BY fts_rank  # BM25 부호·정렬 (#787)
  │     applyRanking           # ftsRank > 0 가정 제거 (#787)
  ├─ HybridVectorSearchExecutor
  │     threshold / prefetch   # provider별 또는 top-k fill (#789)
  ├─ SearchResultCombiner      # text*w_t + vector*w_v  (#788 유지)
  └─ HybridResultRanker        # relevance = combiner 결합값 (#788 복원)
        getRankingVersion()    # ranking-sha256 기록 (#786)

agent-memory-production-adapter
  ├─ engine strategy  → search() IDs + funnel + hashes (#786)
  └─ injection strategy → memory_injection / KnowledgeContextBundle
                          engine IDs → selected IDs + tokens (#790)

agent-memory-benchmark
  └─ scorecard + gates.production_vs_fts + proposed recall/zero-hit/p95 gate
```

## Module boundaries

| Module | Role | Child |
|--------|------|-------|
| `scripts/agent-memory-production-adapter.ts` | funnel, hashes, optional injection arm | #786 #790 |
| `scripts/agent-memory-benchmark.ts` | scorecard schema, gates, strategy names | #786 #790 |
| `packages/memento-core/.../search-engine-fts-query.ts` | query semantics | #787 |
| `packages/memento-core/.../search-engine-sql-builder.ts` | FTS rank ORDER BY | #787 |
| `packages/memento-core/.../search-engine-ranking.ts` | BM25 sign / relevance | #787 |
| `packages/memento-core/.../hybrid-result-ranker.ts` | preserve combiner relevance | #788 |
| `packages/memento-core/src/test/helpers/vector-search-quality-metrics/report-comparison.ts` | same `\|\|` bug, keep in sync | #788 |
| `packages/memento-core/.../search-result-combiner.ts` | weighted combo (read, change only if scale contract needs it) | #788 |
| `packages/memento-core/.../hybrid-vector-search-executor.ts` | threshold/prefetch | #789 |
| `packages/memento-core/.../shared/config/constants.ts` | named constants after ablation | #787 #789 |
| `packages/memento-core/.../hybrid-search-engine.ts` | expose stage counts already computed | #786 |
| `packages/memento-core/.../knowledge-context-bundle-builder.ts` | injection selected IDs/tokens | #790 |
| `docs/_work/testing/ko/benchmark-datasets.md` | session-retrieval vs official QA | #790 |
| `docs/agents/search-ranking.md` | BM25 + fusion relevance 계약 | #787 #788 |

## Data flow

### Funnel (#786)

1. Adapter already calls `hybridSearchEngine.search`.
2. Capture `text_count`, `vector_count`, `union_count`, `reranked_count` from the search result (engine already sets these).
3. Add stage-level gold hit vs `query.relevantIds` without storing document bodies.
4. Write `getRankingVersion()`, `git rev-parse HEAD`, fixture SHA, eligible/excluded query ID hashes.
5. Keep Recall@k/MRR/nDCG keys.

### FTS (#787)

1. Red: in-memory FTS5 fixture where BM25-best row is known.
2. Fix ORDER BY to match SQLite (lower rank better) and convert signed rank → relevance without dropping negatives.
3. Ablate query combinators on LoCoMo (local) + synthetic (CI). Record; pick one; keep filters-before-LIMIT.

### Fusion (#788)

1. Red: overlap candidate, monotonic text/vector tests.
2. `buildBaseFeatures.relevance` uses combiner `finalScore` (or explicit `textScore * w_t + vectorScore * w_v`), not `vectorScore \|\| textScore`.
3. Other ranking features stay in their own slots.

### Vector (#789)

1. Log raw similarity gold/non-gold per provider (adapter-side, no LoCoMo stats in core).
2. Ablate threshold×prefetch. Implement chosen policy in executor/constants.
3. Ranking hash must change when constants change.

### Injection (#790)

1. After engine search, run the same query through `memory_injection` / bundle builder on the disposable DB.
2. Map selected memories back to document IDs (content/id provenance; do not require MCP to start returning IDs unless already present).
3. Separate scorecard + gate labels.

## Config / env

- No new required env.
- `MEMENTO_RANKING_WEIGHTS_PATH` override **여부**는 reproduction에 기록만. 이 에픽에서 기본 TOML 재튜닝 없음.
- Vector/FTS numeric policy changes go through existing `HYBRID_SEARCH` constants after ablation, not ad-hoc magic numbers in adapter.

## Test strategy

Red → Green. Constitution I.

1. **US1/#786**: fixture test that scorecard contains ordered funnel fields, ranking-sha256, clean git_sha ≠ empty/parent-stub; existing recall fields still present; production adapter does not change FTS/fusion/threshold.
2. **US2/#787**: real FTS5 sort test; negative rank accepted; filters-before-LIMIT regression; SQL vs top-N metrics both present in scorecard type.
3. **US3/#788**: combiner vs ranker overlap; monotonic tests; adaptive weight ordering; no double-count of importance into relevance; category/p95 non-regression on synthetic + recorded LoCoMo note.
4. **US4/#789**: threshold under-fill fallback or provider threshold unit test; ranking version changes when constant changes; p95 < 1s on recorded run.
5. **US5/#790**: engine vs injection strategy names; provenance test on synthetic fixture; adversarial excluded from retrieval; gate evaluator unit tests for 0.80 / 0.20 / 1s.
6. `npm run lint` && `npm run type-check` && targeted vitest && `npm test` && graphify rebuild before claiming the epic done.

CI does **not** download LoCoMo. Full 1,536 gate is `quality:locomo` local/nightly with `.local/locomo/`.

## Risks

| Risk | Mitigation |
|------|------------|
| Funnel needs counts the engine does not expose (raw_vector vs thresholded) | Add the smallest engine return fields; do not log bodies. |
| BM25 sign fix changes all text recall overnight | Tests pin order; scorecard before/after; no weight tune in same PR if possible. Prefer separate PRs per child issue. |
| Fusion fix + vector threshold in one diff hides cause | Ship #788 before #789. |
| Injection has no ID list | Provenance via selected memory ids from bundle builder internals/tests, not MCP schema break. |
| Concurrent bench jitter | Document solo-run; funnel tests use synthetic fixture. |
| License | Keep `.local/locomo/` gitignored; public docs aggregates/hashes only. |

## Project Structure

```text
specs/061-785-epic-search-production-recall/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── tasks.md
└── checklists/requirements.md

packages/memento-core/src/domains/search/algorithms/
├── hybrid-search-engine.ts
├── hybrid-result-ranker.ts
├── hybrid-vector-search-executor.ts
├── search-result-combiner.ts
└── search-engine/
      search-engine-fts-query.ts
      search-engine-sql-builder.ts
      search-engine-ranking.ts

scripts/
├── agent-memory-production-adapter.ts
└── agent-memory-benchmark.ts
```

**Structure Decision**: 기존 모노레포 모듈만 수정. 새 패키지 없음.

## Complexity Tracking

해당 없음. 새 추상화/패키지 없음. 에픽을 자식 이슈 PR로 쪼개는 것은 범위 관리이지 아키텍처 복잡도 증가가 아니다.
