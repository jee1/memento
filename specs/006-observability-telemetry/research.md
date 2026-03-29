# Research: Observability & Telemetry

**Branch**: `006-observability-telemetry` | **Date**: 2026-03-29

## 1. SQLite에서 p95 latency 실시간 계산

**Decision**: `SELECT` + 정렬 + LIMIT/OFFSET 방식으로 raw events에서 p95 직접 계산.

```sql
SELECT latency_ms
FROM telemetry_events
WHERE event_type = 'memory.search.requested'
  AND created_at >= datetime('now', '-24 hours')
  AND latency_ms IS NOT NULL
ORDER BY latency_ms ASC;
-- p95 = 인덱스 ceil(count * 0.95) 위치 값
```

**Rationale**: better-sqlite3의 동기 API로 결과 배열을 JS에서 직접 계산. 24시간 기준 이벤트 수가 수만 건 이하이면 `created_at` 인덱스로 충분히 SC-003(2초 이내) 만족.

**Alternatives considered**:
- SQLite percentile UDF: 커스텀 C extension 필요 → 신규 의존성 금지 원칙 위반
- T-Digest 근사: 구현 복잡도 불필요 (단일 인스턴스 SQLite에서 row 수 제한적)

---

## 2. Fire-and-forget 텔레메트리 쓰기 (FR-011)

**Decision**: `setImmediate()` 기반 비동기 처리. 이벤트 기록을 다음 이벤트 루프 tick으로 미룬다.

```typescript
// TelemetryService.record() 패턴
record(event: TelemetryEventInput): void {
  setImmediate(() => {
    try {
      this.insertEvent(event);
      this.upsertDailyMetric(event);
    } catch (err) {
      // 실패 시 무시 — primary path에 영향 없음
      this.logger.warn('telemetry write failed', { error: err });
    }
  });
}
```

**Rationale**: Node.js의 `setImmediate`는 현재 I/O 이벤트 처리 후 즉시 실행되므로 latency 증가 없이 주 경로에서 분리. better-sqlite3는 동기 API이므로 `Promise` 없이도 안전.

**Alternatives considered**:
- `Promise.resolve().then()` (microtask): I/O task보다 앞서 실행 → primary path latency에 미세한 영향 가능
- In-memory queue + flush: 구현 복잡도 대비 이점 없음 (이벤트 소량)
- `process.nextTick()`: microtask queue로 동일 문제

---

## 3. 일별 집계 UPSERT 패턴 (SQLite)

**Decision**: SQLite의 `INSERT OR REPLACE` 대신 `INSERT ... ON CONFLICT DO UPDATE` (upsert) 사용.

```sql
INSERT INTO telemetry_daily_metrics
  (id, date, event_type, owner_id, event_count, avg_latency_ms, error_count, updated_at)
VALUES
  (?, ?, ?, ?, 1, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(date, event_type, owner_id) DO UPDATE SET
  event_count = event_count + 1,
  avg_latency_ms = (avg_latency_ms * event_count + excluded.avg_latency_ms) / (event_count + 1),
  error_count = error_count + CASE WHEN excluded.error_count > 0 THEN 1 ELSE 0 END,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
```

**Rationale**: `ON CONFLICT DO UPDATE` (SQLite 3.24+)는 기존 행 삭제 없이 원자적 업데이트. better-sqlite3의 SQLite 버전은 3.45+이므로 지원 보장. avg_latency_ms는 Welford's running average로 정확 계산.

**Alternatives considered**:
- SELECT then UPDATE: 두 번의 쿼리, 동시성 문제 가능
- `INSERT OR REPLACE`: PK가 바뀌어 event_count 리셋됨

---

## 4. Content 해시 계산 (중복 write 감지)

**Decision**: Node.js 내장 `crypto.createHash('sha256')` → hex 앞 16자.

```typescript
import { createHash } from 'crypto';
const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
```

**Rationale**: 외부 의존성 없음. 16자(64비트) 해시는 충돌 확률 negligible (수백만 건 미만). `extra_data` JSON에 `content_hash` 필드로 기록.

---

## 5. request_id 전파 방법

**Decision**: 각 MCP 도구 핸들러 진입부에서 `crypto.randomUUID()` 생성 후 `AsyncLocalStorage`로 하위 서비스에 전파.

```typescript
// 서비스 레이어에 AsyncLocalStorage context 주입
const requestContext = new AsyncLocalStorage<{ requestId: string; ownerId: string | null }>();

// MCP 도구 핸들러 래퍼
function withTelemetryContext<T>(ownerId: string | null, fn: () => T): T {
  return requestContext.run({ requestId: randomUUID(), ownerId }, fn);
}
```

**Rationale**: `AsyncLocalStorage`는 Node.js 16+ 안정 API. 기존 서비스 시그니처 변경 없이 context 전파 가능 (비침투적 계측).

**Alternatives considered**:
- 모든 서비스 메서드에 `requestId` 파라미터 추가: 대규모 시그니처 변경 필요
- 글로벌 변수: 동시 요청 간 오염

---

## 6. 기존 마이그레이션 번호 확인

현재 최신 마이그레이션: `026-flip-consolidation-relation-directions.ts` (26.0)

신규 마이그레이션:
- `027-telemetry-events.ts` (27.0) — `telemetry_events` 테이블
- `028-telemetry-daily-metrics.ts` (28.0) — `telemetry_daily_metrics` 테이블

---

## 7. 기존 Admin API 보안

**Decision**: 기존 패턴 그대로 따름. 현재 admin endpoints는 HTTP bind host(`MEMENTO_HTTP_BIND_HOST=127.0.0.1`) 레벨에서 loopback-only로 접근 제한. 별도 인증 레이어 없음 (기존 운영 방식).

**Rationale**: 스펙 범위 밖(Security 항목 Deferred). 기존 admin API 패턴과 일관성 유지.
