# Feature Specification: Recall Quality Feedback Loop

**Feature Branch**: `004-recall-quality-feedback-loop`
**Created**: 2026-03-26
**Status**: Draft
**Input**: 검색 품질을 "좋아 보이는 기능"이 아니라 "계속 개선되는 시스템"으로 만들기. 피드백 신호 수집 → 쿼리 클래스별 성능 측정 → 설명 가능성 → A/B 가중치 실험의 4개 레이어.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 피드백 신호 수집 (Priority: P1)

에이전트가 recall 결과를 사용한 뒤, 해당 결과가 실제로 도움이 됐는지 기록할 수 있다. 이 기록이 누적되면 "어떤 기억이 자주 도움이 되고, 어떤 기억은 검색되지만 쓸모없는지" 데이터가 쌓인다.

**Why this priority**: 피드백 없이는 랭킹 개선이 주관적 판단에 의존한다. 모든 다음 레이어(대시보드, A/B 실험, 자동 가중치 튜닝)의 입력 데이터가 여기서 나온다.

**Independent Test**: recall을 호출한 뒤 특정 결과에 대해 helpful=true/false를 기록하고, 이후 동일 기억의 사용 통계가 반영되는지 확인하면 완전히 독립 검증 가능.

**Acceptance Scenarios**:

1. **Given** 에이전트가 recall을 호출해 기억 목록을 받았을 때, **When** 특정 기억 ID에 helpful=true 피드백을 제출하면, **Then** 해당 기억의 긍정 피드백 횟수가 1 증가한다.
2. **Given** 에이전트가 recall을 호출해 기억 목록을 받았을 때, **When** 특정 기억 ID에 helpful=false 피드백을 제출하면, **Then** 해당 기억의 부정 피드백 횟수가 1 증가한다.
3. **Given** 피드백이 쌓인 상태에서, **When** 동일한 쿼리로 recall을 다시 호출하면, **Then** 긍정 피드백이 높은 기억이 부정 피드백이 높은 기억보다 상위에 노출된다.
4. **Given** 에이전트가 피드백을 생략한 경우, **When** 시스템이 동작하면, **Then** 기존 랭킹에 영향 없이 정상 동작한다.

---

### User Story 2 — 쿼리 클래스별 성능 측정 (Priority: P2)

운영자 또는 개발자가 쿼리 유형별(최신 에피소딕 조회, 절차 회수, 개념·의미 검색, 태그 기반 필터링)로 검색 품질이 얼마나 되는지 확인할 수 있다.

**Why this priority**: 전체 MRR이 0.7이어도 "절차 기억 조회"만 0.4일 수 있다. 유형별 분리 없이는 개선 방향을 알 수 없다.

**Independent Test**: 기존 benchmark Ground Truth에 쿼리 클래스 라벨을 붙이고, 클래스별 MRR/NDCG 리포트를 생성해 각 클래스의 수치가 독립적으로 확인되면 검증 완료.

**Acceptance Scenarios**:

1. **Given** 쿼리 셋에 카테고리 라벨이 부여된 상태에서, **When** 품질 측정을 실행하면, **Then** 카테고리별(최신/절차/개념/태그) MRR과 NDCG가 분리된 수치로 출력된다.
2. **Given** 특정 카테고리의 MRR이 임계값(0.5) 미만인 경우, **When** CI에서 카테고리 품질 리포트 단계(`npm run quality:benchmark:category-report`)가 실행되면, **Then** 해당 단계가 실패(exit 1)한다(전체 CI 워크플로 총 벽시계 게이트는 아님; SC-006·Clarifications).
3. **Given** 새로운 쿼리가 benchmark에 추가될 때, **When** 카테고리 라벨 없이 추가되면, **Then** 검증 단계에서 라벨 누락 오류가 발생한다.

---

### User Story 3 — 설명 가능한 랭킹 (Priority: P3)

에이전트가 recall 결과를 받았을 때, 각 기억이 왜 상위에 있는지(관련성, 최신성, 중요도, 사용 빈도, 피드백 신호, 중복 패널티 기여 비율)를 함께 받을 수 있다. 에이전트가 결과를 신뢰하거나 의심할 근거를 얻는다.

