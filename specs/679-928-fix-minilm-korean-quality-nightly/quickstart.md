# Quickstart: MiniLM Korean quality Nightly (#928)

## Local (opt-in)

```bash
npm run build -w @memento/core
RUN_EMBEDDING_QUALITY=1 npx vitest run \
  packages/memento-core/src/domains/embedding/services/__tests__/minilm-korean-quality.spec.ts
```

Unset / not `1` → 4 tests skipped (by design).

## Contract check

```bash
npm test -- tests/test-topology-contract.spec.ts
```

## Nightly

Weekly Sunday 02:00 UTC + `workflow_dispatch`. Job `test-search-quality` runs
category-report then Korean quality with `RUN_EMBEDDING_QUALITY=1` and HF cache.
