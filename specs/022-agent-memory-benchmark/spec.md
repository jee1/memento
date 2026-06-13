# Feature Specification: Agent Memory Benchmark

**Feature Branch**: `feature/issue-455-agent-memory-benchmark`
**Created**: 2026-06-07
**Status**: Ready for Implementation
**Input**: Issue #455, epic #452, `specs/017-agent-integration-contracts`

## User Scenarios & Testing

### User Story 1 - 공개 입력을 재현 가능한 평가 입력으로 변환 (Priority: P1)

평가 담당자는 LongMemEval-S retrieval 형식 또는 저장소의 coding-agent fixture를 동일한 내부 benchmark 계약으로 변환해 외부 다운로드 없이 CI에서 검증할 수 있어야 한다.

**Independent Test**: 최소 LongMemEval-S fixture와 native fixture를 normalize한 결과가 같은 query/corpus/ground-truth 계약을 만족하고 secret/license 검사를 통과하면 검증된다.

**Acceptance Scenarios**:

1. **Given** LongMemEval-S retrieval JSONL 입력, **When** adapter를 실행하면, **Then** corpus, query, relevant memory ID, session ID가 손실 없이 내부 계약으로 변환된다.
2. **Given** 지원하지 않는 schema 또는 secret marker가 있는 입력, **When** 검증하면, **Then** 명시적 오류로 실패하고 결과 파일을 생성하지 않는다.
3. **Given** 저장소 fixture만 있는 CI, **When** benchmark를 실행하면, **Then** 네트워크와 외부 API 없이 결정론적으로 완료된다.

### User Story 2 - 동일 조건 baseline 비교 (Priority: P1)

검색 품질 담당자는 grep, FTS-only, vector-only, Memento를 동일 corpus, query, top-k, token budget으로 비교해야 한다.

**Independent Test**: 한 실행 보고서에 네 baseline의 R@5, R@10, MRR, NDCG@10, p50/p95, injected tokens가 모두 존재하고 query 수가 동일하면 검증된다.

**Acceptance Scenarios**:

1. **Given** 고정 fixture와 seed, **When** benchmark를 두 번 실행하면, **Then** 순위·품질·token 지표가 동일하다.
2. **Given** 각 baseline, **When** 평가하면, **Then** 동일 query text, corpus, limit, relevant IDs를 사용한다.
3. **Given** latency 측정, **When** gate를 판단하면, **Then** 품질 결과와 분리된 p50/p95 예산으로 판정한다.

### User Story 3 - retrieval과 E2E 결과 분리 (Priority: P1)

사용자는 검색 지표 향상을 실제 task completion 향상으로 오해하지 않도록 retrieval-only와 end-to-end 결과를 별도 섹션으로 확인해야 한다.

**Independent Test**: 보고서 schema가 `retrieval`과 `end_to_end`를 독립 필드로 요구하고 서로 다른 query/case count와 metric을 갖는지 검증한다.

**Acceptance Scenarios**:

1. **Given** relevant memory가 검색된 경우, **When** retrieval을 평가하면, **Then** ranking metric만 계산한다.
2. **Given** E2E case, **When** task completion을 평가하면, **Then** token budget 안에 필수 evidence가 주입되었는지 별도로 계산한다.
3. **Given** 보고서, **When** 공개 결과를 읽으면, **Then** retrieval metric과 completion rate를 합성한 단일 점수가 없다.

### User Story 4 - graph 후보와 RRF 채택 gate (Priority: P2)

검색 설계자는 graph candidate stream을 feature flag로 켜고 RRF 융합의 이득과 비용을 baseline Memento와 비교해야 한다.

**Independent Test**: flag off가 기존 Memento 결과와 동일하고 flag on 보고서에 품질 비열화, 외부 recall, latency, duplicate, session bias gate가 모두 기록되면 검증된다.

**Acceptance Scenarios**:

1. **Given** graph flag off, **When** 실행하면, **Then** graph candidate를 생성하거나 결과에 섞지 않는다.
2. **Given** graph flag on, **When** seed 후보의 관계를 확장하면, **Then** RRF로만 융합하고 source stream을 추적한다.
3. **Given** graph 결과, **When** 채택 gate를 평가하면, **Then** MRR/NDCG 비열화 없음, recall 개선, p95 예산, duplicate/session bias 예산을 모두 만족해야 candidate가 된다.

