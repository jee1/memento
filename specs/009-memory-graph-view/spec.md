# Feature Specification: 기억 관계 그래프 뷰

**Feature Branch**: `009-memory-graph-view`  
**Created**: 2026-04-02  
**Status**: Draft  
**Input**: User description: "GitHub issue #126 - 기억 관계 그래프 뷰 (Obsidian Graph View 스타일). 백엔드: /admin/graph 엔드포인트, 프론트엔드: D3.js force-directed graph. 기존 memory_relation, kg_triple, RelationGraph 서비스 활용."

## Overview

관리자가 Memento 시스템에 저장된 기억들 간의 관계를 시각적 그래프 형태로 탐색할 수 있게 한다. 기억 노드와 노드 간 관계 엣지를 인터랙티브한 force-directed 그래프로 표시하여, 기억 구조와 연결 패턴을 직관적으로 파악할 수 있도록 한다.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 기억 관계 그래프 조회 (Priority: P1)

관리자가 어드민 UI에서 기억 관계 그래프 페이지에 접근하면, 현재 저장된 기억 노드와 기억 간 관계 엣지가 force-directed 레이아웃으로 시각화된다. 각 기억은 타입(episodic/semantic/procedural)에 따라 색상이 구분되고, 중요도에 따라 노드 크기가 다르게 표시된다.

**Why this priority**: 그래프 뷰의 핵심 가치인 "기억 구조를 한눈에 파악"하는 기능이며, 이것이 없으면 전체 기능이 성립하지 않는다.

**Independent Test**: 어드민 UI의 그래프 페이지를 열어 노드와 엣지가 렌더링되는지 확인하는 것만으로 독립 검증 가능하다.

**Acceptance Scenarios**:

1. **Given** Memento DB에 기억 항목과 관계 데이터가 존재할 때, **When** 어드민 그래프 페이지를 열면, **Then** 기억 노드들이 force-directed 레이아웃으로 표시된다
2. **Given** 기억 항목이 episodic/semantic/procedural 타입으로 존재할 때, **When** 그래프를 로드하면, **Then** 각 타입은 서로 다른 색상으로 구분되어 표시된다
3. **Given** 기억 항목들이 중요도(importance) 값을 가질 때, **When** 그래프를 로드하면, **Then** 중요도가 높을수록 노드 크기가 크게 표시된다
4. **Given** 두 기억 간에 관계가 존재할 때, **When** 그래프를 로드하면, **Then** 두 노드 사이에 엣지가 표시된다
5. **Given** DB에 기억이 없을 때, **When** 그래프를 로드하면, **Then** 빈 그래프 상태 메시지가 표시된다

---

### User Story 2 - 노드 인터랙션 및 기억 상세 조회 (Priority: P2)

관리자가 그래프에서 특정 기억 노드를 클릭하거나 마우스를 올리면, 해당 기억의 상세 내용(content, type, 생성일, 중요도 등)을 확인할 수 있다.

**Why this priority**: 그래프에서 노드를 클릭해 상세 정보를 볼 수 없다면 그래프는 탐색 도구로서 가치가 반감된다. 렌더링(P1) 완성 후 독립적으로 구현 가능하다.

**Independent Test**: P1 완료 후, 노드 클릭 시 상세 패널이 나타나는지만 검증하면 독립적으로 테스트 가능하다.

**Acceptance Scenarios**:

1. **Given** 그래프가 렌더링된 상태에서, **When** 노드에 마우스를 올리면, **Then** 기억 내용 일부(미리보기)가 툴팁으로 표시된다
2. **Given** 그래프가 렌더링된 상태에서, **When** 노드를 클릭하면, **Then** 해당 기억의 상세 정보(내용, 타입, 중요도, 생성일, 태그)가 패널에 표시된다
3. **Given** 노드 상세 패널이 열린 상태에서, **When** 다른 빈 영역을 클릭하면, **Then** 패널이 닫힌다

---

### User Story 3 - 그래프 필터링 (Priority: P3)

관리자가 기억 타입, 관계 타입, 중요도 임계값 등의 필터를 적용하여 관심 있는 기억 서브셋만 그래프에 표시할 수 있다.

**Why this priority**: 기억 수가 많아질수록 전체 그래프는 읽기 어렵다. 필터링은 사용성을 크게 향상시키지만, 기본 그래프 조회(P1, P2)와 독립적으로 구현 및 테스트 가능하다.

**Independent Test**: 필터 UI에서 옵션을 선택하고 그래프가 필터 조건에 맞게 업데이트되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 그래프가 렌더링된 상태에서, **When** 기억 타입 필터(episodic만)를 선택하면, **Then** episodic 타입 노드만 그래프에 표시된다
2. **Given** 그래프가 렌더링된 상태에서, **When** 중요도 임계값(예: 0.5 이상)을 설정하면, **Then** 임계값 미만 기억 노드는 그래프에서 제외된다
3. **Given** 필터가 적용된 상태에서, **When** 필터를 초기화하면, **Then** 전체 기억 노드가 다시 표시된다

