# Admin API: `GET /admin/stats/consolidation`

**FR-010** — 운영자용 공고화·구조화 파이프라인 요약.

## Request

- Query: `owner_id` (optional string) — 텔레메트리·`memory_item` 집계에 동일 스코프 적용. 생략 시 전역(null owner 포함).

## Response JSON (200)

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | 사람이 읽을 수 있는 요약 |
| `consolidation_quality` | object | `TelemetryRepository.queryConsolidationQuality`와 동일 키 (7일 롤링) |
| `consolidation_quality.episodic_consolidation_rate` | number \\| null | 에피소딕 중 `is_consolidated=1` 비율 |
| `consolidation_quality.triple_extraction_success_rate` | number \\| null | `triple_extracted_status='success'` / `triple_extracted=1` (에피소딕) |
| `consolidation_quality.cluster_processing_efficiency` | number \\| null | 최근 `consolidation.performed` 성공 이벤트의 `clusters_processed/clusters_found` 평균 |
| `consolidation_quality.recent_semantic_count_7d` | number | 최근 7일 생성된 `type=semantic` 행 수 |
| `consolidation_quality.pipeline_error_count` | number | 최근 7일 `telemetry_events` 실패(`outcome=failure`, `event_type IN ('consolidation.performed','telemetry.cleanup.performed')`) + 동일 기간 `memory_item` 에피소딕 트리플 추출 실패(`triple_extracted_status='failed'`, `last_attempt` 또는 `created_at` 기준) |
| `consolidation_quality.timestamp` | string | ISO8601 |
| `pipeline_error_summary` | object | `{ count: number }` — `consolidation_quality.pipeline_error_count`와 정합 |
| `timestamp` | string | 응답 생성 시각 |

## Errors

- `500` — DB 미연결
- `503` — `TelemetryService` 미초기화
