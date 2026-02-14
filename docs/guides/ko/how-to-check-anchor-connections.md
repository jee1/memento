# 앵커에 연결된 정보 확인 방법

앵커에 연결된 메모리들을 확인하는 여러 방법을 안내합니다.

## 📋 목차

1. [Anchor Map UI에서 확인](#1-anchor-map-ui에서-확인)
2. [API를 통한 확인](#2-api를-통한-확인)
3. [MCP Tool을 통한 확인](#3-mcp-tool을-통한-확인)
4. [데이터베이스 직접 조회](#4-데이터베이스-직접-조회)

---

## 1. Anchor Map UI에서 확인

### 1.1 대시보드 접속
```
http://localhost:8080/dashboard
```

### 1.2 Load Map 버튼 클릭
- "Load Map" 버튼을 클릭하면 앵커와 연결된 메모리들이 시각화됩니다
- 앵커 노드는 슬롯별 색상으로 표시됩니다:
  - **Slot A**: 빨간색 (#ef4444)
  - **Slot B**: 주황색 (#f59e0b)
  - **Slot C**: 파란색 (#3b82f6)

### 1.3 노드 클릭
- 맵에서 노드를 클릭하면 사이드바에 메모리 상세 정보가 표시됩니다:
  - **Type**: Anchor 또는 Memory
  - **Memory ID**: 메모리 고유 ID
  - **Content**: 메모리 내용
  - **Hop Distance**: 앵커로부터의 거리 (1-hop, 2-hop, ...)
  - **Similarity**: 유사도 점수
  - **Importance**: 중요도
  - **Created**: 생성 시간

### 1.4 사이드바 확인
- 왼쪽 사이드바의 "Anchors" 섹션에서 설정된 앵커 목록을 확인할 수 있습니다
- 각 앵커를 클릭하면 해당 앵커 노드로 이동합니다

### 1.5 검색 기능 사용
- 검색어를 입력하고 Slot을 선택한 후 "Search" 버튼을 클릭하면:
  - 앵커 주변에서 검색어와 관련된 메모리들을 찾습니다
  - 검색 결과가 하이라이트됩니다 (펄스 애니메이션)
  - 첫 번째 검색 결과로 자동 확대/이동합니다

---

## 2. API를 통한 확인

### 2.1 Anchor Map API
```bash
curl "http://localhost:8080/api/anchors/map?agent_id=default"
```

**응답 구조:**
```json
{
  "agent_id": "default",
  "anchors": [
    {
      "agent_id": "default",
      "slot": "A",
      "memory_id": "mem_xxx",
      "created_at": "2025-11-09 06:35:26",
      "updated_at": "2025-11-09 06:35:26"
    }
  ],
  "nodes": [
    {
      "id": "mem_xxx",
      "type": "anchor",
      "slot": "A",
      "content": "앵커 메모리 내용",
      "importance": 0.7,
      "created_at": "2025-11-09T06:31:47.827Z"
    },
    {
      "id": "mem_yyy",
      "type": "memory",
      "content": "연결된 메모리 내용",
      "hop_distance": 1,
      "similarity": 0.85,
      "importance": 0.6,
      "created_at": "2025-11-09T06:32:10.123Z"
    }
  ],
  "links": [
    {
      "source": "mem_xxx",
      "target": "mem_yyy",
      "type": "hop",
      "hop_distance": 1,
      "similarity": 0.85
    }
  ],
  "timestamp": "2025-11-09T06:54:58.329Z"
}
```

**설명:**
- `anchors`: 설정된 앵커 목록
- `nodes`: 앵커와 연결된 모든 메모리 노드
  - `type: "anchor"`: 앵커 노드
  - `type: "memory"`: 연결된 메모리 노드
  - `hop_distance`: 앵커로부터의 거리 (1, 2, 3, ...)
  - `similarity`: 앵커와의 유사도 (0.0 ~ 1.0)
- `links`: 노드 간 연결 관계
  - `type: "hop"`: Hop 거리 기반 연결
  - `type: "link"`: memory_link 테이블 기반 직접 연결

### 2.2 Search Local API
```bash
curl -X POST "http://localhost:8080/tools/search_local" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "default",
    "slot": "A",
    "query": "검색어",
    "hop_limit": 3,
    "limit": 10
  }'
```

**파라미터:**
- `agent_id`: 에이전트 ID (기본값: "default")
- `slot`: 앵커 슬롯 (A, B, C)
- `query`: 검색어 (선택적, 없으면 앵커 기반 recall)
- `hop_limit`: 최대 hop 거리 (선택적, 기본값: 슬롯별 설정)
- `limit`: 최대 결과 수 (기본값: 10)

**응답 구조:**
```json
{
  "items": [
    {
      "id": "mem_yyy",
      "content": "메모리 내용",
      "type": "episodic",
      "similarity": 0.85,
      "hop_distance": 1,
      "importance": 0.6,
      "created_at": "2025-11-09T06:32:10.123Z"
    }
  ],
  "total": 1,
  "anchor_slot": "A",
  "search_type": "local"
}
```

---

## 3. MCP Tool을 통한 확인

### 3.1 get_anchor Tool
```json
{
  "name": "memento.get_anchor",
  "arguments": {
    "agent_id": "default",
    "slot": "A"
  }
}
```

**응답:**
```json
{
  "agent_id": "default",
  "slot": "A",
  "memory_id": "mem_xxx",
  "created_at": "2025-11-09 06:35:26",
  "updated_at": "2025-11-09 06:35:26"
}
```

### 3.2 search_local Tool
```json
{
  "name": "memento.search_local",
  "arguments": {
    "agent_id": "default",
    "slot": "A",
    "query": "검색어",
    "hop_limit": 3,
    "limit": 10
  }
}
```

**응답:**
```json
{
  "items": [
    {
      "id": "mem_yyy",
      "content": "메모리 내용",
      "type": "episodic",
      "similarity": 0.85,
      "hop_distance": 1,
      "importance": 0.6,
      "created_at": "2025-11-09T06:32:10.123Z"
    }
  ],
  "total": 1,
  "anchor_slot": "A",
  "search_type": "local"
}
```

---

## 4. 데이터베이스 직접 조회

### 4.1 앵커 정보 조회
```sql
SELECT * FROM anchor WHERE agent_id = 'default';
```

### 4.2 앵커 주변 메모리 조회 (memory_link 활용)
```sql
-- 앵커 메모리 ID가 'mem_xxx'인 경우
SELECT 
  ml.target_memory_id as connected_memory_id,
  ml.similarity,
  ml.created_at as link_created_at,
  mi.content,
  mi.type,
  mi.importance
FROM memory_link ml
JOIN memory_item mi ON mi.id = ml.target_memory_id
WHERE ml.source_memory_id = 'mem_xxx'
UNION
SELECT 
  ml.source_memory_id as connected_memory_id,
  ml.similarity,
  ml.created_at as link_created_at,
  mi.content,
  mi.type,
  mi.importance
FROM memory_link ml
JOIN memory_item mi ON mi.id = ml.source_memory_id
WHERE ml.target_memory_id = 'mem_xxx';
```

### 4.3 임베딩 기반 유사 메모리 조회
```sql
-- 앵커 메모리의 임베딩을 기준으로 유사한 메모리 찾기
-- (벡터 검색은 VectorSearchEngine을 통해 수행)
```

---

## 🔍 Hop Distance 설명

**Hop Distance**는 앵커로부터의 연결 거리를 나타냅니다:

- **1-hop**: 앵커와 직접 연결된 메모리 (가장 관련성 높음)
- **2-hop**: 1-hop 메모리와 연결된 메모리
- **3-hop**: 2-hop 메모리와 연결된 메모리
- ...

**슬롯별 기본 설정:**
- **Slot A**: hop_limit = 2, vector_threshold = 0.7 (가장 가까운 연결)
- **Slot B**: hop_limit = 3, vector_threshold = 0.6 (중간 범위)
- **Slot C**: hop_limit = 5, vector_threshold = 0.5 (넓은 범위)

---

## 💡 팁

1. **검색어 없이 검색**: `query` 파라미터를 생략하면 앵커 주변의 모든 관련 메모리를 가져옵니다 (앵커 기반 recall)

2. **Fallback 동작**: 검색 결과가 부족하고 `query`가 제공된 경우에만 전역 검색으로 자동 전환됩니다

3. **실시간 업데이트**: WebSocket을 통해 앵커 변경 시 맵이 자동으로 업데이트됩니다

4. **노드 드래그**: 맵에서 노드를 드래그하여 위치를 조정할 수 있습니다

---

## 📚 관련 문서

- [Anchor Map Manual Test Guide](../reviews/anchor-map-manual-test-guide.md)
- [Anchor System PRD](../tasks/0006-prd-anchor-system.md)
- [Anchor Map Browser Test Report](../reviews/anchor-map-browser-test-report.md)