---

### User Story 4 - 레이아웃 상호작용 (Priority: P4)

관리자가 그래프 내 노드를 드래그하여 위치를 조정하거나, 줌인/줌아웃을 통해 그래프를 더 자세히 살펴볼 수 있다.

**Why this priority**: 큰 그래프에서 노드가 겹치면 읽기 어렵다. 드래그/줌은 편의 기능으로 P1-P3와 독립적으로 추가 가능하다.

**Independent Test**: 노드를 드래그하여 위치가 변경되는지, 휠 스크롤로 줌이 되는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 그래프가 렌더링된 상태에서, **When** 노드를 드래그하면, **Then** 노드가 새 위치로 이동하고 연결된 엣지도 따라 이동한다
2. **Given** 그래프가 렌더링된 상태에서, **When** 마우스 휠을 사용하면, **Then** 그래프가 줌인/줌아웃된다

---

### Edge Cases

- 기억은 있지만 관계 데이터가 전혀 없을 때: 관계 없는 노드들이 분리된 채 표시된다
- 수백 개 이상의 노드 렌더링 시: 상위 500개 노드만 표시되고 제한 초과 안내가 표시된다
- 한 노드에 매우 많은 엣지가 연결된 경우(허브 노드): 시각적으로 식별 가능하게 렌더링된다
- API 응답 지연 또는 오류 시: 로딩 상태 표시 후 오류 메시지가 표시된다
- 기억 내용에 매우 긴 텍스트가 있을 때: 툴팁/패널에서 내용이 적절히 잘려서(truncate) 표시된다

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 시스템은 기억 노드와 관계 엣지 데이터를 조회하는 API 엔드포인트를 제공해야 한다
- **FR-002**: API는 nodes(id, label, type, importance)와 edges(source, target, relation_type, confidence) 포맷으로 데이터를 반환해야 한다
- **FR-003**: API는 기억 타입(episodic/semantic/procedural), 관계 타입, 중요도 임계값으로 필터링을 지원해야 한다
- **FR-004**: 관리자 UI는 force-directed 레이아웃의 인터랙티브 그래프를 렌더링해야 한다
- **FR-005**: 기억 노드는 타입에 따라 색상이 구분되고 중요도에 따라 크기가 달라야 한다
- **FR-006**: 관계 엣지는 relation_type에 따라 색상이 구분되어야 한다
- **FR-007**: 사용자가 노드에 마우스를 올리면 기억 내용 미리보기 툴팁이 표시되어야 한다
- **FR-008**: 사용자가 노드를 클릭하면 상세 정보 패널이 열려야 한다
- **FR-009**: 사용자가 노드를 드래그하여 위치를 조정할 수 있어야 한다
- **FR-010**: 그래프는 기억 타입, 중요도 임계값 필터를 지원해야 한다
- **FR-011**: 기억이 없거나 필터 결과가 없을 때 적절한 빈 상태 메시지를 표시해야 한다
- **FR-012**: 시스템은 기존 memory_relation 데이터를 그래프 엣지 소스로 사용해야 한다. kg_triple 연동은 향후 확장 포인트로, 이번 구현 범위에서는 제외한다 (subject/object가 텍스트 엔티티로 memory_item id 직접 매핑 불가)

### Key Entities

- **기억 노드(Memory Node)**: 기억 항목을 그래프 노드로 표현. 속성: id, label(내용 요약), type(episodic/semantic/procedural), importance(0~1)
- **관계 엣지(Relation Edge)**: 두 기억 간의 관계를 그래프 엣지로 표현. 속성: source(node id), target(node id), relation_type(extracted_from/supports/related_to 등), confidence(0~1)
- **그래프 응답(Graph Response)**: API가 반환하는 전체 그래프 데이터. 속성: nodes[], edges[]

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 관리자는 어드민 UI에서 3번 이하의 클릭으로 기억 관계 그래프 뷰에 접근할 수 있다
- **SC-002**: 100개 이하의 노드를 가진 그래프는 3초 이내에 완전히 렌더링된다
- **SC-003**: 노드 클릭 후 상세 정보 패널이 1초 이내에 표시된다
- **SC-004**: 필터 적용 후 그래프가 2초 이내에 업데이트된다
- **SC-005**: 그래프 뷰는 memory_relation 관계 데이터를 시각화한다. kg_triple 시각화는 향후 이슈로 추적한다 (관련 이슈: #78)

## Assumptions

- 기존 어드민 HTTP 서버에 신규 라우트를 추가하는 방식으로 구현한다
- memory_relation, kg_triple, RelationGraph 서비스가 이미 완성되어 있으므로 별도 백엔드 도메인 로직 개발은 불필요하다
- 프론트엔드는 별도 빌드 파이프라인 없이 정적 HTML 파일로 서빙한다
- 어드민 UI 접근은 로컬호스트 바인딩으로 접근이 제한된다(별도 인증 불필요)
- 노드 수 기본 상한은 500개로 설정하여 초대형 그래프의 렌더링 성능 문제를 예방한다
