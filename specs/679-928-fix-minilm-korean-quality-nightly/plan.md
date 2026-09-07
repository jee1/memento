# Implementation Plan: MiniLM Korean quality on Nightly (#928)

**Branch**: `feature/minilm` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/679-928-fix-minilm-korean-quality-nightly/spec.md`

## Summary

Wire `RUN_EMBEDDING_QUALITY=1` + `minilm-korean-quality.spec.ts` into weekly
`nightly-tests.yml` `test-search-quality` job, add Hugging Face model cache, and
extend topology contract tests so YAML/command regressions fail closed. Do not
change the quality assertions or enable on PR CI.

## Technical Context

**Language/Version**: YAML (GitHub Actions) + TypeScript Vitest contract tests / Node.js ≥24  
**Primary Dependencies**: Vitest, `@huggingface/transformers`, onnxruntime-node (CPU bundle; NuGet skip)  
**Storage**: HF cache under `~/.cache/huggingface` (Actions cache)  
**Testing**: `tests/test-topology-contract.spec.ts`; optional local
`RUN_EMBEDDING_QUALITY=1 npx vitest run …/minilm-korean-quality.spec.ts`  
**Target Platform**: GitHub Actions ubuntu-latest (Nightly)  
**Project Type**: monorepo CI wiring  
**Performance Goals**: Fit within existing 45m job timeout; cache hit avoids ~118MB re-download  
**Constraints**: No PR model download; keep ONNX skip; single job owner  
**Scale/Scope**: 1 workflow file + 1 contract test file (+ spec artifacts)

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I | PASS | Contract test asserts YAML before/with workflow edit |
| MCP/API backward compat | II | N/A | No tool/API change |
| Schema/migrations | III | N/A | No schema |
| Quality gates | IV | PASS | topology test + lint/type-check as needed; graphify N/A if docs-only… code touch → rebuild |
| Observability | V | PASS | Failures surface as Nightly job red |
| Additional Constraints | — | PASS | No non-redistributable corpora; model downloaded at runtime |

## Project Structure

### Documentation (this feature)

```text
specs/679-928-fix-minilm-korean-quality-nightly/
├── plan.md
├── research.md
├── quickstart.md
├── contracts/nightly-embedding-quality.md
├── spec.md
├── tasks.md
└── progress.yml
```

### Source Code

```text
.github/workflows/nightly-tests.yml
tests/test-topology-contract.spec.ts
```

## Execution Strategy

1. **TDD**: Extend topology contract for `RUN_EMBEDDING_QUALITY` + spec path (RED).
2. **Workflow**: HF cache + quality vitest step on `test-search-quality` (GREEN).
3. **Verify**: topology test green; YAML review; simplify (no new script/job).
4. **Review**: superspec.review vs FR/SC; no commit/push unless asked.

Human checkpoints: user authorized full Speckit pipeline (`speckit으로 처리해줘`).
`progress.yml` execute auto-advance; brainstorm Recommended already adopted.

## Complexity Tracking

None — no constitution violations.