## Requirements

### Functional Requirements

- **FR-001**: LongMemEval-S retrieval adapter는 명시적 JSONL input contract와 오류 메시지를 제공해야 한다.
- **FR-002**: 저장소는 라이선스, 출처, synthetic 여부, secret 검토 상태를 포함하는 coding-agent corpus manifest를 제공해야 한다.
- **FR-003**: fixture는 session, memory, provenance/graph edge, query, relevant IDs, E2E evidence를 포함해야 한다.
- **FR-004**: grep, FTS-only, vector-only, Memento baseline은 동일 corpus/query/top-k 조건을 사용해야 한다.
- **FR-005**: vector baseline은 외부 모델 없이 고정 tokenizer와 TF-IDF cosine으로 계산해야 한다.
- **FR-006**: Memento baseline은 lexical/vector stream을 deterministic RRF로 결합해야 한다.
- **FR-007**: graph experiment는 기본 off인 feature flag여야 하며 seed stream의 relation 후보를 별도 stream으로 생성해야 한다.
- **FR-008**: 보고서는 R@5, R@10, MRR, NDCG@10, p50, p95, injected tokens를 baseline별로 제공해야 한다.
- **FR-009**: retrieval-only와 E2E completion/evidence coverage는 별도 schema와 별도 집계로 출력해야 한다.
- **FR-010**: 실행 manifest는 benchmark version, fixture SHA-256, git SHA, Node version, platform, architecture, seed, feature flags를 포함해야 한다.
- **FR-011**: quality non-degradation, latency, duplicate rate, session concentration bias gate를 제공해야 한다.
- **FR-012**: graph-RRF 채택 후보는 Memento 대비 MRR/NDCG 비열화가 없고 R@10이 개선되며 모든 운영 gate를 통과해야 한다.
- **FR-013**: 입력에서 credential/private-key/token marker가 발견되면 fail closed 해야 한다.
- **FR-014**: 기존 `tests/fixtures/search-quality/benchmark-v3`와 `quality:benchmark:*` 계약을 변경하거나 완화하지 않아야 한다.
- **FR-015**: benchmark는 네트워크, 외부 다운로드, 신규 dependency 없이 실행되어야 한다.

### Key Entities

- **Benchmark Corpus Manifest**: 출처, 라이선스, secret 검토, 재현 정보.
- **Agent Memory Document**: session/provenance를 가진 검색 문서.
- **Retrieval Query**: query text, relevant IDs, source/target session.
- **Graph Edge**: memory 간 후보 확장 관계.
- **E2E Case**: token budget과 필수 evidence ID를 가진 task completion case.
- **Baseline Result**: query별 ranked IDs, latency, injected tokens.
- **Gate Result**: threshold, observed value, pass/fail, reason.
- **Reproduction Manifest**: 실행 환경과 fixture/version fingerprint.

## Success Criteria

- **SC-001**: native와 LongMemEval-S fixture가 CI에서 외부 입력 없이 normalize된다.
- **SC-002**: 네 baseline이 동일 query 수와 top-k로 평가된다.
- **SC-003**: 동일 seed의 반복 실행에서 ranking/quality/token 결과가 byte-equivalent다.
- **SC-004**: 보고서에 retrieval과 E2E metric이 분리되어 있다.
- **SC-005**: graph flag off 결과가 Memento baseline과 동일하다.
- **SC-006**: graph 채택 verdict가 모든 명시 gate의 conjunction으로만 결정된다.
- **SC-007**: secret fixture는 명시적으로 거절되고 corpus에는 synthetic/approved 데이터만 존재한다.
- **SC-008**: benchmark-v3 기존 regression test와 scripts가 그대로 통과한다.

## Assumptions

- LongMemEval-S 원본 데이터는 저장소에 vendoring하지 않고 adapter contract와 synthetic fixture만 제공한다.
- 공개 corpus는 이 저장소 목적에 맞게 작성한 synthetic MIT fixture다.
- latency는 환경 영향이 있으므로 품질 재현성과 분리하며 넉넉한 CI 예산으로 gate한다.

## Out of Scope

- 외부 LongMemEval-S 다운로드/재배포
- LLM 호출을 포함한 생성 품질 평가
- 제품 검색 ranking 변경
- CLI/dashboard 기능
- graph-RRF 기본 활성화
