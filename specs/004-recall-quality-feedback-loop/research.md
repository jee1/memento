# Research: Recall Quality Feedback Loop

**Date**: 2026-03-26
**Branch**: `004-recall-quality-feedback-loop`

---

## 1. feedback_event 테이블 현황

### Decision
`feedback_event` 테이블이 이미 schema.sql에 존재한다. 신규 마이그레이션으로 `session_id`, `agent_id` 컬럼을 추가하는 방식을 선택한다.

**현재 스키마**:
```sql
feedback_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  event TEXT CHECK (event IN ('used','edited','neglected','helpful','not_helpful')),
  score REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
)
```

**추가 필요 컬럼**: `session_id TEXT`, `agent_id TEXT`, `created_at` 인덱스 이미 있음.

**90일 TTL**: `created_at < datetime('now', '-90 days')` 조건으로 forget 배치 또는 recall 호출 시 집계 쿼리에서 WHERE 절로 제한. 별도 물리 삭제는 기존 forgetting-policy-service 패턴 재사용 가능.

### Rationale
- 기존 테이블을 재사용하면 스키마 마이그레이션 최소화
- `helpful`/`not_helpful` 이벤트 타입이 이미 정의되어 있음
- 마이그레이션 005번으로 컬럼 추가

### Alternatives Considered
- 신규 테이블 별도 생성: 불필요한 복잡도, 기존 ON DELETE CASCADE FK 재정의 필요

---

## 2. 피드백 신호 → 랭킹 통합 방식

### Decision
`search-ranking.ts`의 `usage` 점수 계산 시 `feedback_event`에서 집계한 net_score(helpful 횟수 - not_helpful 횟수, 90일 윈도우)를 추가 신호로 주입한다. 기존 `RankingFeatures` 인터페이스에 `feedback_score?: number` 필드를 추가하고, hybrid-search-engine이 recall 호출 시 메모리 ID별 집계를 수행해 주입한다.

**집계 쿼리 (호출 시)**:
```sql
SELECT memory_id,
       SUM(CASE WHEN event='helpful' THEN 1 ELSE 0 END) -
       SUM(CASE WHEN event='not_helpful' THEN 1 ELSE 0 END) AS net_score
FROM feedback_event
WHERE memory_id IN (?, ?, ...)
  AND created_at >= datetime('now', '-90 days')
GROUP BY memory_id
```

**랭킹 공식 변경**: 기존 usage 가중치(δ=0.10)에서 feedback_score를 별도 가중치(ζ_fb=0.05, 기본값)로 독립 추가. 기존 다른 가중치는 불변.

### Rationale
- 호출 시 집계(clarification Q1 결정)이므로 배치 스케줄러 불필요
- IN 절로 후보 메모리 ID만 조회 → 쿼리 비용 최소화
- 기존 usage 신호(recall_count 기반)와 독립 — 피드백이 없어도 기존 동작 유지

### Alternatives Considered
- usage 신호에 직접 합산: feedback 신호가 recall_count와 섞여 해석 불가
- 별도 캐시 테이블: 초기 구현에 불필요한 복잡도

---

## 3. 쿼리 카테고리 현황 및 정렬 방식

### Decision
`queries.json`에 이미 `category` 필드가 존재하며 세분화된 값(incident, testing, procedure, config, operations 등 10여 종)을 사용 중이다. 스펙의 4개 유형(최신 에피소딕 / 절차 / 개념 / 태그)은 **상위 카테고리(macro_category)**로 매핑 테이블을 정의하고, 기존 category를 보존한다.

**매핑 예시**:
| macro_category | category 값들 |
|----------------|--------------|
| episodic_recent | incident, operations |
| procedural | procedure, procedural, database, build |
| conceptual | search, memory, anchor, embedding, relation, security |
| tag_filter | config, dev, resilience, forgetting, testing |

실제 매핑은 `tests/fixtures/search-quality/benchmark-v3/category-mapping.json` 파일로 관리.

### Rationale
- 기존 queries.json 수정 최소화 (category 필드 유지)
- macro_category 추가는 별도 매핑 파일로 — fixture 파일 변경 없이 관리 가능
- CI에서 macro_category별 집계 시 mapping 파일을 참조

### Alternatives Considered
- queries.json에 macro_category 필드 직접 추가: 기존 benchmark 파일 변경 → manifest 재검증 필요
- 4개 유형으로 category 재분류: 기존 세분화 정보 손실

---

## 4. score_breakdown 반환 구조

### Decision
recall 결과의 각 항목에 선택적으로 `score_breakdown` 객체를 추가한다. 형식은 clarification Q4에서 결정된 **절대값 + 백분율 병행**.

**구조**:
```typescript
interface ScoreBreakdown {
  relevance:  { score: number; pct: number };
  recency:    { score: number; pct: number };
  importance: { score: number; pct: number };
  usage:      { score: number; pct: number };
  duplication_penalty: { score: number; pct: number };
  total: number;
}
```

`pct`는 각 요소의 기여 절대값 / 전체 기여 절대값 합계 × 100 (음수인 duplication_penalty는 별도 표시).

**MCP 도구 변경**: `recall` 도구에 `include_score_breakdown?: boolean` 파라미터 추가 (기본값 false, 하위 호환 유지).

### Rationale
- 절대값으로 "관련성이 0.42"를, 백분율로 "전체의 72%"를 동시에 파악 가능
- 기존 recall 호출에 영향 없음 (옵션 미사용 시 breakdown 미포함)

---

## 5. A/B 가중치 실험 구조

### Decision
`config/ranking-weights.toml`을 기반으로 **named profile** 방식을 채택한다. 프로파일은 `config/ranking-profiles/` 디렉터리에 `<name>.toml` 형식으로 저장. 비교 스크립트가 두 프로파일을 로드해 benchmark-v3에서 각각 검색 실행 후 MRR, NDCG@5, NDCG@10 집계.

**통계 유의성**: 쿼리 23개는 paired permutation test에 적합. `scripts/compare-weight-profiles.ts`에서 구현.

### Rationale
- 기존 ranking-weights-loader.ts가 TOML 로딩을 처리하므로 재사용 가능
- 프로파일 디렉터리 분리로 기본값 프로파일과 실험 프로파일 명확히 구분

---

## 6. 마이그레이션 전략

### Decision
`packages/memento-core/src/infrastructure/database/database/migrations/005_feedback_attribution.sql`:
```sql
ALTER TABLE feedback_event ADD COLUMN session_id TEXT;
ALTER TABLE feedback_event ADD COLUMN agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback_event(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_event(agent_id);
```

기존 DB는 migration 시스템(migration-history-service.ts)을 통해 자동 적용.

### Rationale
- SQLite ALTER TABLE은 컬럼 추가 지원
- 기존 데이터(session_id=NULL, agent_id=NULL)는 NULL로 유지 — 역호환 문제 없음
