# Data Model: Recall Quality Feedback Loop

**Date**: 2026-03-26
**Branch**: `004-recall-quality-feedback-loop`

---

## 1. DB 스키마 변경

### 1.1 feedback_event (기존 테이블 확장)

**마이그레이션**: `005_feedback_attribution.sql`

```sql
-- 기존 컬럼 (변경 없음)
-- id, memory_id, event, score, created_at

-- 추가 컬럼
ALTER TABLE feedback_event ADD COLUMN session_id TEXT;   -- MCP 세션 ID
ALTER TABLE feedback_event ADD COLUMN agent_id TEXT;     -- 에이전트 식별자

-- 추가 인덱스
CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback_event(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_event(agent_id);
```

**전체 스키마 (변경 후)**:

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | INTEGER | PK, AUTOINCREMENT | |
| memory_id | TEXT | NOT NULL, FK→memory_item | 피드백 대상 기억 |
| event | TEXT | CHECK IN ('used','edited','neglected','helpful','not_helpful') | 이벤트 유형 |
| score | REAL | NULL 허용 | 선택적 점수 |
| session_id | TEXT | NULL 허용 | MCP 세션 ID |
| agent_id | TEXT | NULL 허용 | 에이전트 식별자 |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

**보존 정책**: 90일 슬라이딩 윈도우. 집계 쿼리에서 `created_at >= datetime('now', '-90 days')` WHERE 조건으로 적용.

---

## 2. 새로운 타입 정의

### 2.1 FeedbackEvent (도메인 타입)

```typescript
// packages/memento-core/src/shared/types/feedback.types.ts (신규)
export type FeedbackEventType = 'used' | 'edited' | 'neglected' | 'helpful' | 'not_helpful';

export interface FeedbackEvent {
  id: number;
  memory_id: string;
  event: FeedbackEventType;
  score?: number;
  session_id?: string;
  agent_id?: string;
  created_at: string;
}

export interface CreateFeedbackEventInput {
  memory_id: string;
  event: FeedbackEventType;
  score?: number;
  session_id?: string;
  agent_id?: string;
}

export interface FeedbackNetScore {
  memory_id: string;
  net_score: number;  // 원시 정수: helpful 수 - not_helpful 수 (90일 윈도우)
                      // ranking 주입 전 시그모이드 정규화 적용: 1/(1+e^(-net_score)) → [0,1]
}
```

### 2.2 ScoreBreakdown (신규)

```typescript
// packages/memento-core/src/shared/types/search.types.ts (기존 파일 확장)
export interface ScoreComponent {
  score: number;   // 절대 기여값
  pct: number;     // 전체 기여 절대합 대비 백분율 (0-100)
}

export interface ScoreBreakdown {
  relevance: ScoreComponent;            // “관련성 계열” 복합 슬롯: α·relevance(통합 점수 블렌딩 포함) + ζ·relation_weight + procedural_boost + process_attribute_fit (구현은 search-ranking.ts `relevanceBucket`). pct는 |total| 대비 비율(FR-008).
  recency: ScoreComponent;
  importance: ScoreComponent;
  usage: ScoreComponent;
  duplication_penalty: ScoreComponent;  // pct는 패널티 비율
  feedback: ScoreComponent;             // 피드백 신호 기여
  total: number;                        // 최종 합산 점수
}
```

### 2.3 RankingFeatures (기존 인터페이스 확장)

```typescript
// packages/memento-core/src/domains/search/algorithms/search-ranking.ts
// feedback_score 필드 추가
interface RankingFeatures {
  // ... 기존 필드 ...
  feedback_score?: number;  // 시그모이드 정규화된 피드백 신호: 1/(1+e^(-net_score)) → [0,1]
                            // 피드백 없는 기억=undefined → ranking에서 0.5로 처리(중립)
}
```

### 2.4 QueryCategory (신규)

