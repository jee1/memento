# Research: 대시보드 앵커 맵 검색 안정화 (015)

## 1. 전역 `nodes` / `links` 불변식

**Decision**: `let nodes, links` 대신 **빈 배열로 초기화**하고, `renderMap()`에서 노드 없이 조기 반환할 때도 **`nodes = []; links = [];`** 를 명시적으로 설정한다.

**Rationale**: `undefined.find`만이 아니라 이후 모든 `nodes.filter`/`forEach` 호출에서 동일한 안전성을 확보한다. 이슈 #150 분석과 일치한다.

**Alternatives considered**:

- `highlightSearchResults`에만 가드: 최소 수정이나 다른 호출자(`selectAnchorNode` 등)에서 동일 버그 재발 가능.
- 조기 반환 시에만 초기화: 선언부 미초기화 시 첫 검색·타이밍 경쟁에서 여전히 위험.

## 2. `highlightSearchResults` 방어 코드

**Decision**: 첫 결과 포커스 전에 **`Array.isArray(nodes)`** (또는 동등한 검사)로 맵 렌더 데이터가 준비됐는지 확인하고, 아니면 하이라이트 집합만 갱신하고 줌/선택은 생략한다.

**Rationale**: 스펙 FR-002(맵 전용 후속 생략)·FR-005(상태 판별)와 일치; 빈 배열 초기화와 중복되더라도 방어층을 유지한다.

**Alternatives considered**: 초기화만으로 충분한지 검토했으나, 비동기 순서에서 배열이 일시적으로 비어 있을 수 있어 이중 방어를 채택.

## 3. `selectAnchorNode` 등 기타 `nodes.find` 사용처

**Decision**: 동일 파일 내 `nodes.find`/`nodes.filter` 사용자 경로를 스캔하고, **`nodes`가 배열이 아닐 때** 안전하게 no-op 하도록 정리한다.

**Rationale**: 동일 루트 원인으로 인한 회귀 방지.

**Alternatives considered**: 변경 범위를 검색 경로로만 제한 — 앵커 목록 클릭 등에서 동일 패턴이면 확장 수정이 낫다.

## 4. D3 줌 호출 패턴

**Decision**: 기존 `svg.transition().duration(750).call(svg.node().dispatchEvent, new CustomEvent('zoom', ...))` 패턴은 **본 이슈 범위에서 변경하지 않는다**(회귀 위험). 노드가 없을 때 해당 블록에 진입하지 않도록만 한다.

**Rationale**: 스펙 FR-003(ready 시 기존과 동등).

## 5. 테스트 전략

**Decision**: `tasks.md` **T000**에서 Vitest로 **Red 단계**(현재 코드에서 실패) 테스트를 먼저 추가하고, T001–T004 후 **Green**으로 전환한다. 브라우저 **`quickstart.md`** 는 SC-001~003 수동 검증에 유지한다.

**Rationale**: 헌장 I는 결함 수정에 Red-Green-Refactor 전면 적용; IIFE/전역 스크립트는 재현 조건 최소 복제 또는 소량의 순수 헬퍼 추출로 테스트 가능.
