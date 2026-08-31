# Research: 661-808-korean-recall-gold

**Date**: 2026-08-31  
**Spec**: [spec.md](./spec.md)

## R1 — Harness extension point

**Decision**: Korean arm = `scripts/agent-memory-benchmark.ts` with `--fixture tests/fixtures/agent-memory-benchmark-ko --production` (+ `--arm korean` / measure-only label).

**Rationale**: Already emits `ProductionScorecard` (`recall_at_10`, `mrr`, `ranking_version`, `embedding_provider`) and `reproduction.git_sha`. Matches FR-027 (extend existing harness). Zero new framework.

**Alternatives considered**:
- search-quality `benchmark-v3` — has `language` but no production scorecard/`git_sha` contract; empty `relevantIds` legacy; GT `queryId`=query text. Rejected as primary arm.
- New evaluation package — violates FR-027 / YAGNI.

## R2 — Fixture location & shape

**Decision**: New tree `tests/fixtures/agent-memory-benchmark-ko/` mirroring `tests/fixtures/agent-memory-benchmark/` (`manifest.json`, `corpus.jsonl`, `queries.json`, `graph-edges.json`, `e2e-cases.json`).

**Rationale**: `loadAgentMemoryFixture` + `assertDatasetSafe` already reject empty `relevantIds` (FR-028). Self-contained synthetic IDs.

**Alternatives**: Overwrite benchmark-v3 — rejected (FR-011, empty GT). Use `data/vector-search-quality-ground-truth.json` — obsolete path; not required.

## R3 — Category tags & taskCases

**Decision**: Put closed tags on each query (`particle_agglutination` | `short_multi_concept` | optional `triple_isolation_probe`). Enforce in **`korean-gold-validate`** (and extend loader to pass tags into scorecard `by_category` if cheap). Do not require LoCoMo adapters.

**Rationale**: Current fixture loader does not populate `taskCases`; LoCoMo adapters do. Validator covers FR-012/021 without blocking R@10/MRR measurement.

**Alternatives**: Only document tags in README — rejected (FR-021 must be machine-enforced). Full taskCases JSON schema rewrite — defer to plan if needed for category split in US4.

## R4 — Scorecard fields & FR-002

**Decision**: Operators MUST keep full `--output` report (not `--scorecard-out` alone) for `reproduction.git_sha`. Document both paths in quickstart.

**Exact keys**:
- Scorecard: `recall_at_10`, `mrr`, `ranking_version`, `embedding_provider`, `dataset_sha256`, `dataset_revision`, `production_path`
- Report: `reproduction.git_sha`, `reproduction.ranking_version`

**Rationale**: `git_sha` lives on report, not scorecard object today. Changing scorecard schema optional additive later; docs suffice for #808.

## R5 — LoCoMo remasure (US1)

**Decision**: Documented local procedure via existing `npm run quality -- locomo acquire` + `agent-memory-benchmark --locomo … --production`. No new nightly workflow (FR-023). Completion blocked until artifact exists when corpus acquired.

**Rationale**: Spec measure-only; CI must not vendor LoCoMo.

## R6 — #804/#807 before/after (US4)

**Decision**: Same Korean fixture; record SHA pairs in `before-after-804-807.md`. #807 “before” via prior SHA checkout or ablation off if available. #804 probes tagged `triple_isolation_probe` (optional subset). LoCoMo before/after optional.

**Rationale**: Spec Q2/Q12; quarantine execution remains #804.

## R7 — CI scope

**Decision**: CI runs `korean-gold-validate` (+ tiny fixture production smoke if cheap/stable). Never 1536. Never R@10 numeric gate. Never #731 REQUIRED_MACRO.

**Rationale**: FR-017/024; Non-Goals.

## R8 — Redaction

**Decision**: `redaction-checklist.md` + human review only (FR-025). No PII scanner product.

## R9 — Provider

**Decision**: Pin `embedding_provider` on every artifact. LoCoMo remasure must match #785 comparable provider or mark row non-comparable (FR-029).

## Resolved NEEDS CLARIFICATION

None remaining from Technical Context — all resolved above.