```typescript
// packages/memento-core/src/shared/types/benchmark.types.ts (신규)
export type MacroCategory =
  | 'episodic_recent'   // 최신 에피소딕 조회
  | 'procedural'        // 절차 회수
  | 'conceptual'        // 개념·의미 검색
  | 'tag_filter';       // 태그 기반 필터링

export interface QueryWithCategory {
  query_id: string;
  query: string;
  language: string;
  category: string;          // 기존 세분화 카테고리 (보존)
  macro_category?: MacroCategory;  // 상위 4종 매핑 (신규)
  notes?: string;
}

export interface CategoryQualityReport {
  macro_category: MacroCategory;
  query_count: number;
  mrr: number;
  ndcg_at_5: number;
  ndcg_at_10: number;
  threshold_passed: boolean;  // MRR >= 0.5
}
```

### 2.5 WeightProfile (신규)

```typescript
// packages/memento-core/src/shared/types/ranking.types.ts (기존 파일 확장)
export interface WeightProfile {
  name: string;          // 예: "default", "feedback-heavy"
  version?: string;
  weights: {
    alpha: number;       // relevance
    beta: number;        // recency
    gamma: number;       // importance
    delta: number;       // usage
    epsilon: number;     // duplication_penalty
    zeta_fb: number;     // feedback signal
    [key: string]: number;
  };
}

export interface ABComparisonReport {
  profile_a: string;
  profile_b: string;
  profile_a_mrr: number;
  profile_b_mrr: number;
  profile_a_ndcg_at_5: number;
  profile_b_ndcg_at_5: number;
  profile_a_ndcg_at_10: number;
  profile_b_ndcg_at_10: number;
  mrr_delta: number;   // profile_b_mrr - profile_a_mrr (양수면 B가 MRR 우위)
  p_value: number;       // permutation test
  significant: boolean;  // p < 0.05
  verdict: 'a_better' | 'b_better' | 'inconclusive';
}
```

---

## 3. Fixture 파일 변경

### 3.1 category-mapping.json (신규)

`tests/fixtures/search-quality/benchmark-v3/category-mapping.json`

```json
{
  "macro_categories": {
    "episodic_recent": ["incident", "operations"],
    "procedural": ["procedure", "procedural", "database", "build"],
    "conceptual": ["search", "memory", "anchor", "embedding", "relation", "security", "forgetting"],
    "tag_filter": ["config", "dev", "resilience", "testing"]
  },
  "query_overrides": {}
}
```

쿼리별 override가 필요한 경우 `query_overrides`에 `"q_001": "episodic_recent"` 형태로 지정.

---

## 4. 엔티티 관계

```
memory_item (기존)
    │
    ├─── feedback_event (기존, 확장)
    │         ├── memory_id → memory_item.id (FK, CASCADE)
    │         ├── session_id (추가)
    │         └── agent_id (추가)
    │
    └─── ScoreBreakdown (응답 전용, DB 저장 없음)

queries.json (fixture)
    └── category → category-mapping.json → MacroCategory

WeightProfile (config/ranking-profiles/*.toml)
    └── ABComparisonReport (스크립트 출력, DB 저장 없음)
```

---

## 5. 상태 전이

### feedback_event lifecycle

```
생성(helpful/not_helpful 제출)
    → 저장 (session_id, agent_id 포함)
    → 90일간 활성 (집계 쿼리 포함)
    → 90일 경과 후 집계에서 자동 제외 (WHERE created_at >= datetime('now', '-90 days'))
    → (선택) 물리 삭제: forgetting-policy-service 배치에서 처리
```

---

## 6. `relevance` 슬롯의 의미 (구현 노트)

FR-008은 사용자에게 **6개** 구성 요소만 노출한다. 랭킹 엔진은 관계 가중·절차 메모리 부스트·프로세스 적합도를 최종 점수에 더하지만, 별도 슬롯을 두지 않고 **`relevance` 필드의 `score`/`pct`에 합산**한다. 에이전트는 “순수 텍스트·벡터 관련성만”이 아니라 “관련성 축에 가까운 신호들의 묶음”으로 해석하면 된다.

---

## 7. 성능 검증 범위 (참고)

FR-004(피드백 경로 지연 p95가 50ms 미만) 및 SC-003(검색 지연 p95가 100ms 미만) 요구에 대한 **자동 성능 회귀 테스트**는 현재 저장소에 포함되어 있지 않다. 릴리스 전에는 수동 측정 또는 별도 부하·벤치마크로 검증한다.
