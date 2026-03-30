# MCP Tool Contract: get_telemetry_summary

## Overview

| 항목 | 값 |
|------|----|
| Tool name | `get_telemetry_summary` |
| 추가 위치 | `packages/memento-core/src/domains/telemetry/tools/get-telemetry-summary-tool.ts` |
| 등록 위치 | `packages/memento-core/src/tools/index.ts` (`coreTools` 배열) |
| Backward compat | 기존 16개 도구 인터페이스 변경 없음 |

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "period": {
      "type": "string",
      "enum": ["24h", "7d", "30d"],
      "description": "조회 기간 (기본값: 24h)"
    }
  },
  "required": []
}
```

## Output (success)

```json
{
  "period": "24h",
  "owner_id": "agent-123",
  "search_quality": {
    "search_count": 42,
    "avg_latency_ms": 123.4,
    "p95_latency_ms": 456.7,
    "empty_retrieval_rate": 0.125,
    "avg_candidate_count": 8.3,
    "top_k_selected_rate": 0.87
  },
  "memory_quality": {
    "total_memories": 523,
    "type_distribution": { "episodic": 210, "semantic": 180, "procedural": 133 },
    "duplicate_write_rate_24h": 0.021,
    "relation_coverage_ratio": 0.782,
    "orphan_memory_ratio": 0.053
  },
  "timestamp": "2026-03-29T10:00:00.000Z"
}
```

## Output (no data)

```json
{
  "period": "24h",
  "owner_id": "agent-123",
  "search_quality": {
    "search_count": null,
    "avg_latency_ms": null,
    "p95_latency_ms": null,
    "empty_retrieval_rate": null,
    "avg_candidate_count": null,
    "top_k_selected_rate": null
  },
  "memory_quality": {
    "total_memories": null,
    "type_distribution": null,
    "duplicate_write_rate_24h": null,
    "relation_coverage_ratio": null,
    "orphan_memory_ratio": null
  },
  "timestamp": "2026-03-29T10:00:00.000Z"
}
```

## Error Response

잘못된 `period` 값:
```json
{
  "error": "Invalid period. Allowed: 24h, 7d, 30d"
}
```

## Notes

- `owner_id`는 도구 호출 시 ALS context에서 자동 추출된다 (에이전트가 명시적으로 전달하지 않아도 됨).
- `memory_quality`는 period 파라미터를 무시하고 전체 DB 기준으로 집계한다.
- DB 오류 발생 시 에이전트 세션을 중단시키지 않는다 — `createErrorResult()`로 에러 응답 반환.
