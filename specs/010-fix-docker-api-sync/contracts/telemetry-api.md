# Contract: Telemetry API 엔드포인트

**Feature**: 010-fix-docker-api-sync  
**Endpoints**: 4개 (`/admin/telemetry/*`)

---

## GET /admin/telemetry/search-quality

### 요청

| 항목 | 값 |
|------|-----|
| Method | GET |
| Path | `/admin/telemetry/search-quality` |
| Auth | 없음 (Admin API) |

**Query Parameters**:
| 파라미터 | 타입 | 필수 | 기본값 | 유효 값 | 설명 |
|----------|------|------|--------|---------|------|
| `period` | string | 아니오 | `'24h'` | `24h`, `7d`, `30d` | 조회 기간 |
| `owner_id` | string | 아니오 | (전체) | 임의 문자열 | 소유자 필터 |

**주의**: `?period=` (빈 문자열) → HTTP 400 (기본값 적용 안 됨)

### 응답

#### 200 OK
```json
{
  "period": "24h",
  "search_count": 42,
  "avg_latency_ms": 123.4,
  "empty_result_rate": 0.05,
  "failure_rate": 0.01,
  "feedback_positive_count": 10,
  "feedback_negative_count": 2
}
```
*모든 숫자 필드는 데이터 없을 경우 `null` 반환 가능*

#### 400 Bad Request
```json
{ "error": "Invalid period", "allowed": ["24h", "7d", "30d"] }
```

#### 500 Internal Server Error
```json
{ "error": "DB unavailable" }
```

---

## GET /admin/telemetry/memory-quality

### 요청

| 항목 | 값 |
|------|-----|
| Method | GET |
| Path | `/admin/telemetry/memory-quality` |

**Query Parameters**:
| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `owner_id` | string | 아니오 | (전체) | 소유자 필터 |

### 응답

#### 200 OK
```json
{
  "total_memories": 200,
  "episodic_count": 80,
  "semantic_count": 70,
  "working_count": 30,
  "procedural_count": 20,
  "consolidated_count": 50,
  "avg_importance": 0.65
}
```

#### 500 Internal Server Error
```json
{ "error": "DB unavailable" }
```

---

## GET /admin/telemetry/system

### 요청

| 항목 | 값 |
|------|-----|
| Method | GET |
| Path | `/admin/telemetry/system` |

**Query Parameters**:
| 파라미터 | 타입 | 필수 | 기본값 | 유효 값 | 설명 |
|----------|------|------|--------|---------|------|
| `period` | string | 아니오 | `'24h'` | `24h`, `7d`, `30d` | 조회 기간 |
| `owner_id` | string | 아니오 | (전체) | 임의 문자열 | 소유자 필터 |

### 응답

#### 200 OK
```json
{
  "period": "7d",
  "total_events": 500,
  "write_count": 150,
  "search_count": 300,
  "consolidation_count": 10,
  "cleanup_count": 5
}
```

#### 400 Bad Request
```json
{ "error": "Invalid period", "allowed": ["24h", "7d", "30d"] }
```

---

## GET /admin/telemetry/events

### 요청

| 항목 | 값 |
|------|-----|
| Method | GET |
| Path | `/admin/telemetry/events` |

**Query Parameters**:
| 파라미터 | 타입 | 필수 | 기본값 | 범위/유효 값 | 설명 |
|----------|------|------|--------|-------------|------|
| `limit` | integer | 아니오 | `50` | 1~100 | 페이지 크기 |
| `offset` | integer | 아니오 | `0` | ≥ 0 | 오프셋 |
| `from` | string | 아니오 | — | ISO 날짜 | 시작 시간 |
| `to` | string | 아니오 | — | ISO 날짜 | 종료 시간 |
| `outcome` | string | 아니오 | — | `success`, `failure`, `empty` | 결과 필터 |
| `event_type` | string | 아니오 | — | EventType 12가지 | 이벤트 유형 |
| `owner_id` | string | 아니오 | — | 임의 문자열 | 소유자 필터 |
| `request_id` | string | 아니오 | — | 임의 문자열 | 요청 ID 필터 |

**유효성 검사**:
- `limit > 100` → HTTP 400
- `from` 파싱 불가 → HTTP 400
- `to` 파싱 불가 → HTTP 400
- `from > to` → HTTP 400
- `offset < 0` → HTTP 400
- `outcome`이 유효하지 않은 값 → HTTP 400

### 응답

#### 200 OK
```json
{
  "events": [
    {
      "id": "uuid-...",
      "event_type": "memory.search.requested",
      "timestamp": "2026-04-04T10:00:00Z",
      "request_id": "req-123",
      "owner_id": null,
      "outcome": "success",
      "latency_ms": 45,
      "metadata": {}
    }
  ],
  "total": 1
}
```

#### 400 Bad Request
```json
{ "error": "Invalid limit", "message": "limit must be 1–100" }
{ "error": "Invalid time range", "field": "from", "reason": "parse" }
{ "error": "Invalid time range", "field": "from", "reason": "range" }
{ "error": "Invalid outcome" }
{ "error": "Invalid offset" }
```

#### 500 Internal Server Error
```json
{ "error": "DB unavailable" }
```
