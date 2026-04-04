# Contract: GET /admin/graph

**Version**: 1.0.0  
**Date**: 2026-04-02  
**Auth**: adminAuth 미들웨어 (기존 ADMIN_API_KEY 또는 로컬호스트 바인딩)

## Endpoint

```
GET /admin/graph
```

## Query Parameters

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `types` | `string` (comma-separated) | 전체 | 기억 타입 필터. 예: `episodic,semantic` |
| `relation_types` | `string` (comma-separated) | 전체 | 관계 타입 필터. 예: `supports,related_to` |
| `min_importance` | `number` (0.0~1.0) | `0.0` | 최소 중요도 임계값 |
| `limit` | `number` (1~1000) | `500` | 최대 노드 수 |

## Response: 200 OK

```json
{
  "nodes": [
    {
      "id": "mem_abc123",
      "label": "TypeScript의 interface는 타입 체크에...",
      "content": "TypeScript의 interface는 타입 체크에 사용되며 런타임에는 존재하지 않는다. type alias와 달리 extends로 확장 가능하다.",
      "type": "semantic",
      "importance": 0.85,
      "created_at": "2026-03-15T09:23:11.000Z",
      "tags": ["typescript", "programming"],
      "pinned": false
    }
  ],
  "edges": [
    {
      "id": "rel_42",
      "source": "mem_abc123",
      "target": "mem_def456",
      "relation_type": "supports",
      "confidence": 0.92,
      "edge_source": "memory_relation"
    }
  ],
  "meta": {
    "total_nodes": 1,
    "total_edges": 1,
    "applied_filters": {
      "types": ["semantic"],
      "min_importance": 0.5,
      "limit": 500
    },
    "truncated": false
  }
}
```

## Response: 400 Bad Request

```json
{
  "error": "잘못된 파라미터",
  "message": "min_importance는 0.0~1.0 사이여야 합니다"
}
```

## Response: 500 Internal Server Error

```json
{
  "error": "그래프 데이터 조회 실패",
  "message": "..."
}
```

## UI Route

```
GET /graph
```

`static/graph.html`을 반환하며, 이 파일이 `/admin/graph` API를 호출하여 그래프를 렌더링한다.

## Backward Compatibility

- 신규 엔드포인트이므로 기존 API에 영향 없음
- 향후 `/admin/graph`의 응답 포맷 변경 시 `meta.version` 필드 추가 예정
