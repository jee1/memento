# Feature Specification: Epic #785 Production Recall 격차 진단 및 검색 정확성 복원

**Feature Branch**: `jee1/epic-search-production-recall`
**Spec Directory**: `specs/061-785-epic-search-production-recall`
**Created**: 2026-08-16
**Status**: Draft
**Issue**: [#785](https://github.com/jee1/memento/issues/785)
**Children**: #786, #787, #788, #789, #790
**Related**: #737, #767, #783
**Input**: LoCoMo production-path Recall@10 격차를 단계별 funnel로 분해하고, 확인된 검색 계약 결함을 최소 수정으로 복원

## Problem Statement

동일 LoCoMo 1,536개 non-adversarial 질문에서 FTS baseline Recall@10은 0.8823인데 production 경로(`memento_prod`)는 0.3810이다. 899/1,536(58.5%) 질문은 관련 세션을 top 10에서 하나도 찾지 못한다. 관련 세션을 하나라도 찾은 질문의 조건부 평균 recall은 약 0.919이므로, 핵심 실패는 ranking 미세 조정이 아니라 **후보 생성 단계에서 gold가 탈락**하는 것이다.

진단된 계약 결함:

1. 짧은 쿼리는 implicit AND, 긴 쿼리는 첫 8토큰 OR로 후보 semantics가 baseline과 다르다.
2. FTS5 rank를 내림차순으로 정렬하고 정상 음수 BM25를 유효 점수로 인식하지 않는다.
3. production `tfidf`는 512차원 hashed heuristic이며 baseline sparse TF-IDF와 점수 분포가 다르다.
4. 벡터 유사도 0.38 threshold가 fusion 전에 후보를 제거한다.
5. hybrid combiner 결합 점수를 최종 reranker가 덮어쓰고, 벡터 점수가 있으면 텍스트 relevance를 버린다.
6. `memento_prod`는 실제 `memory_injection` 전체가 아니라 엔진 primitive만 측정한다.
7. artifact `reproduction.git_sha`가 LoCoMo 코드 포함 전 부모 commit을 가리켜 checkout-only 재현이 불가능하다.

Recall/MRR/nDCG는 token packing 전에 계산되므로 토큰 예산은 Recall@10 격차의 직접 원인이 아니다. 후보에서 탈락한 gold는 reranking으로 복구할 수 없다.

## Goals

- 후보 생성 → fusion/rerank → 실제 injection context 단계로 recall 격차를 분해한다.
- 확인된 FTS·BM25·fusion 계약 결함을 최소 수정으로 복원한다.
- 벡터 threshold·prefetch는 provider/score 분포 근거로 교정한다.
- 엔진 primitive와 실제 `memory_injection`을 별도 scorecard로 측정하고 품질 gate를 건다.
- FTS·fusion correctness 수정 전에는 전역 ranking weight 튜닝을 하지 않는다.

## Non-Goals

- 새 embedding dependency 또는 외부 reranker 도입
- 벤치마크 점수만을 위한 corpus-specific hard-code
- LongMemEval/LoCoMo 공식 QA 점수와 내부 session-retrieval Recall@10을 동일 지표로 홍보
- 사용자 데이터 migration
- 새 검색 parser·query expansion·LLM rewrite
- 현재 embedding provider 제거
- LoCoMo 원본·파생 코퍼스 커밋 (CC BY-NC 4.0)

## Scope

| Issue | Title | Priority | Depends on |
|-------|-------|----------|------------|
| #786 | production recall 단계별 funnel·재현성 계측 | P0 | — |
| #787 | FTS5 query semantics·BM25 rank 계약 복원 | P0 | #786 |
| #788 | hybrid fusion에서 text·vector 결합 점수 보존 | P0 | #786 |
| #789 | vector 후보 threshold·prefetch를 provider별 교정 | P1 | #786, #788 |
| #790 | benchmark와 실제 memory_injection 경로 parity·품질 gate | P1 | #787, #788, #789 |

권장 순서: funnel/재현성 → FTS/BM25 → fusion 점수 보존 → vector 교정 → injection parity. #787과 #788은 funnel(#786) 이후 병렬 가능.

## User Scenarios & Testing

### User Story 1 - 단계별 funnel과 재현성 계측 (Priority: P1) — #786

검색 품질 담당자는 알고리즘을 바꾸기 전에, 각 질문이 어느 단계에서 gold를 잃는지와 실행 환경을 clean checkout으로 재현할 수 있어야 한다.

**Why this priority**: 899개 zero-hit가 후보 생성·threshold·fusion·final 중 어디서 발생하는지 모르면 이후 수정이 추측이 된다. 잘못된 git SHA는 수정 전후 비교를 무효화한다.

**Independent Test**: 합성 fixture로 production 경로를 돌리면 query별 funnel 필드와 ranking hash·clean git SHA가 artifact에 있고, 기존 Recall@5/10·MRR·nDCG 스키마가 유지된다. FTS/fusion/threshold 값은 이 스토리에서 바꾸지 않는다.

**Acceptance Scenarios**:

1. **Given** production recall 실행, **When** query별 artifact를 열면, **Then** `raw_text → text_topN → raw_vector → thresholded_vector → union → final_top10` 각 단계의 candidate 수가 기록된다.
2. **Given** gold evidence가 있는 query, **When** funnel을 집계하면, **Then** 각 단계의 any-hit / all-hit / fractional recall이 기록된다.
3. **Given** 전체 run, **When** 요약하면, **Then** 평균·p50·p95 candidate count와 `<10 results` 비율이 전략·카테고리별로 있다.
4. **Given** production run, **When** reproduction 블록을 보면, **Then** provider, fallback reason, vector threshold, prefetch, text/vector weights, 실제 ranking version hash, weights-path override 여부, fixture SHA, evaluator revision, eligible/excluded query ID hash, clean git SHA가 있다.
5. **Given** clean checkout의 동일 명령, **When** 합성 fixture를 두 번 실행하면, **Then** 품질 지표(latency 제외)가 결정론적으로 같다.
6. **Given** 기존 scorecard 소비자, **When** 새 funnel 필드가 추가돼도, **Then** Recall@5/10, MRR, nDCG 필드는 하위 호환된다.

---

### User Story 2 - FTS5 query semantics와 BM25 계약 복원 (Priority: P1) — #787

운영자는 텍스트 후보가 SQLite FTS5의 실제 rank 계약을 따르고, 좋은 문서가 먼저 나오며, 선택한 query semantics가 zero-hit를 줄이기를 원한다.

**Why this priority**: 후보에서 빠진 gold는 이후 fusion으로 되돌릴 수 없다. 현재 경로는 정상 음수 BM25를 무시하고 정렬 부호가 반대다.

**Independent Test**: in-memory FTS5 DB 회귀 테스트에서 best match가 먼저 오고, 음수 rank가 정상 relevance로 변환되며 순서가 보존된다. SQL candidate recall과 엔진 top-N recall이 별도 보고된다.

**Acceptance Scenarios**:

1. **Given** 실제 FTS5 in-memory DB와 알려진 best match, **When** 텍스트 검색을 실행하면, **Then** best match가 가장 앞에 정렬된다.
2. **Given** 음수 FTS5 rank(정상 BM25), **When** relevance를 계산하면, **Then** 해당 값을 유효 점수로 변환하고 상대 순서를 보존한다. `rank > 0`만 BM25로 인정하는 가정은 없다.
3. **Given** short-query AND / long-query first-8 OR / all-token OR ablation, **When** 결과를 비교하면, **Then** zero-hit와 candidate recall·latency가 artifact에 기록되고, 선택한 semantics가 zero-hit와 candidate recall을 개선하며 latency budget을 유지한다.
4. **Given** 필터가 있는 검색, **When** LIMIT을 적용하면, **Then** 필터는 LIMIT 이전에 적용된다(기존 계약 유지).
5. **Given** 동일 fixture, **When** SQL 후보 집합과 엔진 top-N을 비교하면, **Then** 두 recall이 별도 지표로 보고된다.

---

### User Story 3 - hybrid fusion 결합 점수 보존 (Priority: P1) — #788

검색 사용자는 텍스트·벡터 가중치가 최종 순위에 실제로 반영되기를 원한다. 벡터 점수가 있다고 해서 텍스트 증거가 사라져서는 안 된다.

**Why this priority**: combiner가 계산한 결합 점수를 최종 reranker가 덮어쓰면 explicit/adaptive weights가 무의미해지고, hashed vector가 lexical evidence를 대체할 수 있다.

**Independent Test**: overlap 후보의 final relevance가 weighted combination을 보존하고, text/vector 각각에 대한 monotonic 테스트가 통과한다. importance/recency/usage/feedback는 relevance에 중복 가산되지 않는다.

**Acceptance Scenarios**:

1. **Given** text·vector 모두 있는 overlap 후보, **When** final rank를 계산하면, **Then** relevance는 기존 weighted combination을 보존한다.
2. **Given** 동일 vector score, **When** text score가 증가하면, **Then** final relevance는 낮아지지 않는다.
3. **Given** 동일 text score, **When** vector score가 증가하면, **Then** final relevance는 낮아지지 않는다.
4. **Given** text-only 또는 vector-only 후보, **When** 점수를 매기면, **Then** scale·fallback 계약이 명시되고 테스트로 고정된다.
5. **Given** adaptive weight 변경, **When** 통합 검색을 실행하면, **Then** 최종 순서가 그 가중치를 반영한다.
6. **Given** current / weighted-score-preserved / RRF-sim 비교, **When** 동일 fixture를 돌리면, **Then** 비교 결과가 기록되고 category별 Recall@10·MRR·nDCG 및 p95 회귀가 없다.

---

### User Story 4 - vector 후보 threshold·prefetch 교정 (Priority: P2) — #789

검색 품질 담당자는 provider별 실제 score 분포에 맞는 후보 정책을 원한다. 좁은 hashed TF-IDF 분포에 고정 0.38을 씌워 fusion 전에 gold가 사라지면 안 된다.

**Why this priority**: LoCoMo scope는 최대 32 sessions이다. threshold 통과 후보가 부족하면 fusion 이전에 gold가 없어진다. P0 correctness(#787/#788) 이후에만 이 교정을 한다.

**Independent Test**: provider별 분포와 threshold/prefetch ablation이 artifact에 있고, 선택한 정책이 ranking version/hash에 반영되며 zero-hit 감소와 p95 < 1s를 동시에 충족한다.

**Acceptance Scenarios**:

1. **Given** production vector 경로, **When** raw similarity를 모으면, **Then** provider별 gold/non-gold 분포가 기록된다.
2. **Given** threshold `0 / 0.2 / 0.38` 및 prefetch `20 / 32 / 60`, **When** ablation하면, **Then** threshold 전후 candidate recall과 final Recall@10 영향이 분리 보고된다.
3. **Given** 관측 분포, **When** 정책을 고르면, **Then** provider별 threshold 또는 결과 부족 시 top-k fill fallback 중 최소 하나를 선택한다.
4. **Given** min-max normalization on/off, **When** ordering·fusion을 비교하면, **Then** 영향이 측정된다.
5. **Given** hashed production TF-IDF와 benchmark sparse TF-IDF, **When** 동일 reranker 조건으로 비교하면, **Then** 결과가 기록된다(새 모델 도입 없음).
6. **Given** 선택한 정책, **When** production run을 기록하면, **Then** ranking version/hash에 반영되고 zero-hit 감소와 p95 < 1s를 동시에 충족한다.

---

### User Story 5 - memory_injection 경로 parity와 품질 gate (Priority: P2) — #790

평가 담당자는 엔진 primitive 품질과 사용자가 실제로 받는 injected context 품질을 혼동하지 않고, 동일 provenance에서 end-to-end gate를 돌리기를 원한다.

**Why this priority**: 현재 `memento_prod`는 `hybridSearchEngine.search(limit=10)`만 호출한다. 실제 injection은 scoped candidate multiplier, 다른 기본 weights, 재정렬, summary, max memories, token selection을 거친다. #737 acceptance가 아직 완전히 닫히지 않았다.

**Independent Test**: 기존 direct engine 전략은 명시적 이름으로 남고, 실제 injection 전략이 별도로 돌아가며, 제안 gate(Recall@10 ≥ 0.80, zero-hit < 20%, p95 < 1s, category 회귀 없음)가 동일 fixture에서 평가된다.

**Acceptance Scenarios**:

1. **Given** 기존 production engine 측정, **When** scorecard를 보면, **Then** 전략 이름이 엔진 primitive임을 명시하고 기존 키와의 관계가 문서화된다.
2. **Given** 동일 query, **When** injection 전략을 실행하면, **Then** 실제 `memory_injection` 경로가 돌고 engine candidate IDs → injection selected IDs/content provenance가 연결된다.
3. **Given** token budget, **When** serialization이 끝나면, **Then** requested budget과 headers/query/footer 포함 실제 token 수가 기록된다.
4. **Given** 동일 run, **When** 지표를 보고하면, **Then** fixed-item Recall@k와 fixed-token evidence coverage가 분리되고, `recall_any` / `recall_all` / fractional evidence recall / MRR / nDCG가 있다.
5. **Given** reader arm 옵션, **When** 선택하면, **Then** no-context / oracle evidence / production injection / FTS context를 선택적으로 실행할 수 있다.
6. **Given** LoCoMo adversarial 또는 empty-evidence, **When** retrieval metric을 집계하면, **Then** 해당 항목은 제외되고 abstention QA로 별도 보고된다.
7. **Given** 동일 고정 fixture, **When** 제안 gate를 평가하면, **Then** Recall@10 ≥ 0.80, zero-hit < 20%, p95 < 1s, category 회귀 없음이 pass/fail로 기록된다.
8. **Given** 공개 문서, **When** 지표를 설명하면, **Then** 내부 session-retrieval과 LoCoMo 공식 QA 점수가 혼동되지 않는다.

### Edge Cases

- 관련 세션을 하나도 못 찾는 query: funnel 전 단계에서 any-hit=false, zero-hit 집계에 포함.
- gold가 SQL 후보에는 있으나 final top-10에 없는 query: SQL recall과 engine recall이 갈라진다.
- 벡터 후보 0건(threshold 전부 탈락 또는 provider 없음): text-only fallback, funnel의 `raw_vector`/`thresholded_vector`는 0.
- text-only 또는 vector-only overlap 없음: combiner fallback scale 계약 적용.
- 빈 쿼리·stopword-only 쿼리: 기존 FTS empty-query 계약 유지, funnel에 명시.
- 필터(project/owner/type) 적용 시 LIMIT 전에 필터.
- 동시 벤치마크 프로세스: 품질 비교는 단독 실행만 유효(#767 실측).
- LoCoMo 원본 부재: CI는 합성 shape fixture만 사용. 전체 1,536 gate는 로컬/야간 acquired corpus.
- injection이 ID 리스트를 직접 반환하지 않음: provenance는 engine IDs와 selected content를 연결해 재구성.

## Requirements

### Functional Requirements

- **FR-001**: System MUST record per-query funnel counts for `raw_text`, `text_topN`, `raw_vector`, `thresholded_vector`, `union`, `final_top10` (and context selection when injection strategy runs).
- **FR-002**: System MUST record per-stage gold any-hit, all-hit, and fractional recall.
- **FR-003**: System MUST record run-level provider, fallback, threshold, prefetch, text/vector weights, ranking version hash, weights-path override, fixture SHA, evaluator revision, eligible/excluded query ID hash, and clean git SHA.
- **FR-004**: System MUST keep existing Recall@5/10, MRR, nDCG scorecard fields backward compatible.
- **FR-005**: Text search MUST rank better FTS5 matches first using SQLite rank/BM25 semantics, including negative ranks.
- **FR-006**: Text search MUST NOT treat `ftsRank > 0` as the only valid BM25 signal.
- **FR-007**: Query semantics (short AND / long first-8 OR / all-token OR) MUST be chosen from recorded ablation that improves zero-hit and candidate recall without breaking latency budget or filters-before-LIMIT.
- **FR-008**: SQL candidate recall and engine top-N recall MUST be reported separately.
- **FR-009**: Final relevance for overlap candidates MUST preserve the text/vector weighted combination through final rank.
- **FR-010**: Final relevance MUST be monotonic in text score (fixed vector) and in vector score (fixed text).
- **FR-011**: Text-only and vector-only score scale/fallback MUST be explicit and tested.
- **FR-012**: Adaptive weight changes MUST affect final ordering. Importance/recency/usage/feedback MUST NOT be double-counted into relevance.
- **FR-013**: Vector threshold and prefetch MUST be chosen from provider-wise distribution and ablation (`0/0.2/0.38` × `20/32/60`), with either per-provider threshold or top-k fill fallback.
- **FR-014**: Threshold-before vs final Recall@10 MUST be reported separately. Chosen policy MUST appear in ranking version/hash.
- **FR-015**: Direct engine retrieval and actual `memory_injection` MUST be separate named strategies with provenance from engine IDs to selected context.
- **FR-016**: Injection strategy MUST record requested vs actual serialized tokens (headers/query/footer included) and split fixed-item Recall@k from fixed-token evidence coverage.
- **FR-017**: Retrieval metrics MUST exclude LoCoMo adversarial and empty-evidence items; those MUST be reported as abstention QA.
- **FR-018**: Same fixture MUST evaluate the proposed gate: Recall@10 ≥ 0.80, zero-hit < 20%, p95 < 1s, no category regression.
- **FR-019**: Public docs MUST distinguish internal session-retrieval metrics from official LoCoMo QA scores.
- **FR-020**: Global ranking weight retuning MUST NOT happen before FR-005–FR-012 are restored.
- **FR-021**: CI MUST use synthetic fixtures only; LoCoMo originals MUST NOT be committed.

### Key Entities

- **FunnelStage**: 한 query의 한 단계. candidate_count, gold_any, gold_all, gold_fraction.
- **ProductionScorecard**: 기존 품질 필드 + funnel 집계 + reproduction 블록.
- **ReproductionBlock**: git SHA, fixture SHA, evaluator revision, ranking hash, provider, threshold, prefetch, weights.
- **EngineStrategy**: HybridSearchEngine.search primitive (`memento_prod` 후속 명시 이름).
- **InjectionStrategy**: 실제 memory_injection / knowledge-context 경로.
- **QualityGate**: Recall@10, zero-hit rate, p95, category regression.

## Success Criteria

- **SC-001**: Query별 text/vector/union/final/context candidate·gold funnel이 artifact에 있다.
- **SC-002**: FTS5 BM25 정렬·부호·query semantics가 회귀 테스트로 고정된다.
- **SC-003**: text/vector 결합 점수가 final rank까지 보존되고 monotonic contract 테스트가 통과한다.
- **SC-004**: vector threshold·prefetch가 provider/score 분포 근거로 교정되고 ranking hash에 반영된다.
- **SC-005**: direct engine scorecard와 실제 `memory_injection` scorecard가 분리된다.
- **SC-006**: 동일 fixture에서 Recall@10 ≥ 0.80, zero-hit < 20%, p95 < 1s.
- **SC-007**: category별 회귀 없음, 재현 가능한 git SHA/ranking hash 기록.
- **SC-008**: production 변경 후 targeted tests, type-check, lint, full test, graphify 통과.

## Assumptions

1. 측정 기준 코퍼스는 #767/#783과 동일: LoCoMo 1,536 non-adversarial, category 5 제외, 해석 불가 evidence는 skipped.
2. CI는 `locomo-shape-sample.json` 등 합성 fixture로 스키마·계약만 고정한다. 1,536 gate는 acquired `.local/locomo/` 로컬/야간.
3. ranking 순서 변경은 의도된 correctness 복원이며 MCP 응답 필드 breaking이 아니다.
4. 토큰 예산은 Recall@10 직접 원인이 아니다. packing 개선만으로 SC-006을 충족했다고 보지 않는다.
5. #787 query semantics와 #789 threshold 최종 숫자는 ablation 결과로 고른다. spec은 숫자 자체를 미리 고정하지 않는다.
6. 품질 비교 run은 다른 벤치마크 프로세스와 동시에 돌리지 않는다.

## Open Questions

Ablation으로 닫는 결정(구현 중 기록, spec 개정 불필요):

- Q1: short AND vs all-token OR 중 최종 FTS semantics.
- Q2: provider별 threshold vs top-k fill fallback.
- Q3: min-max normalization 유지 여부.
- Q4: 기존 `memento_prod` 키 유지 + alias vs 이름 변경(`memento_engine`). 하위 호환을 위해 키 유지 + `production_path` 필드 명시를 기본 가정으로 한다.

## Out of Scope

- 새 embedding/reranker/parser
- corpus-specific stopword 또는 LoCoMo 통계를 production 코드에 주입
- 사용자 DB migration
- 공식 LoCoMo evaluator 의미 변경 및 외부 공개 점수 발표
- 전역 ranking weight 재튜닝(P0 복원 이전)