**Why this priority**: P1, P2가 "수집"과 "측정"이라면, P3는 에이전트의 실사용 품질을 높인다. 또한 피드백 품질을 향상시킨다(에이전트가 왜 도움됐는지 파악 가능).

**Independent Test**: recall 호출 시 설명 포함 옵션을 사용하면 각 결과 항목에 점수 구성 요소가 포함되는지 확인.

**Acceptance Scenarios**:

1. **Given** 에이전트가 설명 포함 옵션으로 recall을 호출할 때, **When** 결과가 반환되면, **Then** 각 기억 항목에 관련성·최신성·중요도·사용 빈도·피드백 신호·중복 패널티 **6개** 기여도가 포함된다(FR-008).
2. **Given** 설명 포함 옵션 없이 recall을 호출할 때, **When** 결과가 반환되면, **Then** 기존 응답 형식과 동일하게 score_breakdown 없이 반환된다(하위 호환).
3. **Given** 설명이 포함된 결과에서 에이전트가 helpful=false 피드백을 제출할 때, **When** 피드백이 기록되면, **Then** 어떤 점수 요소가 낮았는지 맥락 정보가 함께 저장된다.
4. **Given** `include_metadata=false`로 recall을 호출할 때, **When** `include_score_breakdown=true`를 함께 넘기면, **Then** 항목에 `score_breakdown`이 포함되지 않는다(메타데이터·세부 점수 생략 정책과 일치; `contracts/mcp-tools.md` §1 참고).

---

### User Story 4 — 랭킹 가중치 A/B 실험 (Priority: P4)

개발자가 두 가지 가중치 설정을 정의하고, 동일한 benchmark Ground Truth로 어느 설정이 더 높은 MRR/NDCG를 달성하는지 통계적으로 비교할 수 있다.

**Why this priority**: 가중치 변경이 직관에 의존하지 않고 실험 결과로 검증되어야 한다. P1~P3이 준비된 뒤 의미 있는 레이어다.

**Independent Test**: 두 가중치 프로파일을 정의하고 benchmark 대상으로 비교 실행 후, 각 프로파일의 MRR 차이와 통계적 유의성이 리포트에 나타나면 검증 완료.

**Acceptance Scenarios**:

1. **Given** 두 가지 이름 붙은 가중치 프로파일이 정의된 상태에서, **When** 비교 실험을 실행하면, **Then** 각 프로파일의 MRR, NDCG@5, NDCG@10이 나란히 출력된다.
2. **Given** 프로파일 A가 프로파일 B보다 MRR이 높을 때, **When** 통계 유의성 검사가 실행되면, **Then** p-value 또는 신뢰 구간이 함께 리포트된다.
3. **Given** 실험 결과 특정 프로파일이 우수하고 팀이 기준선을 갱신하기로 한 경우, **When** 우승 프로파일의 가중치를 저장소의 **단일 소스**(예: `config/ranking-weights.toml`, 필요 시 `config/ranking-profiles/default.toml`과 동기화)에 반영·커밋하면, **Then** 이후 CI 벤치마크와 런타임은 **해당 커밋에 포함된** 가중치를 기준으로 동작한다. (`npm run quality:benchmark:compare-profiles`는 통계·verdict만 출력하며 TOML을 자동 갱신하지 않음 — 오프라인 A/B 범위; 운영 절차는 아래 Assumptions 및 `contracts/mcp-tools.md` §3.3 참고.)

---

### Edge Cases

