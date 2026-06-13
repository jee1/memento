# Research: Agent Memory Benchmark

## Existing Contracts

- `specs/017-agent-integration-contracts`는 session/observation/provenance를 분리하고 adapter payload가 core/search로 유출되지 않도록 한다.
- `tests/fixtures/search-quality/benchmark-v3`는 reviewed manifest와 deterministic TF-IDF seeded DB를 사용한다.
- `scripts/compare-weight-profiles.ts`는 MRR/NDCG/latency와 seeded statistical path를 제공하지만 agent session, injected tokens, graph stream은 다루지 않는다.
- `packages/memento-core/src/test/helpers/search-quality-metrics.ts`의 recall/NDCG 정의를 benchmark metric과 맞춘다.

## Decisions

### LongMemEval-S

원본 dataset을 vendoring하거나 다운로드하지 않는다. JSONL adapter contract와 synthetic fixture를 제공한다. adapter는 `question_id`, `question`, `haystack_sessions`, `answer_session_ids`, `answer_memory_ids`를 요구하고 각 memory를 내부 document로 flatten한다.

### Corpus Governance

coding-agent corpus는 이 저장소를 위해 작성한 synthetic MIT fixture다. manifest에 `redistribution`, `license_reviewed`, `secret_reviewed`, `synthetic`, `source_revision`을 고정한다. secret scanner는 private key, common API token, password assignment, bearer token marker를 거절한다.

### Fair Baselines

동일 corpus/query/top-k/token estimator를 공유한다. grep은 해석 가능한 literal lower bound, FTS-only는 SQLite lexical baseline, vector는 deterministic semantic-like baseline, Memento는 RRF hybrid다. baseline마다 별도 query rewrite나 corpus filtering을 허용하지 않는다.

### RRF

RRF는 score scale 정규화가 필요 없고 candidate stream 추가를 feature flag로 격리한다. tie는 ID로 결정한다. graph stream은 seed top results의 explicit edge neighbor만 사용하고 graph 자체가 query relevance를 새로 계산하지 않는다.

### Metrics

retrieval: R@5, R@10, MRR, NDCG@10.
operations: p50/p95 per-query latency, injected tokens.
E2E: required evidence coverage와 completion rate.
risk: duplicate rate와 maximum same-session concentration.

### Gate

graph-RRF adoption candidate는 다음을 모두 만족한다.

1. MRR과 NDCG@10이 Memento보다 낮지 않다.
2. R@10이 설정된 최소 delta 이상 개선된다.
3. p95가 절대 예산 및 Memento 대비 배수 예산 안이다.
4. duplicate rate와 session concentration이 예산 안이다.

### Reproducibility

ranking/quality/token 결과는 seed와 fixture hash로 결정된다. latency는 환경 의존이므로 environment manifest와 함께 보고하고 품질 deterministic projection에서 제외한다.

## Rejected Alternatives

- 외부 dataset 자동 다운로드: CI/network/license 불확실성.
- 신규 benchmark framework dependency: 현재 규모에 비해 비용이 큼.
- hosted LLM E2E judge: 비결정론, 비용, credential 요구.
- graph score 직접 가산: lexical/vector score scale과 결합됨.
- benchmark-v3 확장: 기존 gate의 목적과 agent-session 평가 목적이 달라 회귀 위험.
