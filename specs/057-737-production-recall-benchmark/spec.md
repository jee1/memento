# Feature Specification: Production Recall Benchmark & Scorecard

**Feature Branch**: `worktree-issue-737-production-recall-benchmark`
**Created**: 2026-08-04
**Status**: Ready for Implementation
**Issue**: [#737](https://github.com/jee1/memento/issues/737)
**Parent Epic**: [#733](https://github.com/jee1/memento/issues/733)
**Related**: #727, #731
**Input**: 합성 RRF를 production HybridSearch와 분리하고 고정 dataset scorecard를 추가

## Problem Statement

`scripts/agent-memory-benchmark.ts`의 `memento` baseline은 `RecallTool`/`HybridSearchEngine`이 아니라 in-memory FTS + 자체 TF-IDF RRF다. LongMemEval-S에서도 이 합성 조건은 FTS-only보다 낮았고, task-completion은 oracle evidence로 production retrieval-to-answer를 검증하지 않는다.

## Goals

- 합성 baseline을 `rrf_sim`으로 명확히 이름 변경
- disposable Memento DB에 고정 fixture를 import하는 adapter 추가
- 실제 production HybridSearch 경로(`createMementoCore` → `hybridSearchEngine.search`, memory_injection과 동일 엔진) 실행
- dataset revision/hash, ranking profile, provider, Recall@k, MRR, nDCG, p95, abstention, 실패 query를 scorecard에 기록
- 기존 agent-memory metrics·gate·fixture 자산 재사용

## Non-Goals

- 새 benchmark framework
- Graph-RRF 기본 활성화
- 새 embedding/ranking model 채택

## User Scenarios & Testing

### User Story 1 - 합성과 production baseline 분리 (Priority: P1)

평가 담당자는 보고서에서 합성 RRF(`rrf_sim`)와 production HybridSearch(`memento_prod`)를 별도 키로 비교한다.

**Independent Test**: 동일 fixture 실행 시 `retrieval.rrf_sim`과 `retrieval.memento_prod`가 모두 존재하고 `retrieval.memento` 키는 없다.

**Acceptance Scenarios**:

1. **Given** agent-memory fixture, **When** synthetic benchmark 실행, **Then** baseline 키에 `rrf_sim`이 있고 `memento`는 없다.
2. **Given** `--production` (또는 `production: true`), **When** 실행, **Then** `memento_prod` metrics가 별도 artifact/섹션에 저장된다.
3. **Given** production run, **When** 테스트가 HybridSearch 호출을 검사하면, **Then** production 경로 호출이 증명된다.

### User Story 2 - 결정론적 scorecard (Priority: P1)

검색 품질 담당자는 고정 seed·dataset revision으로 scorecard를 재현한다.

**Independent Test**: scorecard에 fixture SHA-256, source_revision, seed, ranking_profile, embedding_provider, R@k/MRR/nDCG/p95, abstention, failed_queries가 포함된다.

**Acceptance Scenarios**:

1. **Given** 고정 seed와 fixture, **When** production retrieval을 두 번 실행, **Then** ranking quality( latency 제외)가 동일하다.
2. **Given** LongMemEval-S cleaned 입력, **When** non-abstention query를 집계하면, **Then** scorecard에 470개 retrieval 결과가 기록된다(데이터셋 존재 시).
3. **Given** relevant가 top-k에 없는 query, **When** scorecard를 생성하면, **Then** failed_queries에 query id가 포함된다.

### User Story 3 - FTS-only 비열화 gate와 E2E evidence (Priority: P1)

운영자는 production이 FTS-only 대비 핵심 품질 지표를 악화시키지 않는지 gate로 확인하고, task completion은 retrieved evidence만 사용한다.

**Independent Test**: `gates.production_vs_fts`가 recall@10/MRR/nDCG 비열화를 판정하고, E2E는 production ranked list만 사용한다.

**Acceptance Scenarios**:

1. **Given** fts_only와 memento_prod metrics, **When** gate 평가, **Then** max_quality_regression 이내인지 pass/fail이 기록된다.
2. **Given** p95 예산, **When** gate 평가, **Then** observed p95와 예산이 scorecard/gates에 기록된다.
3. **Given** E2E case, **When** completion 평가, **Then** oracle이 아닌 retrieved ranked IDs만 evidence로 사용한다.

## Requirements

### Functional Requirements

- **FR-001**: 기존 합성 Memento baseline 키를 `rrf_sim`으로 변경한다.
- **FR-002**: disposable DB adapter가 fixture document를 **고정 id**로 import하고 FTS·embedding을 준비한다.
- **FR-003**: production baseline은 `createMementoCore`로 부트스트랩된 `hybridSearchEngine.search`를 사용한다(합성 RRF 금지).
- **FR-004**: scorecard는 dataset revision/hash, seed, ranking_profile, embedding_provider, Recall@5/@10, MRR, nDCG@10, p50/p95, abstention_count, failed_queries, query_count를 포함한다.
- **FR-005**: `gates.production_vs_fts`는 FTS-only 대비 품질 비열화와 p95 예산을 평가한다.
- **FR-006**: E2E/task completion은 production(또는 해당 baseline)의 retrieved evidence만 사용한다.
- **FR-007**: 기존 `quality:agent-memory:test` 합성 경로는 기본으로 유지하고, production은 opt-in 또는 전용 테스트로 검증한다.
- **FR-008**: 네트워크·신규 dependency 없이 CI fixture로 동작한다.
- **FR-009**: benchmark-v3·profile comparison·permutation 자산을 변경하거나 완화하지 않는다.

### Key Entities

- **rrf_sim**: 합성 FTS+TF-IDF RRF baseline
- **memento_prod**: production HybridSearch baseline
- **ProductionScorecard**: 재현·품질·실패 query 요약
- **production_vs_fts gate**: 비열화·latency 판정

## Success Criteria

- **SC-001**: 합성/production 키 분리 및 테스트 증명
- **SC-002**: scorecard 필드 완비
- **SC-003**: LongMemEval cleaned 사용 시 non-abstention 470 기록 가능
- **SC-004**: FTS-only 비열화 gate 정의·단위 테스트
- **SC-005**: targeted tests, type-check, lint, graphify 통과

## Assumptions

- CI는 소형 synthetic fixture로 production 경로를 검증한다.
- 전체 470 query scorecard는 로컬/야간에 acquired LongMemEval-S cleaned로 생성한다.
- Offline CI에서는 tfidf(또는 사용 가능한 기본 provider)로 임베딩한다.

## Out of Scope

- 새 검색 프레임워크 / Graph-RRF 기본 ON / 새 ranking model
