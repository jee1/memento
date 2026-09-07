# Quickstart: Vector length decay (#921)

## Config

`config/ranking-weights.toml`:

```toml
[vector_length_decay]
enabled = true
characteristic_length = 40
```

Restart Memento after edits (`MEMENTO_RANKING_WEIGHTS_PATH` optional). Ranking version hash changes when these fields change.

## Verify locally

```bash
# unit / domain
npm test -- packages/memento-core/src/domains/search/algorithms/vector-length-decay.spec.ts
npm test -- packages/memento-core/src/domains/search/algorithms/hybrid-vector-search-executor.spec.ts
npm test -- packages/memento-core/src/shared/config/ranking-weights-loader.spec.ts

npm run type-check
```

## Quality before/after (coefficient selection)

```bash
# before: set enabled=false (or characteristic_length very small after measuring baseline with enabled=false)
VITEST_INCLUDE_NIGHTLY=1 npm run test:vector-search-quality

# after: enabled=true, k=40 (or tuned)
VITEST_INCLUDE_NIGHTLY=1 npm run test:vector-search-quality
```

Optional: `npm run quality -- …` / Korean gold arms per AGENTS.md when validating KO recall.

## Manual repro check

Query: `우리말 질의가 엉뚱한 결과를 내던 원인을 찾아 고친 기록`  
Expect long answer memory above ~21–22 char triple sentences in hybrid recall.
