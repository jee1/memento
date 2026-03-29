# Feature Specification: Sleep Consolidation

**Feature Branch**: `005-sleep-consolidation`
**Created**: 2026-03-28
**Status**: Draft
**Input**: User description: "sleep consolidation 을 적용하는 방향으로 진행해줘."

## Background

Memento는 AI 에이전트가 작업하는 동안 수많은 에피소딕 기억을 축적한다. 시간이 지날수록 유사한 에피소딕 항목들이 쌓여 recall 노이즈가 증가하고, 일반적인 질문에 대한 검색 품질이 저하된다. Sleep Consolidation은 인간의 수면 중 기억 통합 메커니즘에서 착안하여, 에피소딕 기억들을 오프라인 배치 프로세스로 분석·클러스터링하고, 의미 있는 시맨틱 지식으로 증류하는 기능이다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 에피소딕 → 시맨틱 자동 증류 (Priority: P1)

AI 에이전트가 수주간 작업하며 동일 주제(예: FastAPI, 특정 프로젝트)에 관한 에피소딕 기억이 수십 개 쌓인다. Sleep Consolidation이 실행되면 유사한 에피소딕 기억들이 하나의 압축된 시맨틱 기억으로 통합된다. 이후 에이전트가 해당 주제를 recall하면, 수십 개의 개별 에피소딕 대신 핵심만 담긴 시맨틱 기억이 반환된다.

**Why this priority**: recall 노이즈 감소는 Memento의 핵심 가치인 "정확한 기억 검색"에 직결된다. 이것이 sleep consolidation의 존재 이유다.

**Independent Test**: 동일 주제의 에피소딕 기억 10개 이상을 저장한 뒤 consolidation을 실행하면, 해당 주제에 대한 시맨틱 기억 1개 이상이 생성되고 원본 에피소딕의 중요도가 감소함을 확인할 수 있다.

**Acceptance Scenarios**:

1. **Given** 동일 주제의 에피소딕 기억이 10개 이상 존재하고 consolidation이 실행되면, **When** 해당 주제로 recall 호출 시, **Then** 클러스터를 대표하는 시맨틱 기억 1개 이상이 상위 결과에 포함된다.
2. **Given** consolidation이 완료된 에피소딕 기억들은, **When** recall 결과에서, **Then** 통합 이전보다 낮은 importance 점수를 가지거나 결과에서 제외된다.
3. **Given** 핀된(pinned) 에피소딕 기억이 있을 때 consolidation이 실행되면, **When** 결과를 확인 시, **Then** 핀된 기억은 변경되지 않고 원본 그대로 유지된다.

---

### User Story 2 - 실시간 성능 무영향 (Priority: P2)

AI 에이전트가 활발히 작업하는 중에도 백그라운드에서 consolidation이 실행될 수 있다. 에이전트는 consolidation이 진행 중인지 여부와 무관하게 recall/remember를 정상 속도로 수행할 수 있어야 한다.

**Why this priority**: consolidation이 실시간 작업을 방해하면 Memento의 기본 사용성이 손상된다. 오프라인 배치로 분리하는 핵심 이유가 여기에 있다.

**Independent Test**: consolidation 실행 중 recall을 10회 연속 호출하여 평균 응답 시간이 consolidation 미실행 시와 유의미한 차이가 없음을 확인한다.

**Acceptance Scenarios**:

1. **Given** consolidation 배치가 실행 중일 때, **When** recall을 호출하면, **Then** 평상시 대비 응답 시간이 10% 이내 차이로 유지된다.
2. **Given** consolidation 배치가 실행 중일 때, **When** remember를 호출하면, **Then** 새 기억이 정상적으로 저장된다.

---

### User Story 3 - 추적 가능한 통합 이력 (Priority: P3)

통합된 시맨틱 기억이 어떤 에피소딕 기억들로부터 생성되었는지 추적할 수 있어야 한다. 통합이 잘못된 경우(예: 무관한 기억이 묶인 경우) 원인을 파악하고 수정이 가능하다.

