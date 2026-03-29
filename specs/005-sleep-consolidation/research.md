# Research: Sleep Consolidation

**Phase**: 0 | **Branch**: `005-sleep-consolidation` | **Date**: 2026-03-28

## Decisions

---

### Decision 1: `is_consolidated` 플래그 저장 위치

**Decision**: `memory_item` 테이블에 `is_consolidated BOOLEAN DEFAULT FALSE` 컬럼 추가 (migration 009)

**Rationale**:
- SQL `WHERE is_consolidated = FALSE` 인덱스 검색이 가능 → 클러스터링 대상 필터링 효율
- `origin_source` JSON 필드 내 저장은 인덱싱 불가, 전체 스캔 필요 → 거부
- Constitution III(Schema Migration Discipline)에 따라 명시적 마이그레이션 파일 필수

**Alternatives considered**:
- `origin_source` JSON에 `consolidated: true` 추가 — 인덱싱 불가, 거부
- `importance <= 0.1` 조건으로 대체 — "사용자가 낮게 설정한 것"과 구분 불가, 거부

---

### Decision 2: 클러스터링 알고리즘

**Decision**: 코사인 유사도 기반 greedy threshold 클러스터링. 임계값 기본 0.75 (환경변수 `CONSOLIDATION_SIMILARITY_THRESHOLD`로 설정 가능)

**Rationale**:
- 기존 `memory_embedding` 테이블에 임베딩이 이미 저장됨 → 추가 임베딩 계산 불필요
- Greedy clustering은 구현 단순, 배치 환경에서 충분한 품질
- K-means 등 고급 알고리즘은 초기 구현에서 YAGNI

**Alternatives considered**:
- K-means: 클러스터 수 사전 결정 필요, 초기 구현에 과도함
- HDBSCAN: 외부 의존성 추가 필요, 거부
- Agent로 클러스터 판단: LLM 비용 과다, 거부

---

### Decision 3: 시맨틱 요약 생성

**Decision**: LLM API 키 설정 시 LLM 텍스트 생성 사용, 미설정 시 클러스터 내 `importance` 최고 에피소딕 content 그대로 사용 (LLM-free fallback)

**Rationale**:
- Memento는 로컬 전용 환경도 지원 → LLM 없이도 동작해야 함
- LLM 사용 시 제공자: OPENAI_API_KEY → OpenAI, GEMINI_API_KEY → Gemini, 없으면 fallback

**Alternatives considered**:
- LLM 항상 필수: 로컬 사용자 배제, 거부
- 항상 extractive only: LLM 사용자 경험 저하, 거부

---

### Decision 4: Episodic↔Semantic 링크

**Decision**: 기존 `memory_relation` 테이블의 `extracted_from` (semantic→episodic) / `supported_by` (episodic→semantic) relation type 재사용. `origin_source` JSON에 `source_episodic_ids` 배열도 병기 (빠른 조회용)

**Rationale**:
- `extracted_from`, `supported_by` relation type이 schema에 이미 정의됨
- `memory_relation` 재사용으로 관계 그래프 일관성 유지
- `origin_source`의 `source_episodic_ids`는 N+1 쿼리 없이 빠른 조회를 위한 보조 역할

**Alternatives considered**:
- metadata JSON 별도 컬럼 추가: 불필요, memory_relation으로 충분
- 새 테이블 consolidation_source: 과도한 복잡도

---

### Decision 5: 실행 로그 저장

**Decision**: DB 신규 테이블 없이 기존 `FileLogger` + 구조화된 JSON 로그 사용. Admin API 응답으로 최근 실행 결과 반환

**Rationale**:
- YAGNI: 별도 로그 테이블은 초기 구현에 과도
- 기존 FileLogger 인프라 재사용

---

### Decision 6: `owner_id`와 agent_id 범위

**Decision**: `memory_item.owner_id` 기준으로 그룹화하여 클러스터링. `owner_id IS NULL`인 항목들은 별도 그룹으로 처리

**Rationale**:
- `memory_item`에는 `agent_id` 컬럼이 없고 `owner_id`가 multi-agent 식별자 역할
- spec의 "agent_id 단위 격리"는 owner_id 기준 구현으로 충족

---

### Decision 7: 이름 충돌 방지

**Decision**: 기존 `ConsolidationScoreWorker`(recall 확률 계산)와 구분하여 새 클래스/파일은 `SleepConsolidation*` prefix 사용

**Rationale**:
- 기존 `consolidation-score-service.ts`는 Hou et al. 공식 기반 recall probability 계산 → 완전히 다른 개념
- prefix로 명확히 구분

---

## Existing Infrastructure Reuse

| 기존 인프라 | 재사용 방법 |
|------------|------------|
| `memory_embedding` 테이블 | 임베딩 조회 (클러스터링용) |
| `memory_relation` 테이블 | `extracted_from` / `supported_by` 관계 저장 |
| `BatchScheduler` | 신규 `SleepConsolidationBatchJob` 등록 |
| `FileLogger` | 실행 로그 기록 |
| Admin routes pattern | `POST /admin/consolidation/run` 추가 |
| `ForgettingPolicyService` 패턴 | 서비스 설계 참고 |
| `owner_id` 필드 | agent 범위 격리 |
