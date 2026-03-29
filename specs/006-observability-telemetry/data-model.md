# Data Model: Observability & Telemetry

**Branch**: `006-observability-telemetry` | **Date**: 2026-03-29

## 신규 테이블

### `telemetry_events`

단일 이벤트 기록. MCP 도구 호출 1회에서 발생하는 이벤트들이 동일 `request_id`를 공유.

```sql
CREATE TABLE IF NOT EXISTS telemetry_events (
  id          TEXT PRIMARY KEY,  -- UUID (crypto.randomUUID())
  event_type  TEXT NOT NULL,     -- EventType enum (아래 참조)
  request_id  TEXT NOT NULL,     -- MCP 도구 호출 단위 UUID (서버 자동 생성)
  owner_id    TEXT,              -- nullable (owner 없는 경우 허용)
  latency_ms  INTEGER,           -- nullable (async 이벤트는 null 가능)
  outcome     TEXT NOT NULL,     -- 'success' | 'failure' | 'empty'
  error_code  TEXT,              -- nullable
  extra_data  TEXT,              -- JSON blob (이벤트별 추가 필드)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_te_event_type  ON telemetry_events(event_type);
CREATE INDEX IF NOT EXISTS idx_te_request_id  ON telemetry_events(request_id);
CREATE INDEX IF NOT EXISTS idx_te_owner_id    ON telemetry_events(owner_id);
CREATE INDEX IF NOT EXISTS idx_te_created_at  ON telemetry_events(created_at);
CREATE INDEX IF NOT EXISTS idx_te_outcome_err ON telemetry_events(outcome)
  WHERE outcome != 'success';
```

**extra_data JSON 스키마 (이벤트 유형별)**:

| event_type | extra_data 필드 |
|------------|----------------|
| `memory.search.requested` | `{ query_hash, retrieval_strategy, embedding_provider, ranking_version }` |
| `memory.search.candidates_retrieved` | `{ candidate_count }` |
| `memory.search.reranked` | `{ candidate_count }` |
| `memory.search.selected` | `{ query_hash, retrieval_strategy, selected_count }` |
| `memory.search.empty` | `{ query_hash, retrieval_strategy }` |
| `memory.search.failed` | `{ query_hash, retrieval_strategy, message }` |
| `memory.write.requested` | `{ memory_type, content_hash }` |
| `memory.write.completed` | `{ memory_type, memory_id, content_hash, is_duplicate }` |
| `memory.feedback.positive` | `{ memory_id }` |
| `memory.feedback.negative` | `{ memory_id }` |
| `consolidation.performed` | `{ clusters_found, clusters_processed, semantics_created, duration_ms }` |
| `telemetry.cleanup.performed` | `{ deleted, retention_days?, error_count }` — telemetry retention 배치 1회 완료 |

---

### `telemetry_daily_metrics`

일별 집계 스냅샷. `event_type + date + owner_id` 단위로 UPSERT 갱신.

```sql
CREATE TABLE IF NOT EXISTS telemetry_daily_metrics (
  id              TEXT PRIMARY KEY,  -- UUID
  date            TEXT NOT NULL,     -- 'YYYY-MM-DD' (UTC)
  event_type      TEXT NOT NULL,
  owner_id        TEXT NOT NULL DEFAULT '',  -- 빈 문자열 = 글로벌 버킷 (SQLite NULL은 UNIQUE에서 서로 다른 값으로 처리되어 UPSERT가 깨지므로 NOT NULL DEFAULT '')
  event_count     INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms  REAL,              -- nullable (latency 없는 이벤트 유형)
  error_count     INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(date, event_type, owner_id)  -- UPSERT 충돌 키
);

CREATE INDEX IF NOT EXISTS idx_tdm_date       ON telemetry_daily_metrics(date);
CREATE INDEX IF NOT EXISTS idx_tdm_event_type ON telemetry_daily_metrics(event_type);
CREATE INDEX IF NOT EXISTS idx_tdm_owner_id   ON telemetry_daily_metrics(owner_id);
```

**UPSERT 쿼리 (이벤트 기록 시 매번 실행)**:
```sql
INSERT INTO telemetry_daily_metrics
  (id, date, event_type, owner_id, event_count, avg_latency_ms, error_count, updated_at)
VALUES (?, ?, ?, ?, 1, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(date, event_type, owner_id) DO UPDATE SET
  event_count    = event_count + 1,
  avg_latency_ms = CASE
    WHEN excluded.avg_latency_ms IS NULL THEN avg_latency_ms
    WHEN avg_latency_ms IS NULL          THEN excluded.avg_latency_ms
    ELSE (avg_latency_ms * event_count + excluded.avg_latency_ms) / (event_count + 1)
  END,
  error_count    = error_count + CASE WHEN excluded.error_count > 0 THEN 1 ELSE 0 END,
  updated_at     = strftime('%Y-%m-%dT%H:%M:%fZ','now');
```

---

## 마이그레이션 계획

| 번호 | 파일명 | 내용 |
|------|--------|------|
| 27.0 | `027-telemetry-events.ts` | `telemetry_events` 테이블 + 인덱스 생성 |
| 28.0 | `028-telemetry-daily-metrics.ts` | `telemetry_daily_metrics` 테이블 + 인덱스 생성 |
| 29.0 | `029-telemetry-events-event-type-created-at-index.ts` | `telemetry_events(event_type, created_at)` 복합 인덱스 |

마이그레이션은 `schema.sql`과 동기화 필요.

---

## TypeScript 타입 정의

**위치**: `packages/memento-core/src/domains/telemetry/types/telemetry.types.ts`

```typescript
export type EventType =
  | 'memory.search.requested'
  | 'memory.search.candidates_retrieved'
  | 'memory.search.reranked'
  | 'memory.search.selected'
  | 'memory.search.empty'
  | 'memory.search.failed'
  | 'memory.write.requested'
  | 'memory.write.completed'
  | 'memory.feedback.positive'
  | 'memory.feedback.negative'
  | 'consolidation.performed';

export type Outcome = 'success' | 'failure' | 'empty';

export interface TelemetryEventInput {
  eventType: EventType;
  requestId: string;
  ownerId: string | null;
  latencyMs?: number;
  outcome: Outcome;
  errorCode?: string;
  extraData?: Record<string, unknown>;
}

export interface TelemetryEventRow {
  id: string;
  event_type: EventType;
  request_id: string;
  owner_id: string | null;
  latency_ms: number | null;
  outcome: Outcome;
  error_code: string | null;
  extra_data: string | null;  // JSON
  created_at: string;
}

export interface DailyMetricRow {
  id: string;
  date: string;
  event_type: EventType;
  owner_id: string;  // NOT NULL DEFAULT '' — 빈 문자열이 글로벌 버킷을 의미함
  event_count: number;
  avg_latency_ms: number | null;
  error_count: number;
  updated_at: string;
}
```