- 에이전트가 recall 결과를 전혀 사용하지 않고 피드백도 제출하지 않는 경우: 기존 랭킹에 영향 없음.
- 동일한 기억에 helpful=true와 helpful=false가 반복될 경우: 각각 독립 집계하고 net_score(helpful 수 − not_helpful 수)로 단순 합산한다. 90일 슬라이딩 윈도우가 오래된 피드백을 자동 제외하므로 별도 시간 감쇠 가중치는 적용하지 않는다.
- 동일한 기억에 동일한 helpful 값을 **연속·반복** 제출하는 경우: 각 제출은 **별도 피드백 이벤트**로 저장·집계한다(세션/시간 창 기준 디듀프 없음, FR-013).
- benchmark Ground Truth가 없는 쿼리 카테고리에 CI 임계값이 설정된 경우: 데이터 부족 경고를 출력하고 해당 카테고리는 측정에서 제외.
- score_breakdown 요청 시 결과가 많을 경우: 구성 요소는 항상 6개로 고정(FR-008)이며 항목 수 제한은 기존 recall의 `limit` 파라미터로 관리한다.
- A/B 실험에서 두 프로파일의 차이가 통계적으로 유의미하지 않을 경우: "차이 없음(inconclusive)"을 명시적으로 보고.
- 피드백 이벤트 저장이 실패할 경우: recall 응답은 정상 반환하고, 피드백 저장 실패는 **FR-014**에 따른 구조화 로그로 기록한다.
- recall 없이 임의 `memory_id`로 피드백을 제출하는 경우: **존재하지 않는** 기억 ID는 거부한다. **존재하는** 기억 ID에 대한 제출은 허용하며, 해당 기억이 직전 recall 결과에 있었는지는 검증하지 않는다(FR-012).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 recall 결과에 대해 기억 ID와 helpful(긍정/부정) 값을 받아 피드백 이벤트로 저장해야 한다.
- **FR-002**: 피드백 이벤트는 세션 ID, 에이전트 ID, 타임스탬프와 함께 기록되어 출처 추적이 가능해야 한다. 피드백 신호는 에이전트 ID와 무관하게 전역 공통 랭킹 신호로 집계된다.
- **FR-003**: 저장된 피드백 신호는 recall 호출 시점에 별도 피드백 신호(feedback_score)로 랭킹 공식에 독립 항으로 반영되어야 한다(호출 시 집계 방식, 별도 배치 스케줄러 불필요). 기존 usage 신호(recall_count)와 별도 가중치 항으로 처리한다. net_score(helpful − not_helpful)는 시그모이드 함수(`1 / (1 + e^(-net_score))`)로 [0, 1]에 정규화하여 주입한다. 피드백 없는 기억(net=0)은 0.5 중립값으로 기존 랭킹을 교란하지 않는다.
- **FR-004**: 피드백 이벤트 저장은 recall 응답 완료 이후 비동기로 처리되어야 하며, 피드백 경로 도입에 따른 recall 응답 지연 **p95** 증가분이 50밀리초 미만이어야 한다(측정 정의: 동일 벤치마크 워크로드·반복 실행).
- **FR-005**: benchmark 쿼리 원본(`queries.json`)은 변경하지 않는다. 쿼리 카테고리 라벨(최신 에피소딕 조회 / 절차 회수 / 개념·의미 검색 / 태그 필터링)은 별도 매핑 파일(예: `category-mapping.json`)에 query_id→카테고리를 사람이 직접 유지한다. 신규 쿼리 추가 시 매핑 누락은 검증 단계에서 오류로 처리된다.
- **FR-006**: 품질 측정 실행 시 카테고리별 MRR과 NDCG가 분리된 리포트로 출력되어야 한다.
- **FR-007**: CI에서 카테고리별 MRR이 임계값(0.5) 미만일 경우 exit 1(CI 실패)로 처리해야 한다.
- **FR-008**: recall 호출 시 선택적 옵션으로 각 결과 항목에 점수 구성 요소 **6개**(관련성·최신성·중요도·사용 빈도·피드백 신호·중복 패널티)가 포함되어야 한다. 각 요소는 원점수(score)와 전체 최종 점수 대비 백분율(pct)을 함께 반환한다. feedback 항목 포함은 랭킹 공식의 전체 기여도 합산(total)과의 일관성을 위해 필수다. **단, `include_metadata=false`이면 응답에서 메타데이터 블록이 생략되며 `score_breakdown`도 반환되지 않는다**(`include_score_breakdown=true`여도 동일; `contracts/mcp-tools.md` §1). **표시 슬롯 정합성**: API 필드명 `relevance`는 의미적으로 “관련성 계열” 한 슬롯으로, 구현상 가중 적용 후 **α·relevance(벡터·통합 점수 블렌딩 포함)**에 더해 **관계 가중치(ζ·relation_weight)·절차 부스트(procedural_boost)·프로세스 적합도(process_attribute_fit)** 기여를 **동일 슬롯에 합산**한다. 따라서 `relevance.score` / `relevance.pct`는 순수 “α×원시 벡터 유사도”만이 아니라 위 항들의 합을 나타낸다(6개 슬롯 고정·total과 합산 일관성 유지). 자세한 계약은 `contracts/mcp-tools.md` §1 및 `data-model.md` 참고.
- **FR-009**: 점수 구성 요소 포함 옵션을 사용하지 않는 기존 recall 호출은 현재 응답 형식을 그대로 유지해야 한다(하위 호환).
- **FR-010**: 개발자는 이름 붙은 가중치 프로파일을 2개 이상 정의하고, benchmark를 기준으로 프로파일 간 MRR·NDCG 수치를 비교할 수 있어야 한다.
- **FR-011**: 가중치 A/B 비교 리포트는 MRR 차이와 통계적 유의성(p-value 또는 신뢰 구간)을 포함해야 한다.
- **FR-012**: 피드백 제출 시 시스템은 `memory_id`에 대해 형식 유효성 및 기억 존재 여부만 검증한다. 직전 recall 응답에 해당 기억이 포함되었음을 증명하는 correlation token, 세션 내 최근 결과 제한 등은 요구하지 않는다(로컬 단일 MCP 신뢰 모델).
- **FR-013**: 동일 `memory_id`·동일 `helpful` 값에 대한 **반복 제출**은 각각 **독립된 피드백 이벤트**로 저장·집계한다. 세션/시간 창 단위 중복 제거(idempotency)는 적용하지 않는다.
- **FR-014**: 피드백 이벤트 **저장 실패** 시 recall 응답 경로와 분리하여, 최소한 다음 필드를 포함한 **구조화 로그**를 남겨야 한다: `memory_id`, `session_id`, `agent_id`(제공된 경우), 오류 메시지 또는 코드, `timestamp`(ISO 8601).

