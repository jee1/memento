# Quickstart: #813 predicate normalization

## 1. Quality report (read-only)

```bash
DB_PATH=/path/to/memento.db npm run memory:kg-triple-predicate-quality
```

Expected: JSON with `hangul_termination_rate`, `whitespace_rate`,
`average_length`, `non_hangul_termination_count`, capped `samples`.
DB row counts for `kg_triple` unchanged.

Optional sample cap (default/max 20):

```bash
DB_PATH=/path/to/memento.db npm run memory:kg-triple-predicate-quality -- --sample-limit 20
# npm run memory:kg-triple-predicate-quality -- --help
```

## 2. Domain tests (gate + scoring + conversion)

```bash
npm test -- \
  packages/memento-core/src/domains/relation/services/triple-extraction/__tests__/triple-normalizer.spec.ts \
  packages/memento-core/src/domains/relation/services/triple-extraction/predicate-canonicalizer.spec.ts \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts \
  packages/memento-core/src/domains/memory/semantic/triple-sentence.spec.ts
```

Conversion / metadata (after wiring):

```bash
npm test -- \
  packages/memento-core/src/domains/memory/semantic/episodic-semantic-conversion \
  packages/memento-core/src/domains/memory/semantic/triple-extraction-metadata
```

## 3. CLI script tests

```bash
npm test -- scripts/kg-triple-predicate-quality.spec.ts
```

## 4. Quality gates before handoff

```bash
npm run lint && npm run type-check
npm test -- \
  packages/memento-core/src/domains/relation/services/triple-extraction \
  packages/memento-core/src/domains/memory/semantic \
  scripts/kg-triple-predicate-quality.spec.ts
# production code touched → rebuild graphify and confirm graphify-out/GRAPH_REPORT.md
```

## 5. Ops check after deploy (manual / live DB — not CI)

```bash
DB_PATH=/path/to/prod.db npm run memory:kg-triple-predicate-quality
# Goal SC-006: new form-(2) rate < 1% via separate manual/CLI aggregation — not asserted in CI
```

## 6. Related repair (out of scope for #813 apply)

Existing form-(2) / broken conjugation cleanup remains:

```bash
DB_PATH=/path/to/memento.db npm run memory:repair-triple-sentences
DB_PATH=/path/to/memento.db npm run memory:repair-triple-sentences -- --apply
```
