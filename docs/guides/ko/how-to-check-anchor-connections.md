# 앵커에 연결된 정보 확인 방법

앵커(Anchor)는 A·B·C 세 슬롯에 특정 메모리를 고정하여, 이후 `search_local` 호출 시 그 메모리 주변의 관련 정보만 좁혀서 탐색하는 메커니즘입니다. 앵커에 어떤 메모리들이 연결되어 있는지 확인하는 방법은 네 가지입니다.

## 1. Anchor Map UI (대시보드)

HTTP 서버가 실행 중이라면 대시보드에서 앵커 연결 관계를 시각적으로 확인할 수 있습니다.

```
http://localhost:9001/dashboard
```

대시보드에 접속한 뒤 "Load Map" 버튼을 클릭하면 앵커 노드와 연결된 메모리 노드들이 그래프로 표시됩니다. 앵커 노드는 슬롯별로 색상이 다릅니다. Slot A는 빨간색, Slot B는 주황색, Slot C는 파란색입니다.

그래프에서 노드를 클릭하면 사이드바에 해당 메모리의 상세 정보(Memory ID, 내용, 앵커로부터의 Hop 거리, 유사도 점수, 중요도, 생성 시간)가 표시됩니다. 왼쪽 사이드바의 "Anchors" 섹션에서는 현재 설정된 앵커 목록을 확인하고, 항목을 클릭하면 해당 앵커 노드로 이동할 수 있습니다.

검색어를 입력하고 슬롯을 선택한 뒤 "Search"를 클릭하면, 앵커 주변에서 검색어와 관련된 메모리들을 찾아 결과를 하이라이트합니다.

## 2. HTTP API

### Anchor Map API

앵커와 연결된 전체 노드·링크 구조를 JSON으로 조회합니다.

```bash
curl "http://localhost:9001/api/anchors/map?agent_id=default"
```

응답에는 `anchors`(설정된 앵커 목록), `nodes`(앵커와 연결된 모든 노드), `links`(노드 간 연결 관계) 세 가지 배열이 포함됩니다.

```json
{
  "agent_id": "default",
  "anchors": [
    {
      "agent_id": "default",
      "slot": "A",
      "memory_id": "mem_xxx",
      "created_at": "2025-11-09 06:35:26"
    }
  ],
  "nodes": [
    {
      "id": "mem_xxx",
      "type": "anchor",
      "slot": "A",
      "content": "앵커 메모리 내용",
      "importance": 0.7
    },
    {
      "id": "mem_yyy",
      "type": "memory",
      "content": "연결된 메모리 내용",
      "hop_distance": 1,
      "similarity": 0.85,
      "importance": 0.6
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
  ]
}
```

`nodes`의 `type`이 `"anchor"`이면 앵커 메모리 자체, `"memory"`이면 앵커와 연결된 일반 메모리입니다. `hop_distance`는 앵커로부터의 연결 거리를 나타내며, `links`의 `type`이 `"hop"`이면 hop 거리 기반 연결, `"link"`이면 `memory_link` 테이블 기반 직접 연결입니다.

### Search Local API

특정 슬롯의 앵커 주변에서 검색어와 관련된 메모리를 조회합니다.

```bash
curl -X POST "http://localhost:9001/tools/search_local" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "default",
    "slot": "A",
    "query": "검색어",
    "hop_limit": 3,
    "limit": 10
  }'
```

`query`를 생략하면 검색어 없이 앵커 주변의 모든 관련 메모리를 반환합니다. 검색 결과가 부족하고 `query`가 제공된 경우에만 전역 검색으로 자동 전환됩니다.

## 3. MCP 도구

MCP 클라이언트에서 직접 앵커 정보를 조회할 때는 `get_anchor`와 `search_local` 도구를 사용합니다.

`get_anchor`는 특정 슬롯에 설정된 앵커의 memory_id와 타임스탬프를 반환합니다.

```json
{
  "name": "get_anchor",
  "arguments": {
    "agent_id": "default",
    "slot": "A"
  }
}
```

`search_local`은 앵커 주변에서 hop 거리 내의 메모리를 탐색합니다.

```json
{
  "name": "search_local",
  "arguments": {
    "agent_id": "default",
    "slot": "A",
    "query": "검색어",
    "hop_limit": 3,
    "limit": 10
  }
}
```

응답에는 각 메모리의 ID·내용·타입·유사도·hop 거리·중요도·생성 시간이 포함됩니다.

## 4. 데이터베이스 직접 조회

디버깅이나 데이터 분석 목적으로 SQLite DB를 직접 쿼리할 수 있습니다.

앵커 목록을 조회합니다.

```sql
SELECT * FROM anchor WHERE agent_id = 'default';
```

앵커 메모리 ID가 `mem_xxx`일 때 직접 연결된 메모리들을 `memory_link` 테이블에서 조회합니다.

```sql
SELECT
  ml.target_memory_id AS connected_memory_id,
  ml.similarity,
  ml.created_at AS link_created_at,
  mi.content,
  mi.type,
  mi.importance
FROM memory_link ml
JOIN memory_item mi ON mi.id = ml.target_memory_id
WHERE ml.source_memory_id = 'mem_xxx'
UNION
SELECT
  ml.source_memory_id AS connected_memory_id,
  ml.similarity,
  ml.created_at AS link_created_at,
  mi.content,
  mi.type,
  mi.importance
FROM memory_link ml
JOIN memory_item mi ON mi.id = ml.source_memory_id
WHERE ml.target_memory_id = 'mem_xxx';
```

## Hop Distance 개념

Hop Distance는 앵커 메모리로부터의 연결 거리를 나타냅니다. 1-hop은 앵커와 직접 연결된 메모리, 2-hop은 1-hop 메모리와 연결된 메모리, 이런 식으로 거리가 멀어집니다.

슬롯별 기본 설정은 탐색 범위를 조절합니다.

| 슬롯 | hop_limit | vector_threshold | 특성 |
|------|-----------|-----------------|------|
| A | 2 | 0.7 | 가장 좁은 범위, 높은 관련성 |
| B | 3 | 0.6 | 중간 범위 |
| C | 5 | 0.5 | 넓은 범위 |

작업 컨텍스트가 명확하고 관련 메모리가 집중되어 있을 때는 Slot A나 B를 사용하는 것이 recall보다 빠른 결과를 제공합니다.
