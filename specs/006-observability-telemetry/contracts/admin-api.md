# Admin API Contract: Telemetry Endpoints

**Base path**: `/admin/telemetry`
**Auth**: loopback-only (127.0.0.1, 기존 admin 패턴과 동일; normative 요약은 `spec.md` **FR-015**)

---

## GET /admin/telemetry/search-quality

검색 품질 집계 지표 조회. p95는 raw events 실시간 계산.

**Query Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | string | `24h` | `24h` \| `7d` \| `30d` |
| `owner_id` | string | (없음) | 필터링할 owner_id |

**Validation**: `period`는 정확히 `24h`, `7d`, `30d` 중 하나여야 한다. 미지원 값·파싱 불가·빈 문자열이면 **400** (본문에 허용 값 안내; normative: `spec.md` **FR-013**).

**Response 200**:
```json
{
  "period": "24h",
  "owner_id": null,
  "search_count": 142,
  "avg_latency_ms": 87.3,
  "p95_latency_ms": 210,
  "empty_retrieval_rate": 0.04,
  "avg_candidate_count": 12.5,
  "top_k_selected_rate": 0.78,
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

**Notes**:
- `empty_retrieval_rate`: `memory.search.empty` 이벤트 수 / `memory.search.requested` 이벤트 수
- `top_k_selected_rate`: `memory.search.selected` 이벤트 수 / `memory.search.candidates_retrieved` 이벤트 수
- `period=7d` 이상은 `telemetry_daily_metrics`에서 avg를 집계, p95는 최근 24h raw events만 제공
- 데이터 없으면 null 필드 포함 200 반환

---

## GET /admin/telemetry/memory-quality

메모리 품질 지표 조회. `memory_item` 테이블 현재 상태 기반 계산.

**Query Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `owner_id` | string | (없음) | 필터링할 owner_id |

**Note**: `period`는 적용하지 않는다. 스냅샷 지표이며 FR-013의 시간 구간 파라미터는 `search-quality`·`system`에만 적용된다. 요청에 `period`가 포함되어도 **무시**하고 200으로 응답한다(400 아님).

**Response 200**:
```json
{
  "owner_id": null,
  "total_memories": 856,
  "type_distribution": {
    "episodic": 0.61,
    "semantic": 0.28,
    "procedural": 0.08,
    "working": 0.03
  },
  "duplicate_write_rate_24h": 0.03,
  "relation_coverage_ratio": 0.72,
  "orphan_memory_ratio": 0.28,
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

**Notes**:
- `relation_coverage_ratio`: `memory_item` 중 `memory_relation`에 1개 이상 관계가 있는 비율
- `orphan_memory_ratio`: 1 - relation_coverage_ratio
- `duplicate_write_rate_24h`: 최근 24시간 `memory.write.completed` 이벤트 중 `is_duplicate=true` 비율

---

## GET /admin/telemetry/system

시스템 성능 지표 조회. MCP 도구별 latency 및 성공률.

**Query Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | string | `24h` | `24h` \| `7d` \| `30d` |
| `owner_id` | string | (없음) | 필터링할 owner_id |

**Validation**: `period`는 정확히 `24h`, `7d`, `30d` 중 하나여야 한다. 미지원 값·파싱 불가·빈 문자열이면 **400** (본문에 허용 값 안내; normative: `spec.md` **FR-013**).

**Response 200**:
```json
{
  "period": "24h",
  "tools": {
    "recall": {
      "request_count": 142,
      "success_count": 139,
      "error_count": 3,
      "error_rate": 0.021,
      "avg_latency_ms": 87.3,
      "p95_latency_ms": 210
    },
    "remember": {
      "request_count": 56,
      "success_count": 56,
      "error_count": 0,
      "error_rate": 0.0,
      "avg_latency_ms": 43.1,
      "p95_latency_ms": 98
    },
    "feedback": {
      "request_count": 24,
      "success_count": 24,
      "error_count": 0,
      "error_rate": 0.0,
      "avg_latency_ms": 12.0,
      "p95_latency_ms": 28
    }
  },
  "background_jobs": {
    "sleep_consolidation": {
      "last_run_at": "2026-03-29T03:00:00.000Z",
      "last_outcome": "success",
      "total_runs_24h": 1,
      "success_runs_24h": 1,
      "failure_runs_24h": 0,
      "avg_duration_ms": 1250.5,
      "last_duration_ms": 1250
    },
    "telemetry_cleanup": {
      "last_run_at": "2026-03-29T03:05:00.000Z",
      "last_outcome": "success",
      "total_runs_24h": 1,
      "success_runs_24h": 1,
      "failure_runs_24h": 0,
      "avg_duration_ms": 42.0,
      "last_duration_ms": 42
    }
  },
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

**Notes (`background_jobs`)**:
- `total_runs_24h`: 최근 24시간(UTC 롤링 윈도우)에 완료된 실행 횟수.
- `success_runs_24h` / `failure_runs_24h` / `avg_duration_ms`(24h): **`telemetry_events`에서 `consolidation.performed`·`telemetry.cleanup.performed` 이벤트를 집계**한다(요청의 `period`와 무관하게 항상 롤링 24h). 해당 이벤트가 없으면 0·`avg_duration_ms`는 null.
- `last_run_at` / `last_outcome` / `last_duration_ms`: **BatchScheduler** 직전 완료 실행 시각·결과·지속시간(ms); 스케줄러 미기동 시 null.

---

## GET /admin/telemetry/events

원시 이벤트 쿼리. 디버깅 및 고급 분석용.

**Query Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `event_type` | string | (없음) | EventType 필터 |
| `request_id` | string | (없음) | 특정 요청 추적 |
| `owner_id` | string | (없음) | owner 필터 |
| `from` | ISO8601 | (없음) | 시작 시간 |
| `to` | ISO8601 | (없음) | 종료 시간 |
| `outcome` | string | (없음) | `success` \| `failure` \| `empty` |
| `limit` | integer | 50 | 최대 100 |
| `offset` | integer | 0 | 페이지네이션 |

**Validation**: `from`·`to`는 생략 가능. 전달 시 **유효한 ISO8601 instant**로 파싱되어야 하며, 파싱 불가면 **400**. 둘 다 유효할 때 **`from` ≤ `to`**; `from` > `to`면 **400**. 오류 본문은 `from`/`to` 및 원인(파싱 vs 역전)을 구분 가능하게(norms: `spec.md` **FR-010**).

**`event_type` 값**: `spec.md` **FR-001**·**Key Entities**의 `EventType`과 동일. 검색 실행 중 예외 시 터미널 이벤트로 `memory.search.failed`가 기록될 수 있다(`outcome`: `failure`, `extra_data`는 `data-model.md` 참조).

**Response 200**:
```json
{
  "events": [
    {
      "id": "abc123",
      "event_type": "memory.search.empty",
      "request_id": "req-uuid",
      "owner_id": "user-1",
      "latency_ms": 45,
      "outcome": "empty",
      "error_code": null,
      "extra_data": { "query_hash": "a1b2c3d4e5f6" },
      "created_at": "2026-03-29T10:30:00.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0,
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

---

## Error Responses

공통 및 엔드포인트별:

| Status | Body | 발생 조건 |
|--------|------|---------|
| 500 | `{ "error": "DB unavailable" }` | DB 연결 없음 |
| 500 | `{ "error": "...", "message": "..." }` | 내부 오류 |
| 400 | `{ "error": "Invalid period", "allowed": ["24h","7d","30d"] }` (필드명은 구현 일관성 유지) | `GET .../search-quality`, `GET .../system`에서 `period`가 허용 집합 밖이거나 빈 값·파싱 불가 |
| 400 | 예: `{ "error": "Invalid time range", "field": "from", "reason": "parse" }` (`field`·`reason` 값은 구현 일관 유지) | `GET .../events`에서 `from`/`to` 파싱 불가 또는 시작이 종료보다 늦음 |
| 400 | `{ "error": "..." }` | 기타 검증 실패(예: `events`의 `limit` 초과 등) |
