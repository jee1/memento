# Quickstart: 066 구현 검증

이 문서는 구현 코드가 아니라 실행 가능한 검증 순서다. 상세 불변식은 [data-model.md](./data-model.md)와
[contracts/](./contracts/)를 참조한다.

## Prerequisites

```bash
nvm use
node -v
which node
npm install
```

Expected: Node major version 24+, dependencies installed. Native module load failure after a Node switch requires
`npm run rebuild-native`.

## 1. Red tests: pure quality logic

```bash
npx vitest --run \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-scoring.spec.ts
```

Prove unchanged confidence weights, strict threshold equality rejection, weighted aggregate, representable-below-1,
explicit importance `0`, and boost eligibility only at aggregate confidence `1`.

## 2. Semantic persistence and conversion commit

```bash
npx vitest --run \
  packages/memento-core/src/domains/memory/semantic/semantic-memory-quality-persistence.spec.ts \
  packages/memento-core/src/domains/memory/semantic/__tests__/convert-episodic-to-semantic-tool.spec.ts \
  packages/memento-core/src/domains/memory/remember/__tests__/remember-tool.spec.ts
```

Expected evidence:

- new, exact and similar paths persist the same confidence/importance contract;
- scope/provenance/deleted/invalid legacy candidates are never merged;
- normalized duplicates and same-target occurrences count once;
- source snapshot changes roll back primary changes and concurrent conversion has one durable winner;
- forced reprocess failure preserves prior success;
- relation/embedding/statistics failures after commit do not create retry.

## 3. Batch retry and execution contract

```bash
npx vitest --run \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-retry.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job-contract.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/triple-extraction-batch-job.spec.ts
```

Expected evidence:

- invalid explicit config causes zero DB access;
- invalid retry metadata is excluded, not reset, and due boundary uses exact 24-hour units;
- eligibility/order precede limit and the candidate set is fixed;
- timeout never synthesizes unstarted source outcomes;
- every return satisfies processed reconciliation;
- malformed extractor result persists `llm_parse_fail` without raw output;
- separate/overlapping executes have isolated DB service, clocks, results, arrays and Map.

## 4. Integration and architecture regressions

```bash
npx vitest --run \
  packages/memento-core/src/infrastructure/scheduler/jobs/__tests__/arigraph-relation-engine-integration.spec.ts \
  packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-service.spec.ts \
  packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts
```

Expected: relation direction/type validation and extraction contracts remain green; no new dependency-boundary violation or
allowlist growth. Schema/migration files should have no diff.

## 5. Read-only distribution check

Use a copy or read-only connection to operational data. Report only aggregate buckets and counts; never commit raw memory,
raw triples or derived corpus. At minimum compare accepted (`confidence > 0.7`) and rejected (`<= 0.7`) totals, split by
canonicalization/entity-link success flags when available. Store only aggregate numbers, identifiers or hashes in review
notes.

Expected: the chosen default boundary can be reviewed without writing the operational DB or adding a persistent sample
store. This check does not backfill historical NULL confidence rows.

## 6. Completion gates

```bash
npm run type-check -w @memento/core
npm run test:ci:core
npm run lint
npm test
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
test -f graphify-out/GRAPH_REPORT.md
git status --short
```

Expected: all commands exit 0, graphify report is freshly generated and inspected, `graphify-out/` is not committed, and no
migration/schema version change, new dependency, raw data artifact or unrelated refactor appears in the diff.

