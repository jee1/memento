# Quickstart: Agent Memory Benchmark

## Read Order

1. `spec.md`
2. `research.md`
3. `data-model.md`
4. `plan.md`
5. `tasks.md`

## Run Fixture Benchmark

```bash
npm run quality:agent-memory:benchmark -- \
  --fixture tests/fixtures/agent-memory-benchmark \
  --output /tmp/agent-memory-benchmark.json
```

Graph experiment:

```bash
npm run quality:agent-memory:benchmark -- \
  --fixture tests/fixtures/agent-memory-benchmark \
  --graph-rrf \
  --output /tmp/agent-memory-benchmark-graph.json
```

## Validate LongMemEval-S Contract

```bash
npm run quality:agent-memory:benchmark -- \
  --longmemeval-s tests/fixtures/agent-memory-benchmark/longmemeval-s-sample.jsonl \
  --output /tmp/longmemeval-s-report.json
```

## Interpret Results

- `retrieval`: ranking 품질, latency, injected tokens, duplicate/session bias.
- `end_to_end`: required evidence coverage와 completion rate.
- `gates.graph_rrf_adoption_candidate`: graph-RRF 기본 채택 검토 가능 여부.
- `reproduction`: fixture hash, git SHA, Node/platform/seed.

Latency는 환경 의존이다. 공개 품질 재현 비교에서는 latency를 제외한 deterministic projection을 비교하고 p50/p95는 같은 환경에서 별도로 비교한다.

## Regression

```bash
npx vitest run scripts/agent-memory-benchmark*.spec.ts
npm run quality:benchmark:verify-categories
npx vitest run scripts/compare-weight-profiles.spec.ts scripts/quality-benchmark-category-report.spec.ts
npm run lint
npm run type-check
```

Stop condition: agent benchmark targeted tests와 기존 benchmark-v3 regression이 통과하고 graph flag off/on 보고서가 명시 gate를 제공한다.
