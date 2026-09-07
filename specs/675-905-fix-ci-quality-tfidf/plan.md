# Implementation Plan: Nightly quality gate provider alignment (#905)

**Branch**: `feature/fix-ci-3-red-tfidf` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/675-905-fix-ci-quality-tfidf/spec.md`

## Summary

Fix Nightly `test-search-quality` by building `@memento/core` before category-report,
align benchmark seed/search to `EMBEDDING_PROVIDER` (default minilm), and print
provider+dims in the report header. Document fixture corpus vs unused `DB_PATH`.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js ≥24 (ESM)  
**Primary Dependencies**: Vitest, better-sqlite3, `@memento/core` MemoryEmbeddingService  
**Storage**: Temporary SQLite for benchmark seed (not production DB)  
**Testing**: Vitest (`scripts/__tests__/benchmark-search-database.spec.ts`, `scripts/quality-benchmark-category-report.spec.ts`)  
**Target Platform**: GitHub Actions ubuntu-latest (Nightly) + local CLI  
**Project Type**: monorepo scripts + core library  
**Performance Goals**: Post-seed category aggregation still ≤ WALL_MS 30s (SC-006); seed time excluded  
**Constraints**: No silent provider fallback; ONNX skip retained; no LoCoMo corpora  
**Scale/Scope**: ~3440 corpus rows; 4 macro categories; MRR≥0.5 gate

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I | PASS | Failing tests for seed provider + header before impl |
| MCP/API backward compat | II | PASS | CLI stdout additive header; no tool contract change |
| Schema/migrations | III | N/A | No schema change |
| Quality gates | IV | PASS | lint/type-check/targeted tests; graphify after code edits |
| Observability | V | PASS | Header + fail-closed seed errors |
| Additional Constraints | — | PASS | Node 24, no non-redistributable corpora |

## Project Structure

### Documentation (this feature)

```text
specs/675-905-fix-ci-quality-tfidf/
├── plan.md
├── research.md
├── quickstart.md
├── contracts/
├── spec.md
├── tasks.md
└── progress.yml
```

### Source Code

```text
.github/workflows/nightly-tests.yml
scripts/lib/benchmark-search-database.ts
scripts/quality-benchmark-category-report.ts
scripts/quality-benchmark-category-report.spec.ts
scripts/__tests__/benchmark-search-database.spec.ts
packages/memento-core/src/shared/types/benchmark.types.ts
packages/memento-core/src/domains/monitoring/services/quality-assurance/category-quality-aggregator.ts
```

## Execution Strategy

1. **TDD**: Update seed + header tests (RED) → implement seed/filter/header (GREEN).
2. **Workflow**: Add core build + `EMBEDDING_PROVIDER=minilm` + corpus comment (US1/US4).
3. **Parallel**: US1 workflow edits can proceed alongside US2/US3 code once types helper lands.
4. **Review**: superspec.review against FR/SC; no commit/push unless requested.

## Complexity Tracking

None — no constitution violations.