### Key Entities

- **피드백 이벤트(Feedback Event)**: 특정 recall 결과에 대한 에이전트의 유용성 평가 **한 건의 기록**(제출마다 신규 행). 기억 ID, 세션 ID, 에이전트 ID, helpful 여부, 타임스탬프를 가진다. 보존 기간은 90일(슬라이딩 윈도우)이며, 이후 자동 만료된다(FR-013).
- **쿼리 카테고리(Query Category)**: benchmark 쿼리를 검색 의도 유형으로 분류하는 라벨. 최신 에피소딕 조회 / 절차 회수 / 개념·의미 검색 / 태그 필터링 4종.
- **카테고리 매핑 파일(Category Mapping File)**: `queries.json`을 변경하지 않고 query_id별 카테고리를 부여하기 위한 별도 매핑(예: `category-mapping.json`). 검증 시 corpus에 등장하는 모든 query_id가 매핑에 존재해야 한다.
- **점수 구성 요소(Score Breakdown)**: recall 결과 항목 하나의 최종 점수를 구성하는 요소별 기여값. 관련성, 최신성, 중요도, 사용 빈도, 피드백 신호, 중복 패널티 **6개**. 각 요소는 원점수(score)와 전체 대비 백분율(pct)을 함께 반환한다(FR-008). **관련성 슬롯**(`relevance`)은 구현상 관계 가중·절차 부스트·프로세스 적합도까지 포함한 **복합 기여**를 한 필드에 담는다(FR-008 표시 슬롯 정합성).
- **가중치 프로파일(Weight Profile)**: 랭킹 공식의 각 요소에 대한 가중치 집합. 이름, 버전, 각 가중치 값으로 구성된다.
- **카테고리별 품질 리포트(Category Quality Report)**: 특정 쿼리 카테고리에 대한 MRR, NDCG@5, NDCG@10 수치와 쿼리 수. benchmark 실행 결과물.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 피드백 신호 도입 후 30일 이내에, 긍정 피드백을 받은 기억이 동일 쿼리 재호출 시 상위 5위 안에 재등장하는 비율이 도입 전 대비 10% 이상 향상된다.
- **SC-002**: 쿼리 카테고리별 MRR 측정 결과에서 전체 평균과 1개 이상의 카테고리 간 MRR 차이가 0.1 이상 확인되어 취약 영역이 식별된다.
- **SC-003**: recall 호출 시 점수 구성 요소를 포함하는 옵션을 사용해도 응답 지연 **p95** 증가분이 100밀리초 이내다(측정 정의: 동일 벤치마크 워크로드·반복 실행).
- **SC-004**: 피드백 이벤트 저장 실패 시에도 recall 응답은 정상 반환되며, 저장 실패율이 1% 미만으로 유지된다.
- **SC-005**: A/B 실험에서 MRR 차이가 0.05 이상인 프로파일 쌍에 대해 통계적 유의성(p < 0.05)이 검출된다.
- **SC-006**: 카테고리별 품질 리포트 단계(`npm run quality:benchmark:category-report`)에서, 벤치마크 DB **시드 완료 후** `collectCategoryMetrics` 실행부터 리포트 출력까지의 **스크립트 구간 벽시계**가 30초 이내다. CI 워크플로 전체(체크아웃·install·전체 테스트 등)의 총 벽시계 상한은 본 스펙의 자동 게이트 범위 밖이며, 운영에서 별도로 관리한다(FR-004·SC-003의 p95 지연과 구분).

