# Implementation Plan: semantic confidence 영속화 및 importance 게이트

**Branch**: `jee1/fix-semantic-confidence-importance-triple` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)
**Issue**: [#805](https://github.com/jee1/memento/issues/805) | **Parent Epic**: [#803](https://github.com/jee1/memento/issues/803)

## Summary

자동 추출 triple을 한 번 정규화해 confidence를 계산하고, 저장 하한을 넘은 증거만 scoped automatic
semantic memory에 반영한다. 신규·exact·유사 병합은 모두 같은 primary mutation 경계로 수렴하며,
`confidence`, `num_times`, 최신 episodic importance 기반 importance를 원자적으로 갱신한다.

LLM·정규화·entity linking·embedding 비교는 write transaction 밖에서 끝낸다. 짧은 conversion
commit은 source snapshot과 후보 자격을 다시 확인한 뒤 semantic/KG primary와 source success tuple을
함께 확정한다. 관계·semantic embedding·통계는 commit 뒤 독립적으로 정산한다. 예약 batch는 기존
공개 타입을 유지하고 execute별 policy·clock·candidate·result snapshot으로 retry, timeout, DB binding을
격리한다.

새 스키마, backfill, 신규 공개 필드, 새 failure code, 전역 lock·lease·queue는 추가하지 않는다.

## Technical Context

- **Language/Version**: TypeScript 5.9, Node.js >=24, ES modules
- **Primary Dependencies**: 기존 `better-sqlite3`, `sqlite-vec`, `UnifiedEmbeddingService`, Vitest; 신규 dependency 없음
- **Storage**: 기존 SQLite `memory_item`, `kg_triple`, `memory_relation`; schema/migration 변경 없음
- **Testing**: Vitest, canonical test database helper, fake timers/clock dependency, in-memory SQLite
- **Target Platform**: `@memento/core`를 사용하는 MCP stdio/HTTP/WebSocket 및 내부 scheduler
- **Project Type**: npm workspaces 기반 TypeScript library/server
- **Performance Goals**: 정규화 1회/triple, input subject·object embedding 각 1회/triple, 직렬 batch와 짧은 DB write transaction 유지
- **Constraints**: threshold strict `>`, `parallelism=1`, public result shape 불변, raw triple/content/output 비노출, 신규 schema/index 없음
- **Scale/Scope**: 약 29,000개 historical NULL-confidence 행은 건드리지 않고 신규 automatic conversion 경로 3개와 예약 batch만 수정

미해결 기술 항목은 없다. Phase 0의 결정 근거는 [research.md](./research.md)에 확정했다.

## Constitution Check

헌법 v1.2.0 기준. *GATE: Phase 0 이전 통과, Phase 1 이후 재확인.*

| 원칙 | 상태 | 근거 |
|---|---|---|
| I. Test-First Delivery | **PASS** | scoring, semantic persistence, conversion commit, retry/batch contract의 실패 테스트를 먼저 추가한 뒤 최소 구현을 진행한다. |
| II. Backward Compatibility | **PASS** | MCP 입력/출력, `SemanticMemoryUpdateResult`, `TripleExtractionBatchResult`, failure reason enum의 공개 모양을 유지한다. strict gate와 품질 영속화는 승인된 동작 수정이며 compatibility note를 spec/contracts에 남긴다. |
| III. Schema and Migration | **PASS** | 필요한 confidence·scope·provenance·상태 필드가 이미 존재한다. `schema.sql`, migration, schema version을 변경하지 않는다. |
| IV. Quality Gates | **PASS** | targeted Vitest 후 core/full test, lint, type-check, graphify rebuild/report 확인을 완료 조건으로 둔다. |
| V. Observability | **PASS** | 기존 structured logger/statistics를 재사용하고 raw subject/predicate/object/content/embedding/LLM output은 기록하지 않는다. 관측 실패가 durable primary 결과를 바꾸지 않는다. |
| Runtime / workspaces | **PASS** | Node 24+, npm workspaces, TypeScript ESM 경계를 유지한다. |
| Corpus licensing | **PASS** | 운영 DB는 읽기 전용 집계만 허용하고 저장소에는 집계·ID·해시와 합성 fixture만 둔다. |

게이트 위반이 없으므로 Complexity Tracking은 필요하지 않다.

## Architecture

```text
automatic entrypoints
  remember augmentation ─┐
  convert tool ──────────┼─> shared episodic conversion coordinator
  scheduled batch ───────┘      │
                                 ├─ validate + snapshot source/options/result
                                 ├─ extract + prepare semantic plan (no write tx)
                                 │    ├─ normalize/link once
                                 │    ├─ confidence + strict gate
                                 │    ├─ scoped candidate search + embeddings
                                 │    └─ coalesce by normalized target
                                 ├─ short conversion commit
                                 │    ├─ revalidate source/candidate
                                 │    ├─ create/update semantic + KG
                                 │    └─ write source success tuple
                                 └─ post-commit settle
                                      ├─ extracted_from
                                      ├─ supported_by
                                      ├─ semantic embedding
                                      └─ statistics/logging
```

### Boundary decisions

1. `SemanticMemoryUpdateService` remains the semantic composition root and preserves
   `updateSemanticMemory()` compatibility. Its pipeline gains request snapshot, prepared plan, coalescing and
   deterministic outcomes; exact KG, similar and create paths call one primary mutation contract.
2. One small internal conversion coordinator is shared by remember augmentation, the explicit conversion tool and
   the scheduler. It owns source snapshot/transition and invokes the semantic service; it does not add a public API.
3. `SemanticMemoryScoring` reuses the existing canonicalizer/linker and existing confidence weights. It returns one
   normalized snapshot and calculates aggregate confidence plus quality-adjusted importance.
4. `SemanticMemorySimilarity` prefilters active, null-safe same-scope, automatic-provenance candidates before reading
   content or computing embeddings. Exact precedes similar; ties use `created_at`, then ID.
5. `SemanticMemoryCrud` performs the shared create/update SQL. It preserves explicit importance `0`, never increments
   `recall_count`, and does not launch embedding work inside the commit.
6. `SemanticMemoryRelations` validates direction/type before primary writes, then settles both directions independently
   after commit. An existing identical relation is a no-change success.
7. The batch job validates a copied config before schema ensure or any DB access, creates internal semantic dependencies
   per execute/DB, fixes the candidate set once, and aggregates only durable terminal source outcomes.

Detailed contracts: [semantic-update.md](./contracts/semantic-update.md),
[conversion-state.md](./contracts/conversion-state.md), [batch-job.md](./contracts/batch-job.md).

## Data Flow

### Semantic preparation and commit

1. Runtime-validate the result container. An actual empty `triples` array returns the existing no-op; malformed
   containers fail before source lookup or writes.
2. Copy options, extraction metadata and triple fields by value. Validate thresholds, episodic ID/importance and all
   triple positions before per-triple work.
3. For each valid position, canonicalize/link once, validate the normalized snapshot, calculate confidence once and
   record that sample once. `confidence <= threshold` becomes `skipped`.
4. Resolve eligible exact/similar candidates using source scope and provenance. Invalid legacy candidates are ignored;
   an indeterminate required similarity is an operational skip, not permission to create.
5. Coalesce equal normalized triples and multiple occurrences that resolve to one target. The highest-confidence
   occurrence represents the target; target work is ordered by its first input index.
6. In a short DB transaction, revalidate source and candidate. Apply one primary occurrence per target and write the
   source success tuple. If candidate eligibility changed, rollback, recompute once outside the transaction and retry in
   a new transaction.
7. After commit, settle relations, embeddings and statistics independently. Failures are observable but cannot turn the
   committed source back into a retry.

### Quality formula

- New semantic: `aggregateConfidence = evidenceConfidence`, `num_times = 1`.
- Existing non-NULL confidence `c` with `n` accepted evidence:
  `aggregateConfidence = (c * n + evidenceConfidence) / (n + 1)`.
- Existing NULL confidence: initialize aggregate to the new confidence and then continue normal accumulation.
- Preserve a representable value below `1` once any accepted evidence is below `1`.
- `baseImportance = latestEpisodicImportance * aggregateConfidence`.
- Apply the existing repetition boost only when aggregate confidence is exactly `1` and base importance is positive.
- Clamp final importance to `[0,1]`; explicit episodic importance `0` remains `0`.

### Batch execution

1. Capture a fresh result graph, wall-clock retry snapshot and monotonic timeout origin.
2. Resolve defaults by field, copy the backoff array, and reject invalid explicit runtime values before DB access.
3. Ensure existing columns, create execute-local DB-bound dependencies, then stream deterministic candidate rows in
   `created_at, id` order. Apply status/retry/due validation before filling `batchSize`.
4. Split the fixed set into consecutive chunks and process sources serially. Revalidate source immediately before the
   extractor and again at conversion commit.
5. Genuine pre-commit failure writes failed/abandoned metadata in a separate conditional transaction. Stale or losing
   attempts are `skipped` without retry increment. Already committed prefixes survive fatal chunk/job errors.
6. Set timing at the return boundary and reconcile
   `processed = details.processed = success + failed + skipped` on every path.

## Module Boundaries

| Path | Planned responsibility |
|---|---|
| `packages/memento-core/src/domains/memory/semantic/semantic-memory-update-types.ts` | Internal snapshots, prepared occurrences and committed outcome types; public result/options unchanged. |
| `.../semantic-memory-scoring.ts` | One-pass normalized snapshot, confidence, aggregate and importance pure logic. |
| `.../semantic-memory-similarity.ts` | Scoped/provenance candidate discovery, deterministic selection and per-triple embedding reuse. |
| `.../semantic-memory-crud.ts` | Shared conditional create/update primary mutation; no post-commit side effects. |
| `.../semantic-memory-update-pipeline.ts` | Trust-boundary validation, preparation, coalescing, commit/re-evaluation and outcome reconciliation. |
| `.../semantic-memory-relations.ts` | Direction/type preflight and independent duplicate-safe post-commit relation settlement. |
| `.../semantic-memory-update-service.ts` | Existing composition/API facade. |
| `.../episodic-semantic-conversion.ts` *(new internal file)* | Shared source snapshot, conversion commit and failure-state orchestration for the three automatic entrypoints. |
| `.../convert-episodic-to-semantic-tool.ts` | Preserve MCP contract; delegate per-source conversion. |
| `.../remember/remember-tool-augmentation.ts` | Preserve background behavior; delegate per-source conversion and explicit `0`. |
| `.../triple-extraction-batch-job.ts` and submodules | Execute snapshots, target/retry selection, serial chunking, result reconciliation and DB-local wiring. |
| `packages/memento-core/src/shared/types/triple-extraction.ts` | Reuse existing failure reason set; no public enum expansion. |
| `packages/memento-core/src/infrastructure/database/sqlite/*` | Existing schema only; no production changes expected. |

## Test Strategy

Red-Green-Refactor order:

1. Extend `semantic-memory-scoring.spec.ts` for confidence values, weighted aggregate, strict threshold helper,
   importance `0`, and boost eligibility.
2. Add `semantic-memory-quality-persistence.spec.ts` using the canonical DB helper for new/exact/similar paths,
   coalescing, scope/provenance, legacy invalid rows, concurrent create/update and rollback/post-commit behavior.
3. Extend conversion-tool and remember tests for shared conversion commit, source snapshot change, single winner,
   force-reprocess failure preservation and post-commit failure isolation.
4. Add focused batch retry and batch contract specs with fake dependencies/clocks for preflight ordering, exact due time,
   fixed candidate set, timeout, fatal-prefix preservation, DB binding, malformed extractor results and fresh results.
5. Run existing relation, extraction, schema and dependency-boundary regressions. No migration test is added because no
   schema artifact changes.

Runnable commands and expected evidence are in [quickstart.md](./quickstart.md).

## Project Structure

```text
specs/066-semantic-confidence-importance/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── semantic-update.md
│   ├── conversion-state.md
│   └── batch-job.md
└── checklists/
    └── requirements.md

packages/memento-core/src/domains/memory/semantic/
├── semantic-memory-update-service.ts
├── semantic-memory-update-pipeline.ts
├── semantic-memory-update-types.ts
├── semantic-memory-scoring.ts
├── semantic-memory-similarity.ts
├── semantic-memory-crud.ts
├── semantic-memory-relations.ts
├── semantic-memory-statistics.ts
├── episodic-semantic-conversion.ts          # new internal coordinator
├── convert-episodic-to-semantic-tool.ts
└── *.spec.ts / __tests__/*.spec.ts

packages/memento-core/src/domains/memory/remember/
└── remember-tool-augmentation.ts

packages/memento-core/src/infrastructure/scheduler/jobs/
├── triple-extraction-batch-job.ts
├── triple-extraction-batch-job/
│   ├── triple-extraction-batch-job.types.ts
│   ├── triple-extraction-batch-job-retry.ts
│   ├── triple-extraction-batch-job-chunk.ts
│   └── triple-extraction-batch-job-memory-status.ts
└── __tests__/
    ├── triple-extraction-batch-job.spec.ts
    ├── triple-extraction-batch-job-retry.spec.ts       # new focused spec
    └── triple-extraction-batch-job-contract.spec.ts    # new focused spec
```

**Structure Decision**: existing semantic composition and scheduler split are retained. Only one production module is
added to remove three copies of source conversion state logic; all other work stays in current modules. Large existing
spec files are supplemented with focused regression files rather than expanded indefinitely.

## Phases

### Phase 0 - Research

[research.md](./research.md) resolves storage reuse, transaction boundaries, candidate eligibility, entrypoint
unification, batch timing/retry semantics and test isolation. All technical clarifications are resolved.

### Phase 1 - Design and contracts

- [data-model.md](./data-model.md): existing rows plus invocation, evidence, conversion and batch logical models.
- [contracts/semantic-update.md](./contracts/semantic-update.md): semantic request/outcome and quality invariants.
- [contracts/conversion-state.md](./contracts/conversion-state.md): source transition and commit-unit contract.
- [contracts/batch-job.md](./contracts/batch-job.md): config, candidate, timeout, retry and result contract.
- [quickstart.md](./quickstart.md): runnable validation sequence.

### Phase 2 - Task breakdown

Generated later by `$speckit-tasks`; it is outside this command.

## Post-Design Constitution Re-check

Phase 1 keeps every initial gate at **PASS**. The design reuses existing schema and public types, isolates raw data,
requires Red-Green-Refactor, and includes all completion gates. The new internal coordinator reduces duplicated state
logic without adding a public abstraction. Production code changes make graphify rebuild mandatory at implementation
completion; `graphify-out/` remains uncommitted.
