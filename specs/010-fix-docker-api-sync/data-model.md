# Data Model: Docker HTTP API 엔드포인트 동기화

**Feature**: 010-fix-docker-api-sync  
**Date**: 2026-04-04

---

## 1. TelemetryPeriod (열거 타입)

**출처**: `@memento/core` → `packages/memento-core/src/domains/telemetry/types/telemetry.types.ts`

```typescript
type TelemetryPeriod = '24h' | '7d' | '30d';
```

- 텔레메트리 조회 기간
- `undefined` 입력 시 `effectiveTelemetryPeriod()`가 `'24h'` 기본값 적용
- 빈 문자열(`?period=`)이나 미지원 값은 HTTP 400 반환

---

## 2. EventType (열거 타입)

**출처**: `@memento/core` → `packages/memento-core/src/domains/telemetry/types/telemetry.types.ts`

```typescript
type EventType =
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
  | 'consolidation.performed'
  | 'telemetry.cleanup.performed';
```

- 총 12가지 이벤트 유형
- `GET /admin/telemetry/events`의 `event_type` 쿼리 파라미터 유효 값 집합

---

## 3. TelemetryEvent (읽기 전용 DB 레코드)

**DB 테이블**: `telemetry_events` (마이그레이션 027)

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | UUID |
| `event_type` | EventType | 이벤트 분류 |
| `timestamp` | string | ISO 8601 |
| `request_id` | string \| null | 요청 추적 ID |
| `owner_id` | string \| null | 소유자 ID |
| `outcome` | `'success' \| 'failure' \| 'empty'` \| null | 이벤트 결과 |
| `latency_ms` | number \| null | 처리 시간(ms) |
| `metadata` | object \| null | 추가 메타데이터 |

---

## 4. SearchQualityResult (응답 DTO)

**출처**: `packages/memento-core/src/domains/telemetry/repositories/telemetry-repository.ts`

```typescript
interface SearchQualityResult {
  period: TelemetryPeriod;
  search_count: number | null;
  avg_latency_ms: number | null;
  empty_result_rate: number | null;
  failure_rate: number | null;
  feedback_positive_count: number | null;
  feedback_negative_count: number | null;
}
```

---

## 5. MemoryQualityResult (응답 DTO)

```typescript
interface MemoryQualityResult {
  total_memories: number | null;
  episodic_count: number | null;
  semantic_count: number | null;
  working_count: number | null;
  procedural_count: number | null;
  consolidated_count: number | null;
  avg_importance: number | null;
}
```

---

## 6. SystemMetricsResult (응답 DTO)

```typescript
interface SystemMetricsResult {
  period: TelemetryPeriod;
  total_events: number | null;
  write_count: number | null;
  search_count: number | null;
  consolidation_count: number | null;
  cleanup_count: number | null;
}
```

---

## 7. GraphNode (로컬 인터페이스 — `@memento/core` 미포함)

**선언 위치**: 루트 `src/server/routes/admin.routes.ts` 파일 상단

```typescript
interface GraphNode {
  id: string;
  label: string;       // content 앞 50자 (그래프 노드 레이블)
  content: string;     // 전체 내용
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  importance: number;
  created_at: string;
  tags: string[];
  pinned: boolean;
}
```

---

## 8. GraphEdge (로컬 인터페이스)

```typescript
interface GraphEdge {
  id: string;          // `rel_${relation_id}` 형식
  source: string;      // source memory_item.id
  target: string;      // target memory_item.id
  relation_type: string;
  confidence: number;
  edge_source: 'memory_relation';
}
```

---

## 9. GraphFilter (로컬 인터페이스)

```typescript
interface GraphFilter {
  types?: string[] | null;          // 메모리 타입 필터
  relation_types?: string[] | null; // 관계 타입 필터
  min_importance?: number;          // 0.0~1.0
  limit?: number;                   // 1~1000, 기본 200
}
```

### 유효성 검사 규칙
- `types` 허용 값: `episodic`, `semantic`, `procedural`, `working`
- `min_importance` 범위: 0.0 ~ 1.0
- `limit` 범위: 1 ~ 1000

---

## 10. GraphResponse (응답 DTO)

```typescript
interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    total_nodes: number;
    total_edges: number;
    applied_filters: GraphFilter;
    truncated: boolean;   // 기본 limit(200) 초과 시 true
  };
}
```

---

## 11. ConsolidationRunRequest (요청 DTO)

```typescript
interface ConsolidationRunRequest {
  dryRun?: boolean;         // 기본 false — 실제 통합 실행
  ownerIdFilter?: string;   // 특정 소유자만 대상 (null/미지정 = 전체)
}
```

---

## 12. ConsolidationRunResponse (응답 DTO)

```typescript
interface ConsolidationRunResponse {
  success: true;
  result: SleepConsolidationRunResult; // @memento/core 타입
}

// 오류 응답
interface ConsolidationErrorResponse {
  success: false;
  error: string;
}
```

**HTTP 409** (이미 실행 중): `{ success: false, error: 'Consolidation already running' }`

---

## 13. DB 조회 패턴 (buildGraphResponse)

### 노드 쿼리
```sql
SELECT id, content, type, importance, created_at, tags, pinned 
FROM memory_item 
WHERE 1=1
  [AND type IN (?...)]
  AND COALESCE(importance, 0.5) >= ?
ORDER BY COALESCE(importance, 0.5) DESC 
LIMIT ?  -- limit + 1 (truncated 판단용)
```

### 엣지 쿼리 (json_each CTE)
```sql
WITH _nodes(id) AS (SELECT value FROM json_each(?))
SELECT mr.id, mr.source_id, mr.target_id, mr.relation_type, mr.confidence
FROM memory_relation mr
WHERE mr.source_id IN (SELECT id FROM _nodes)
  AND mr.target_id IN (SELECT id FROM _nodes)
  [AND mr.relation_type IN (?...)]
```

**SQLite 999 변수 한계 우회**: json_each를 통해 노드 ID 집합을 단일 JSON 파라미터로 전달.

---

## 상태 전이 (Consolidation)

```
대기 → 실행 중 (run() 호출)
  ↓ 성공/실패
완료 → 대기 (재실행 가능)

동시 실행 시도: ConsolidationAlreadyRunningError → HTTP 409
```