---

## Assumptions

- 기존 benchmark-v3(쿼리 23개, 메모리 3,440개)를 기준 corpus로 사용한다. 쿼리 카테고리 라벨은 `queries.json`을 수정하지 않고 별도 매핑 파일(예: `category-mapping.json`)에 이 스펙 범위 내에서 추가·유지한다.
- 피드백 이벤트는 MCP 도구를 통해 에이전트가 직접 제출하는 방식을 기본으로 한다. 인간 사용자의 직접 피드백 UI는 이 스펙 범위 밖이다.
- 피드백 MCP는 **로컬 신뢰 경로**로 가정한다. recall 결과와의 암시적 연동 검증·서버 측 인증은 M2 등 별도 스펙 범위이며, 이 스펙에서는 `memory_id` 존재·형식 검증만 요구한다(FR-012).
- 피드백 신호는 에이전트 ID와 무관하게 전역 공통 랭킹 신호로 집계된다. 에이전트별 격리가 필요한 경우 recall의 기존 owner_id 필터로 스코프를 제한할 수 있다.
- A/B 실험은 동일 benchmark Ground Truth를 offline 기준으로 사용한다. 실시간 온라인 A/B(라이브 쿼리 트래픽 분할)는 이 스펙 범위 밖이다.
- **프로파일 승격 → CI 기준선**: `compare-weight-profiles` 스크립트는 paired permutation 결과와 `a_better` / `b_better` / `inconclusive` verdict만 산출한다. “승격”은 **수동**으로 우승 프로파일 TOML 내용을 `config/ranking-weights.toml`(및 선택적으로 `config/ranking-profiles/default.toml`)에 옮겨 PR로 머지하는 절차다. CI는 **머지된 저장소 상태**의 가중치를 읽으므로, 기준선 자동 전환은 “스크립트가 파일을 쓰는 것”이 아니라 **커밋된 설정 변경**으로 달성한다.
- 피드백 신호의 랭킹 반영은 **호출 시 집계(recall 호출 시점에 피드백 카운트를 읽어 반영)** 방식을 기본으로 한다. 배치 스케줄러 없이 동작하며, 경쟁 조건 없이 일관된 결과를 보장한다.
- 가중치 프로파일은 최소 2개(기본값 + 실험값)를 지원하며, 프로파일 수 상한은 제한하지 않는다.
- 피드백 이벤트 보존 기간은 90일(슬라이딩 윈도우)이다. 에피소딕 기억 TTL(90일)과 일치하며, 오래된 피드백이 현재 랭킹을 희석시키지 않도록 한다.
- **성능 측정 통계**: FR-004·SC-003의 지연 한도는 recall **p95** 지연(또는 옵션/피드백 도입 전후의 **p95 증가분**)으로 평가한다. SC-006은 **카테고리 리포트 스크립트**의 집계 구간 벽시계(`quality-benchmark-category-report.ts`, T035)로 자동 평가한다.
- **피드백 중복 정책**: 동일 기억·동일 극성에 대한 반복 제출도 **이벤트마다 누적**한다(FR-013). rate limit·스팸 방지는 별도 스펙으로 다룬다.
- **관측 가능성**: 피드백 저장 실패 로그는 FR-014의 필수 필드를 만족해야 한다(저장 실패 시에도 recall 정상 응답은 SC-004).

---

## Clarifications

### Session 2026-03-26

