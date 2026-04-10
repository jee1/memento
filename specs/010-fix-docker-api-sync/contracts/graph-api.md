# Contract: Graph API 엔드포인트

**Feature**: 010-fix-docker-api-sync  
**Endpoint**: `GET /admin/graph`

---

## GET /admin/graph

기억 항목(MemoryItem) 간 관계를 노드-엣지 그래프 형태로 반환한다.

### 요청

| 항목 | 값 |
|------|-----|
| Method | GET |
| Path | `/admin/graph` |
| Auth | 없음 (Admin API) |

**Query Parameters**:
| 파라미터 | 타입 | 필수 | 기본값 | 범위/유효 값 | 설명 |
|----------|------|------|--------|-------------|------|
| `types` | string | 아니오 | (전체) | 쉼표 구분 — `episodic`, `semantic`, `procedural`, `working` | 메모리 타입 필터 |
| `relation_types` | string | 아니오 | (전체) | 쉼표 구분 문자열 | 관계 타입 필터 |
| `min_importance` | float | 아니오 | `0.0` | 0.0 ~ 1.0 | 최소 중요도 |
| `limit` | integer | 아니오 | `200` | 1 ~ 1000 | 최대 노드 수 |

**유효성 검사**:
- `types`에 허용 외 값 포함 → HTTP 400
- `min_importance` 파싱 불가 또는 범위 초과 → HTTP 400
- `limit` 파싱 불가 또는 범위 초과 → HTTP 400

### 응답

#### 200 OK
```json
{
  "nodes": [
    {
      "id": "mem-uuid-001",
      "label": "TypeScript 에러 처리 패턴...",
      "content": "TypeScript 에러 처리 패턴에서는 Error 인스턴스 체크를 사용한다.",
      "type": "semantic",
      "importance": 0.8,
      "created_at": "2026-03-01T09:00:00Z",
      "tags": ["typescript", "error-handling"],
      "pinned": false
    }
  ],
  "edges": [
    {
      "id": "rel_42",
      "source": "mem-uuid-001",
      "target": "mem-uuid-002",
      "relation_type": "REFERENCES",
      "confidence": 0.9,
      "edge_source": "memory_relation"
    }
  ],
  "meta": {
    "total_nodes": 1,
    "total_edges": 1,
    "applied_filters": {
      "types": ["semantic"],
      "relation_types": null,
      "min_importance": 0.0,
      "limit": 200
    },
    "truncated": false
  }
}
```

**`meta.truncated: true`** — 조회된 노드 수가 `limit`을 초과했을 때.

#### 400 Bad Request
```json
{
  "error": "잘못된 파라미터",
  "message": "허용되지 않는 types 값: invalid_type. 허용 값: episodic, semantic, procedural, working"
}
```
```json
{
  "error": "잘못된 파라미터",
  "message": "min_importance는 0.0~1.0 사이여야 합니다"
}
```
```json
{
  "error": "잘못된 파라미터",
  "message": "limit은 1~1000 사이여야 합니다"
}
```

#### 500 Internal Server Error
```json
{ "error": "데이터베이스가 연결되지 않았습니다" }
```

---

## 구현 메모

- **엣지**: 노드 집합(Set) 내에 있는 메모리 간 관계만 반환 (외부 참조 제외)
- **SQLite 변수 한계**: json_each CTE 사용으로 999 변수 제한 우회
- **노드 레이블**: `content` 앞 50자 (초과 시 `...` 추가)
- **tags**: DB에 JSON 문자열로 저장 → 파싱 실패 시 빈 배열 반환
- **importance**: DB에 null 저장 가능 → 기본값 `0.5`로 처리
- **confidence**: DB에 null 저장 가능 → 기본값 `1.0`으로 처리