**Why this priority**: 신뢰성 확보를 위해 통합 결과를 검증·추적할 수 있어야 한다. P1, P2가 없으면 이 기능은 의미가 없으므로 P3.

**Independent Test**: consolidation 실행 후 생성된 시맨틱 기억의 메타데이터에서 소스 에피소딕 ID 목록을 확인할 수 있다.

**Acceptance Scenarios**:

1. **Given** consolidation이 완료된 시맨틱 기억이 있을 때, **When** 해당 기억을 조회하면, **Then** 통합에 사용된 원본 에피소딕 기억의 ID 목록이 메타데이터에 포함된다.
2. **Given** consolidation 실행 로그가 있을 때, **When** 로그를 조회하면, **Then** 실행 시각, 처리된 클러스터 수, 생성된 시맨틱 수, 변경된 에피소딕 수가 기록되어 있다.

---

### Edge Cases

- 에피소딕 기억이 클러스터 최소 임계값에 미달하면 consolidation을 건너뛴다.
- 요약 생성 중 외부 오류(API 타임아웃, 할당량 초과 등)가 발생하면 해당 클러스터만 건너뛰고 나머지 클러스터는 계속 처리한다.
- 모든 에피소딕이 핀된 경우 consolidation 실행 시 아무 변경 없이 정상 종료된다.
- consolidation 실행 중 새로운 에피소딕이 저장되면, 해당 항목은 다음 consolidation 사이클에서 처리된다.
- 임베딩이 없는 에피소딕(임베딩 생성 실패 항목)은 클러스터링 대상에서 제외한다.
- consolidation 배치가 중간에 크래시되면, 시맨틱 저장 전에 마킹되지 않은 에피소딕들은 다음 실행에서 자동으로 재처리된다(FR-003의 순서 보장으로 자기수복).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 에피소딕 기억을 `owner_id` 단위로 격리하여 클러스터링해야 한다. 서로 다른 `owner_id`의 에피소딕은 동일한 클러스터로 묶이지 않는다. `is_consolidated=TRUE` 플래그가 설정된 에피소딕은 클러스터링 대상에서 제외한다. 초기 구현에서는 최근 30일 내 생성된 에피소딕을 대상으로 한다(환경변수로 설정 가능).
- **FR-002**: 시스템은 각 클러스터에서 대표 시맨틱 기억을 생성하고 저장해야 한다. 시맨틱 기억에는 소스 에피소딕 ID 목록이 메타데이터로 포함되어야 한다. 요약 생성은 LLM API 키가 설정된 경우 LLM을 사용하고, 그렇지 않은 경우 클러스터 내 importance가 가장 높은 에피소딕의 내용을 그대로 사용한다(LLM-free fallback).
- **FR-003**: 통합된 에피소딕 기억들은 importance를 0.1 이하로 감소시키고 `is_consolidated=TRUE` 플래그를 설정해야 한다. 이 변경은 반드시 시맨틱 기억 저장이 성공한 이후에 수행한다. 원본 에피소딕은 삭제하지 않고 유지하며, 일반 recall에서는 시맨틱 기억이 앞서지만 직접 조회는 가능하다. 하드딜리트는 수행하지 않는다.
- **FR-004**: consolidation은 실시간 recall/remember와 격리된 오프라인 배치 프로세스로 실행되어야 한다.
- **FR-005**: 핀된(pinned) 기억은 consolidation 대상에서 제외되어야 한다.
- **FR-006**: consolidation은 설정 가능한 일정(기본: 매일 1회)으로 자동 실행되어야 한다.
- **FR-007**: 클러스터를 구성할 최소 에피소딕 수(기본값: 5개)를 충족하지 못하는 후보 그룹은 건너뛰어야 한다.
- **FR-008**: consolidation 실행 결과(실행 시각, 처리 클러스터 수, 생성된 시맨틱 수, 변경된 에피소딕 수)는 구조화된 로그로 기록되어야 한다.
- **FR-009**: consolidation 중 개별 클러스터 처리 실패는 해당 클러스터만 건너뛰고 전체 프로세스는 계속 진행해야 한다(부분 실패 허용).
- **FR-010**: HTTP admin API를 통해 consolidation을 수동으로 즉시 실행할 수 있어야 한다. `dryRun=true` 옵션 사용 시 실제 DB 변경 없이 클러스터 탐색 결과만 반환한다. consolidation이 이미 실행 중인 경우 409를 반환하여 동시 실행을 방지한다.

