# Research: 기억 관계 그래프 뷰

**Feature**: 009-memory-graph-view  
**Date**: 2026-04-02

## 결정 사항

### 1. 백엔드 데이터 소스

**Decision**: `memory_relation` 테이블(RelationGraph 서비스)과 `kg_triple` 테이블(KgTripleRepository)을 조합하여 그래프 데이터를 구성한다.

**Rationale**:
- `memory_relation`은 기억 간 명시적 관계를 저장 (`source_id`, `target_id`, `relation_type`, `confidence`)
- `kg_triple`은 지식 그래프 트리플을 저장하는데, `representative_memory_id`로 기억과 연결됨
- `/admin/graph` 엔드포인트는 두 테이블을 JOIN하여 노드와 엣지를 구성

**Alternatives considered**:
- RelationGraph 서비스만 사용: kg_triple 연결 정보 누락
- kg_triple만 사용: subject/object가 기억 ID가 아닌 텍스트 엔티티이므로 노드로 표현하기 어려움

**Implementation approach**: 
1. `memory_item`에서 모든 기억을 조회하여 노드 생성
2. `memory_relation`에서 엣지 생성 (source_id, target_id 직접 매핑)
3. `kg_triple`의 `representative_memory_id`를 활용해 추가 연결 정보 보완 (선택적)

---

### 2. 프론트엔드 라이브러리

**Decision**: D3.js v7 (CDN)

**Rationale**:
- force-directed 그래프에 가장 널리 검증된 라이브러리
- CDN 방식으로 별도 빌드 불필요
- 기존 `anchor-map.js`가 순수 JS 방식으로 작성된 패턴과 일치
- 인터랙션(드래그, 줌, 클릭) 모두 D3 기본 기능으로 처리 가능

**Alternatives considered**:
- Cytoscape.js: D3보다 그래프 특화 API이나 파일 크기가 크고 CDN 의존성이 복잡
- vis-network: 사용 편리하나 라이선스 제약(Apache 2.0) 확인 필요, D3보다 커스터마이징 어려움

---

### 3. 엔드포인트 위치

**Decision**: 기존 `admin.routes.ts`에 `GET /admin/graph` 추가

**Rationale**:
- 기존 관계 엔드포인트들(`/admin/relations/*`)과 동일한 라우터에 위치
- 기존 adminAuth 미들웨어 자동 적용
- 신규 라우터 파일 불필요

**Alternatives considered**:
- 별도 `graph.routes.ts` 파일: 분리가 깔끔하나 단일 엔드포인트에는 과도한 구조
- MCP 도구로 추가: MCP는 AI 에이전트용, 시각화 UI는 어드민 전용이므로 부적합

---

### 4. 정적 파일 서빙

**Decision**: `static/graph.html` 신규 생성, 기존 `app.use('/static', express.static('static'))` 활용

**Rationale**:
- 기존 `static/dashboard.html` 패턴과 일치
- 별도 빌드 파이프라인 불필요
- `app.get('/graph', ...)` 라우트를 `http-server.ts`에 추가하여 `/graph` 접근 시 `graph.html` 반환

---

### 5. 노드 제한 전략

**Decision**: 기본 최대 500개 노드. 쿼리 파라미터 `limit`으로 조정 가능 (최대 1000)

**Rationale**:
- 500개 이상 D3 force-directed 그래프는 브라우저 렌더링 성능이 급격히 저하됨
- 중요도(importance) 내림차순 정렬 후 상위 N개 선택

---

### 6. 테스트 전략

**Decision**: 기존 `admin.routes.spec.ts` 패턴을 따라 HTTP 통합 테스트 + 그래프 데이터 변환 단위 테스트

**Rationale**:
- Constitution I (Test-First): 테스트 먼저 작성
- 데이터 변환 로직(rows → nodes/edges)은 순수 함수로 분리하여 단위 테스트 용이
- HTTP 레이어는 기존 supertest 패턴 재사용
