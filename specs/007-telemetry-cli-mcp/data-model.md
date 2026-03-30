# Data Model: Telemetry CLI & MCP Tool Access (007)

## 신규 DB 스키마 없음

이 기능은 006에서 추가된 `telemetry_events`, `telemetry_daily_metrics` 테이블을 **읽기 전용**으로 사용한다.
새 마이그레이션 파일은 필요하지 않다.

---

## MCP 도구 입출력 계약

### `get_telemetry_summary` — 입력

```typescript
interface GetTelemetrySummaryInput {
  period?: '24h' | '7d' | '30d';  // 기본값: '24h'
}
```

### `get_telemetry_summary` — 출력

`SearchQualityResult`와 `MemoryQualityResult`를 합산한 구조 (기존 타입 재사용).

```typescript
interface GetTelemetrySummaryResult {
  period: '24h' | '7d' | '30d';
  owner_id: string | null;           // ALS context에서 추출; null = 글로벌
  search_quality: {
    search_count: number | null;
    avg_latency_ms: number | null;
    p95_latency_ms: number | null;
    empty_retrieval_rate: number | null;   // 0~1 비율
    avg_candidate_count: number | null;
    top_k_selected_rate: number | null;
  };
  memory_quality: {
    total_memories: number | null;
    type_distribution: Record<string, number> | null;
    duplicate_write_rate_24h: number | null;
    relation_coverage_ratio: number | null;
    orphan_memory_ratio: number | null;
  };
  timestamp: string;  // ISO 8601
}
```

**Notes**:
- `search_quality` 필드는 `SearchQualityResult`에서 `period`, `owner_id`, `timestamp`를 제외한 나머지.
- `memory_quality` 필드는 `MemoryQualityResult`에서 `owner_id`, `timestamp`를 제외한 나머지.
- `memory_quality`는 period를 무시한다 (006 spec과 동일).
- 데이터가 없는 필드는 `null`이다.

---

## CLI 옵션 스키마

```
npm run telemetry [-- [options]]

Options:
  --period  <24h|7d|30d>                   조회 기간 (기본: 24h)
  --type    <search-quality|memory-quality|system|all>  지표 유형 (기본: all)
  --help, -h                               도움말 출력
```

**Exit codes**:
| Code | 의미 |
|------|------|
| 0    | 정상 (데이터 없음 포함) |
| 1    | DB 오류, 마이그레이션 미실행, 잘못된 옵션 |