### Key Entities

- **Consolidation Cluster**: 동일 `owner_id` 내에서 유사도 기반으로 묶인 에피소딕 기억들의 집합. 포함된 에피소딕 ID 목록과 클러스터 대표 주제를 가진다. `is_consolidated=FALSE`인 항목만 대상이 된다.
- **Consolidated Semantic Memory**: 클러스터에서 생성된 시맨틱 기억. 기존 semantic 타입으로 저장되며, 소스 에피소딕 ID 목록을 메타데이터로 보유한다.
- **Consolidation Run Log**: consolidation 배치 실행의 이력. 실행 시각, 처리 결과 요약, 개별 클러스터별 처리 상태를 포함한다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: consolidation 실행 후 특정 주제에 대한 recall 결과에서 에피소딕 항목 수가 실행 전 대비 40% 이상 감소한다.
- **SC-002**: consolidation 배치 실행 중 recall 응답 시간이 평소 대비 10% 이내 차이를 유지한다.
- **SC-003**: consolidation으로 생성된 시맨틱 기억이 원본 에피소딕들의 핵심 내용을 포함하고 있음을 내용 검증 테스트로 확인할 수 있다.
- **SC-004**: 에피소딕 기억 500개 기준으로 consolidation 배치가 120초 이내에 완료된다.
- **SC-005**: 핀된 기억은 consolidation 전후로 내용·중요도·상태가 변경되지 않는다.

## Clarifications

### Session 2026-03-28 (1차)

- Q: 통합 후 원본 에피소딕 처리 방식 → A: importance를 0.1 이하로 감소. 원본 삭제 없이 유지, 직접 조회 가능.
- Q: 이미 통합된 에피소딕 재처리 방지 방식 → A: `is_consolidated=TRUE` 플래그 추가. 이후 consolidation 실행 시 해당 항목은 클러스터링 대상에서 제외.
- Q: 시맨틱 요약 생성 방식 → A: LLM 선택적 향상. API 키 있으면 LLM 요약, 없으면 클러스터 내 최고 importance 에피소딕 내용 그대로 사용(LLM-free fallback).
- Q: 배치 중간 장애 복구 방식 → A: 시맨틱 저장 성공 후에만 에피소딕 마킹. 크래시 시 미마킹 에피소딕은 다음 실행에서 자동 재처리.
- Q: 멀티에이전트 환경에서 consolidation 범위 → A: `owner_id` 단위 격리. 서로 다른 에이전트의 에피소딕은 혼합 통합 안 함.

### Session 2026-03-28 (2차)

- Q: FR-010에 dryRun과 동시 실행 방지(409)를 명시적으로 추가해야 하는가 → A: 추가. dryRun은 변경 없는 클러스터 탐색 결과만 반환. 동시 실행 중이면 409 반환.

## Assumptions

- LLM API 키가 설정된 경우 LLM으로 요약 생성, 미설정 시 클러스터 내 최고 importance 에피소딕 내용을 그대로 사용하는 추출 요약 방식(LLM-free fallback)으로 자동 전환한다.
- 클러스터링은 코사인 유사도 기반 임계값 방식을 기본으로 적용한다.
- 배치 스케줄러는 기존 infrastructure의 배치 스케줄러 인프라를 재사용한다.
- consolidation 대상 타입은 episodic에 한정한다(working memory 제외).
- 초기 구현의 consolidation 대상은 최근 30일 내 생성된 에피소딕으로 제한한다(기본값; 환경변수 `CONSOLIDATION_LOOKBACK_DAYS`로 설정 가능). FR-001에 포함된 요구사항.
