# Feature Specification: Recall metadata wait removal & FTS·vector parallelism

**Feature Branch**: `jee1/perf-recall-metadata-fts-vector`
**Created**: 2026-08-12
**Status**: Ready for Implementation
**Issue**: [#735](https://github.com/jee1/memento/issues/735)
**Parent Epic**: [#733](https://github.com/jee1/memento/issues/733)
**Related**: #736 (done), #737
**Input**: 기본 metadata 경로의 고정 150ms 대기를 제거하고 hybrid FTS·vector 분기를 병렬화한다

## Problem Statement

기본 `include_metadata=true` 경로는 현재 recall이 기록한 meta stats를 읽기 전에 고정 150ms를 기다린다. 이는 `recordRecall` debounce buffer가 DB에 flush되기를 기대하는 read-your-write 우회다. 타이머를 돌리지 않으면 응답 `meta_stats`가 이번 recall을 반영하지 못한다.

또한 hybrid search는 독립적인 FTS 분기와 vector 분기를 직렬로 기다린 뒤 ranker에서 합친다. 두 분기의 지연이 더해져 recall latency가 불필요하게 길어진다.

## Goals

- pending meta stats를 즉시 읽을 수 있게 해 고정 sleep을 제거한다
- 기존 FTS·vector 호출을 동시에 실행한다
- ranker 입력/출력과 검색 순위 계약을 유지한다
- 새 cache나 queue를 추가하지 않는다

## Non-Goals

- cache layer 추가
- ranking weight 변경
- provider 내부 병렬화 재구현
- 새 검색 프레임워크 / Graph-RRF / 새 ranking model
- telemetry period·funnel 교정 (#738)

## User Scenarios & Testing

### User Story 1 - 현재 recall의 meta stats가 즉시 반영된다 (Priority: P1)

에이전트는 `include_metadata=true`(기본값)로 recall한 직후, 이번 호출이 기록한 recall_count·success/failure가 응답 `meta_stats`에 보인다. 고정 대기나 테스트 타이머 진행이 필요 없다.

**Why this priority**: 기본 경로의 150ms 대기가 모든 metadata recall에 붙는다. read-your-write를 유지하면서 이 비용을 없애는 것이 이슈의 첫 목표다.

**Independent Test**: fake timer를 진행하지 않은 채 recall 한 번을 호출하면, 반환 `meta_stats`의 해당 memory_id `recall_count`가 이번 호출을 포함한다. 코드에 `setTimeout(..., 150)`이 없다.

**Acceptance Scenarios**:

1. **Given** 검색 결과가 있는 recall과 `include_metadata=true`, **When** 타이머를 진행하지 않고 응답을 읽으면, **Then** `meta_stats[id].recall_count`가 이번 recall을 반영한다.
2. **Given** 동일 조건, **When** 소스와 테스트를 검사하면, **Then** `getMetaStatsForResults` 경로에 `setTimeout(..., 150)`이 없다.
3. **Given** `include_metadata=false`, **When** recall하면, **Then** `meta_stats`는 생략되고 검색 결과는 기존과 같다.
4. **Given** 검색 결과 0건, **When** recall하면, **Then** meta stats 기록이 없고 응답에 빈/미정의 `meta_stats` 계약이 유지된다.

### User Story 2 - hybrid FTS와 vector가 동시에 돈다 (Priority: P1)

검색 사용자는 hybrid recall에서 FTS와 vector가 서로 기다리지 않고 함께 실행된 뒤, 기존과 같은 ranker 입력으로 합쳐진 결과를 받는다.

**Why this priority**: 직렬 await가 두 분기의 지연을 더한다. 이슈의 두 번째 목표이며, ranking 계약을 건드리지 않고 latency만 줄인다.

**Independent Test**: 두 분기에 서로 다른 고정 지연 mock을 걸면, hybrid 완료 시간이 합이 아니라 최대 분기에 가깝다. ranker는 두 분기 결과를 모두 받는다.

**Acceptance Scenarios**:

1. **Given** FTS mock 지연 A, vector mock 지연 B (A≠B), **When** hybrid search를 실행하면, **Then** 측정 시간은 A+B가 아니라 max(A,B)에 가깝다.
2. **Given** 동일 mock 입력, **When** 병렬화 전후 ranker 입력을 비교하면, **Then** text 결과 집합과 vector 결과 집합이 같다.
3. **Given** FTS 또는 vector 한쪽 실패, **When** hybrid search하면, **Then** 기존 오류/부분 결과 계약이 유지된다 (새 삼키기 없음).

### User Story 3 - 검색 순위와 score breakdown이 불변이다 (Priority: P1)

품질 담당자는 동일 쿼리·동일 후보에 대해 결과 순서, `final_score`, `score_breakdown`이 바뀌지 않음을 회귀로 확인한다.

**Why this priority**: epic #733 원칙 — latency 작업이 ranking을 바꾸면 안 된다. 병렬화는 실행 순서만 바꾸고 결합 로직은 그대로다.

**Independent Test**: 기존 hybrid ranking 테스트와 score_breakdown 스냅샷/단언이 그대로 통과한다. 가중치 파일과 ranker 공식을 수정하지 않는다.

**Acceptance Scenarios**:

1. **Given** 고정 fixture 쿼리, **When** hybrid search하면, **Then** item id 순서와 `final_score`가 기존 테스트 기대와 같다.
2. **Given** `include_score_breakdown=true`, **When** recall하면, **Then** breakdown 필드·값이 기존 계약과 같다.
3. **Given** `config/ranking-weights.toml`, **When** 이 이슈의 diff를 보면, **Then** 가중치·공식 파일이 없다.

### User Story 4 - 실제 recall p95를 비교한다 (Priority: P2)

운영자는 targeted 테스트가 green인 뒤, 실제 recall 경로의 p95가 기존 대비 줄었거나 적어도 고정 150ms+직렬 합만큼 악화되지 않았음을 기록한다.

**Why this priority**: 이슈 Acceptance에 포함되나, CI에서 전체 production p95를 강제하지 않는다. #737 scorecard가 있으면 재사용하고, 없으면 소형 fixture·`recall_profile`로 비교한다.

**Independent Test**: delayed-mock 단위 테스트가 CI gate다. 실제 p95는 로컬/벤치 메모로 남긴다.

**Acceptance Scenarios**:

1. **Given** delayed-mock hybrid 테스트, **When** CI가 돌면, **Then** max-not-sum 단언이 실패하면 머지를 막는다.
2. **Given** 사용 가능한 production/local recall 측정, **When** 전후 p95를 비교하면, **Then** 결과가 spec 폴더 또는 CHANGELOG에 한 줄로 기록된다.

### Edge Cases

- `include_metadata=false`: sleep 경로 자체가 실행되지 않아야 하며, 검색 latency에 meta stats 대기가 없어야 한다.
- 동일 recall 호출 안 중복 `memory_id`: 기존 in-call 집계(한 번 증가)가 유지되어야 한다.
- debounce 창 안의 연속 recall: 마지막 쓰기 debounce 의미는 유지하되, **현재 호출 응답**은 그 호출의 pending stats를 본다.
- vector embedding 불가 / text-only: FTS만 실행되는 기존 fallback이 유지된다.
- SQLite 동기 I/O: 실제 CPU 겹침은 제한될 수 있다. 계약은 “호출 시작이 동시이고, async 지연 mock에서 max에 가깝다”이다.

## Requirements

### Functional Requirements

- **FR-001**: System MUST 현재 recall이 기록한 meta stats를 타이머 진행 없이 해당 recall 응답 `meta_stats`에 포함한다 (`include_metadata=true`이고 결과가 있을 때).
- **FR-002**: System MUST `getMetaStatsForResults`(또는 동일 경로)에서 고정 `setTimeout(..., 150)`을 제거한다.
- **FR-003**: System MUST 기존 pending stats buffer를 읽어 read-your-write를 만족한다. 새 cache/queue를 추가하지 않는다.
- **FR-004**: System MUST hybrid search의 FTS 분기와 vector 분기를 동시에 시작한다.
- **FR-005**: System MUST 두 분기 결과를 기존 ranker에 동일 형태로 전달한다. 결합·정렬 로직을 바꾸지 않는다.
- **FR-006**: System MUST 기존 ranking 결과 순서, `final_score`, `score_breakdown` 계약을 유지한다.
- **FR-007**: System MUST ranking weight·공식·provider 내부 병렬화를 변경하지 않는다.
- **FR-008**: System MUST delayed-mock에서 hybrid 완료 시간이 두 분기 합이 아니라 최대 분기에 가깝다는 테스트를 남긴다.
- **FR-009**: System MUST scope-filter 회귀(#736)를 깨지 않는다.
- **FR-010**: `include_metadata=false` 및 빈 결과 경로의 기존 응답 계약이 유지되어야 한다.

### Key Entities

- **Pending meta stats**: `recordRecall`이 debounce flush 전에 들고 있는 이번 호출 통계. 응답 읽기는 이 값을 볼 수 있어야 한다.
- **FTS branch**: hybrid의 텍스트 검색 분기.
- **Vector branch**: hybrid의 벡터 검색 분기.
- **Ranker input**: 두 분기 결과 + 기존 가중치. 이 이슈에서 불변.

## Success Criteria

- **SC-001**: 타이머 진행 없이 현재 recall의 `meta_stats`가 응답에 반영된다.
- **SC-002**: 해당 경로에 `setTimeout(..., 150)`이 없다.
- **SC-003**: 동일 지연 mock에서 hybrid 시간이 max(분기)에 가깝다.
- **SC-004**: 기존 ranking·score_breakdown 테스트가 통과한다.
- **SC-005**: targeted tests, 실제 recall p95 비교 기록, type-check, lint, graphify가 통과한다.

## Assumptions

- #736 scope-filter 회귀는 이미 green이다. 이 작업의 전제이며 재구현 대상이 아니다.
- #737 production scorecard는 있으면 p95 비교에 재사용하고, 없으면 소형 fixture/`recall_profile`로 대체한다.
- better-sqlite3 FTS는 동기이므로 실측 overlap은 vector 쪽 async(임베딩)와 mock 지연에서 주로 드러난다.

## Out of Scope

- cache / queue / 새 telemetry framework
- ranking weight 변경
- provider 내부 병렬화 재구현
- #738 telemetry 의미 교정
