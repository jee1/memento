# Contract: Nightly MiniLM Korean embedding quality

## Workflow obligations

| Field | Value |
|-------|--------|
| Workflow | `.github/workflows/nightly-tests.yml` |
| Job | `test-search-quality` |
| Env | `RUN_EMBEDDING_QUALITY=1` (step or job) |
| Command | `npx vitest --run` (or `npx vitest run`) targeting `minilm-korean-quality.spec.ts` |
| Cache | `~/.cache/huggingface` via `actions/cache` |
| Failure | Step must not set `continue-on-error: true` |

## Out of contract

- PR `ci.yml` must not force this suite.
- Quality thresholds inside the spec file are owned by #889, not this contract.
