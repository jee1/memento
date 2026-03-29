# Data Model: Sleep Consolidation

**Phase**: 1 | **Branch**: `005-sleep-consolidation` | **Date**: 2026-03-28

## Schema Changes

### 1. `memory_item` 테이블 — 컬럼 추가

**Migration**: TypeScript `025-memory-item-is-consolidated.ts` (스키마 버전 25.0, 멱등). 신규 인스턴스는 `schema.sql`에 동일 정의 포함.

```sql
-- 신규 컬럼: sleep consolidation 처리 여부
ALTER TABLE memory_item ADD COLUMN is_consolidated BOOLEAN DEFAULT FALSE;

-- 인덱스: 클러스터링 대상 필터링 효율화
CREATE INDEX IF NOT EXISTS idx_memory_item_is_consolidated
  ON memory_item(type, is_consolidated)
  WHERE type = 'episodic';
```

**필드 설명**:

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `is_consolidated` | BOOLEAN | FALSE | sleep consolidation으로 통합된 에피소딕 마킹. TRUE이면 클러스터링 대상 제외 |

**상태 전환**:
```
episodic 저장 시: is_consolidated = FALSE
consolidation 완료 시: is_consolidated = TRUE, importance ← 0.1 이하
  ※ 반드시 시맨틱 저장 성공 후에 업데이트 (FR-003 순서 보장)
```

---

### 2. 기존 테이블 재사용 — `memory_relation`

신규 테이블 없음. 기존 `extracted_from` / `supported_by` relation type 활용:

```
semantic (통합 결과)
  └─[extracted_from]→ episodic A
  └─[extracted_from]→ episodic B
  └─[extracted_from]→ episodic C

episodic A
  └─[supported_by]→ semantic (통합 결과)
```

---

### 3. Consolidated Semantic Memory — `origin_source` 보강

기존 `origin_source` JSON 필드에 sleep consolidation 메타데이터 추가:

```json
{
  "tool": "sleep-consolidation",
  "caller": "system",
  "timestamp": "2026-03-28T03:00:00Z",
  "context": {
    "source_episodic_ids": ["ep-001", "ep-002", "ep-003"],
    "cluster_size": 3,
    "similarity_threshold": 0.75,
    "summarization_method": "llm" // or "extractive"
  }
}
```

이 필드는 `memory_relation`의 보조 조회용. 원본은 `memory_relation` 테이블.

---

## Entity Definitions

### ConsolidationCluster (런타임 전용, DB 저장 없음)

```typescript
interface ConsolidationCluster {
  ownerId: string | null;           // memory_item.owner_id (agent 범위)
  episodicIds: string[];            // 클러스터 구성 에피소딕 ID 목록
  representativeId: string;         // 가장 importance 높은 에피소딕 ID
  averageSimilarity: number;        // 클러스터 내 평균 코사인 유사도
}
```

### SleepConsolidationRunResult (로그용, DB 저장 없음)

```typescript
interface SleepConsolidationRunResult {
  runAt: string;                    // ISO timestamp
  durationMs: number;               // 총 실행 시간
  clustersFound: number;            // 발견된 클러스터 수
  clustersProcessed: number;        // 성공 처리된 클러스터 수
  clustersSkipped: number;          // 건너뛴 클러스터 수 (최소 임계값 미달, 오류)
  semanticsCreated: number;         // 생성된 시맨틱 기억 수
  episodicsConsolidated: number;    // is_consolidated=TRUE로 변경된 에피소딕 수
  errors: Array<{ clusterId: string; error: string }>;
}
```

---

## Migration: `025-memory-item-is-consolidated.ts`

위치: `packages/memento-core/src/infrastructure/database/database/migration/migrations/025-memory-item-is-consolidated.ts`

- 컬럼이 없을 때만 `ALTER TABLE`, 인덱스는 `CREATE INDEX IF NOT EXISTS`.
- 러너에 등록된 TS 마이그레이션만 적용한다 (`database/migrations/*.sql` 별도 트리는 피드백 루프용 등 다른 용도).

---

## TypeScript Type Changes

**영향받는 파일** (추가/수정 필요):
- `packages/memento-core/src/shared/types/memory.types.ts` — `MemoryItem` 인터페이스에 `isConsolidated: boolean` 추가
- `packages/memento-core/src/infrastructure/database/repositories/` — 관련 repository에 필드 반영