- Q: 피드백 신호가 랭킹에 반영되는 시점은? → A: 호출 시 집계 — recall 호출 시점에 피드백 카운트를 읽어 반영 (배치 스케줄러 불필요)
- Q: 피드백 이벤트 보존 정책은? → A: 슬라이딩 윈도우 90일 — 90일 이전 이벤트 자동 만료 (에피소딕 기억 TTL과 일치)
- Q: 쿼리 카테고리 라벨링 주체는? → A: 수동 편집 — 별도 매핑 파일(예: category-mapping.json)에 query_id→카테고리를 둔다. queries.json은 변경하지 않는다.
- Q: score_breakdown 반환 형식은? → A: 절대값 + 백분율 병행 (예: `relevance: {score: 0.42, pct: 72}`)
- Q: 다중 에이전트 환경에서 피드백 접근 제어는? → A: 전역 공유 — 모든 에이전트의 피드백이 공통 랭킹 신호에 반영

### Session 2026-03-28

- Q: `score_breakdown.relevance`의 score/pct가 순수 α·벡터 유사도만인가? → A: 아니다. 6개 슬롯 고정을 유지하면서 최종 점수와 합산 일관성을 맞추기 위해, **관계 가중·절차 부스트·프로세스 적합도** 기여를 `relevance` 슬롯에 합산한다(FR-008·`contracts/mcp-tools.md` §1).
- Q: US4에서 우승 프로파일이 나오면 CI 기준선이 자동으로 바뀌는가? → A: 스크립트는 verdict만 출력한다. **수동으로** `ranking-weights.toml` 등을 갱신·커밋해야 하며, CI는 그 커밋을 기준선으로 사용한다(오프라인 A/B 가정과 일치).
- Q: SC-006의 30초 벽시계는 무엇을 포함하는가? → A: `quality-benchmark-category-report` 실행 시 **시드 이후** 메트릭 집계·검색 구간만; 전체 CI 파이프라인 누적 시간은 자동 게이트 대상이 아니다.

### Session 2026-03-27

- Q: benchmark 쿼리 카테고리 라벨의 단일 진실 소스(저장 위치)는? → A: queries.json 원본 고정 + category-mapping.json 별도 매핑 파일(승인된 선택: Option B)
- Q: 피드백 제출 시 memory_id 검증 수준은? → A: 존재·형식 검증만(Option A). recall 연관 증명·opaque token 불필요
- Q: FR-004·SC-003 성능 한도의 측정 통계는? → A: p95 지연(또는 p95 증가분)(승인된 선택: Option B). SC-006은 카테고리 리포트 스크립트 집계 구간 벽시계(시드 제외)
- Q: 동일 memory_id·동일 helpful 반복 제출 시 집계 규칙은? → A: 매 제출 독립 이벤트(Option A). 디듀프·idempotency 없음
- Q: 피드백 저장 실패 시 관측(로그) 최소 요건은? → A: 필수 필드 memory_id, session_id, agent_id(있으면), 오류, timestamp ISO8601(Option A)
- Q: score_breakdown의 구성 요소 개수는? → A: 6개 포함(Option A) — feedback 신호 포함, total과 합산 일관성 유지
- Q: feedback_score 랭킹 주입 전 정규화 방식은? → A: 시그모이드 정규화(Option A) — `1/(1+e^(-net_score))`, [0,1] 범위, 피드백 없는 기억=0.5 중립
- Q: US3 시나리오 3(맥락 저장)의 구현 방식은? → A: `feedback` 도구에 선택적 `score_breakdown` 객체를 두고, 클라이언트가 recall(설명 포함) 응답의 해당 항목 `score_breakdown`을 그대로 전달하면 서버가 `feedback_event.score_breakdown_json`에 저장한다.

---

## Out of Scope

- 인간 사용자(비에이전트)가 recall 결과에 직접 피드백을 남기는 UI
- 실시간 온라인 A/B 테스트(트래픽 분할)
- 자동 가중치 최적화(강화학습, 베이지안 최적화 등): 이 스펙은 측정과 비교까지만 다룬다
- 기억 시각화 대시보드(별도 스펙 예정)
- M2 팀 모드, 인증, 배포 관련 사항
- 피드백 **rate limit**, 스팸 방지, 남용 탐지(동일 주체의 과도한 제출 억제)
