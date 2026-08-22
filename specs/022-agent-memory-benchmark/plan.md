# Implementation Plan: Agent Memory Benchmark

**Branch**: `feature/issue-455-agent-memory-benchmark` | **Date**: 2026-06-07
**Spec**: `/specs/022-agent-memory-benchmark/spec.md`

## Summary

저장소 fixture를 입력으로 사용하는 독립 TypeScript benchmark runner를 추가한다. 제품 검색 코드는 변경하지 않고 benchmark 경계에서 grep, SQLite FTS5, deterministic TF-IDF vector, lexical/vector RRF Memento, optional graph candidate RRF를 구현한다. 결과는 retrieval, E2E, gates, reproduction manifest로 분리한다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 24+ ESM
**Dependencies**: 기존 `better-sqlite3`, `tsx`, Vitest, Node 표준 라이브러리
**Storage**: in-memory SQLite FTS5 only; fixture JSON/JSONL
**Testing**: pure metric/gate tests, adapter/fixture tests, runner integration, benchmark-v3 regression
**Constraints**: 네트워크 없음, 신규 dependency 없음, 제품 CLI/dashboard/source 변경 없음

## Constitution Check

- **Test-First**: PASS. contract/metric/gate/runner failing tests를 먼저 작성한다.
- **Backward Compatibility**: PASS. 신규 scripts/fixtures/docs/tests와 additive package scripts만 추가한다.
- **Schema Discipline**: N/A. 제품 DB schema 변경 없음.
- **Quality Gates**: lint, type-check, targeted/full relevant tests, security/static checks를 실행한다.
- **Failure Isolation**: PASS. invalid schema/secret/license는 명시 오류로 fail closed 한다.

설계 후 gate: **PASS**

## Structure

```text
specs/022-agent-memory-benchmark/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md

scripts/
├── agent-memory-benchmark.ts
├── agent-memory-benchmark.spec.ts
├── agent-memory-benchmark-adapter.ts
└── agent-memory-benchmark-adapter.spec.ts

tests/fixtures/agent-memory-benchmark/
├── manifest.json
├── corpus.jsonl
├── queries.json
├── graph-edges.json
├── e2e-cases.json
└── longmemeval-s-sample.jsonl
```

## Architecture

1. Adapter가 native fixture 또는 LongMemEval-S JSONL을 공통 dataset으로 normalize한다.
2. validator가 ID 참조, license/secret review, secret marker, ground truth를 검사한다.
3. baseline runner가 동일 dataset/query/top-k로 각 retriever를 실행한다.
4. metric core가 ranking, latency, token, duplicate/session bias를 계산한다.
5. graph flag는 Memento seed 결과의 graph neighbor stream만 추가한다.
6. gate core가 Memento와 graph-RRF를 비교해 adoption candidate verdict를 계산한다.
7. reporter가 재현 manifest와 retrieval/E2E 분리 결과를 JSON으로 기록한다.

## Baseline Contract

| Baseline | Candidate/score |
| --- | --- |
| grep | query token의 literal document hit count |
| fts-only | SQLite FTS5 BM25 |
| vector | fixed tokenizer + corpus TF-IDF cosine |
| memento | RRF(FTS, vector) |
| graph-rrf | RRF(FTS, vector, graph-neighbor), feature flag |

모든 tie는 document ID 오름차순으로 해소한다. top-k는 기본 10이다.

## Test Strategy

1. adapter contract와 secret rejection.
2. deterministic tokenization, TF-IDF, RRF, metrics.
3. gate boundary: quality regression, latency, duplicate, session bias.
4. integration: fixture 실행, repeated deterministic projection, report separation.
5. benchmark-v3: 기존 fixture helper/category/profile tests와 scripts.
6. repository gates와 security workflow 명령.

## Verification

```bash
npx vitest run scripts/agent-memory-benchmark*.spec.ts
npx tsx scripts/agent-memory-benchmark.ts --output /tmp/agent-memory-benchmark.json
npm run quality -- benchmark verify-categories
npx vitest run scripts/compare-weight-profiles.spec.ts scripts/quality-benchmark-category-report.spec.ts
npm run lint
npm run type-check
```

이후 `.github/workflows/security-check.yml`의 SQL/PII/path/static/security test 명령과 graphify rebuild를 실행한다.

## Complexity

| Decision | Reason | Rejected |
| --- | --- | --- |
| benchmark-local retrievers | 제품 behavior를 바꾸지 않고 동일 조건 비교 | 제품 search flag 추가는 #455 범위 초과 |
| deterministic TF-IDF | 외부 모델/다운로드 없는 CI | hosted embedding은 재현성과 secret 요구 위반 |
| FTS5 in-memory | 실제 lexical engine 특성 반영 | JS BM25 재구현은 SQLite baseline 의미 약화 |
| graph stream + RRF | 후보 소스 기여 추적과 rollback 용이 | score 직접 가산은 scale 의존 |
