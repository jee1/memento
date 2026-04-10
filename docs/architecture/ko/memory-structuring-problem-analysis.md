# 기억 구조화 문제 분석

> 작성일: 2026-04-10  
> 상태: 분석 중 (진행형)

---

## 개요

Memento에 쌓이는 기억이 구조화되지 못하고 단편적인 상태로 머무르는 현상이 관찰된다. 기억 구조화를 위한 기능(Sleep Consolidation, Relation Extraction, Triple Extraction 등)은 구현되어 있으나 실제로는 다음과 같은 복합적인 문제들로 인해 효과적으로 작동하지 않는다.

현상은 크게 세 가지가 복합적으로 나타난다:
- 같은 주제가 여러 개의 별도 episodic 기억으로 분산 존재
- semantic 기억이 거의 없고 episodic만 쌓임
- 서로 관련된 기억들이 relation/link로 연결되지 않음

---

## 백그라운드 구조화 파이프라인 현황

### remember 호출 직후 (fire-and-forget)
| 작업 | 설명 |
|------|------|
| 임베딩 생성 | 벡터 검색 및 유사도 계산용 |
| 인접 기억 갱신 | 유사도 0.8 이상인 기억과 연결 |
| 관계 추출 | rule-based hybrid 방식으로 memory_link 생성 |

### BatchScheduler 주기 작업
| 작업 | 기본 주기 | env 변수 | 설명 |
|------|-----------|----------|------|
| Triple 추출 | 1시간 | — | KG triple 생성 (배치 크기 10) |
| **Sleep Consolidation** | **24시간** | `SLEEP_CONSOLIDATION_INTERVAL_MS` | **episodic → semantic 통합 (핵심 구조화)** |
| 관계 검증 | 7일 | — | 추출된 관계 품질 검증 |
| 품질 측정 | 24시간 | — | 메모리 품질 지표 수집 |
| **망각 정책 cleanup** | **1시간** | — | **TTL 기반 soft/hard delete** |

> ⚠️ **역전된 우선순위**: 구조화(consolidation)가 24시간마다 실행되지만, 삭제(forgetting)는 1시간마다 실행된다.
> 기억이 삭제된 후에 consolidation이 시도되므로 처리 기회를 놓칠 수 있다.

---

## 확인된 문제들

### 문제 1: Consolidation 윈도우와 TTL이 동일 (타이밍 충돌)

**관련 코드:**
- [`consolidation-repository.ts:21`](../../../packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.ts) — `getLookbackDays()` 기본값 30일
- [`forgetting-policy-service.ts:67`](../../../packages/memento-core/src/domains/forgetting/services/forgetting-policy-service.ts) — episodic soft-delete TTL 30일

```
망각 정책 실행 주기:            1시간  ← 더 자주
Consolidation 실행 주기:        24시간 ← 더 느림
Consolidation lookback 기본값:  30일
Episodic hard-delete TTL:       180일
```

**두 가지 타이밍 문제가 겹친다:**

1. **주기 역전**: 삭제(1시간)가 구조화(24시간)보다 24배 자주 실행된다. 기억이 쌓이는 속도로 consolidation이 따라가지 못한다.
2. **lookback과 TTL 불일치**: soft-delete TTL(30일)이 lookback(30일)과 동일해, 30일 도달 시점에 consolidation 윈도우 이탈과 삭제 대상이 동시에 발생한다. 이후 hard-delete(180일)가 되기 전에 consolidation이 처리할 수도 있지만, lookback 기본값(30일)이 이를 막는다.

에피소딕 기억이 30일에 도달하는 순간, consolidation 윈도우에서 벗어남과 동시에 soft-delete(no-op) 대상이 된다. 24시간마다 돌아오는 consolidation이 그 사이에 처리하지 못하면 해당 기억은 구조화 기회를 영구히 잃는다.

---

### 문제 2: 클러스터 조건이 너무 엄격

**관련 코드:**
- [`clustering-service.ts:23`](../../../packages/memento-core/src/domains/consolidation/services/clustering-service.ts) — `getMinClusterSize()` 하드코딩 5
- [`clustering-service.ts:17`](../../../packages/memento-core/src/domains/consolidation/services/clustering-service.ts) — 유사도 임계값 기본 0.75

```typescript
getMinClusterSize(): number {
  return 5;  // 하드코딩
}
```

비슷한 기억이 4개만 모여도 클러스터가 형성되지 않는다. 5번째 기억이 오기 전에 30일이 지나면 4개 모두 TTL로 삭제된다. 이 두 조건(최소 5개 + 30일 윈도우)의 조합이 consolidation 발생 확률을 크게 낮춘다.

---

### 문제 3: Consolidation이 기존 semantic과 병합하지 않음

**관련 코드:**
- [`sleep-consolidation-service.ts:157`](../../../packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.ts) — 항상 새 semantic INSERT

```
1회차: episodic x5 → semantic A 생성
2회차: episodic x5 (같은 주제) → semantic B 생성 (A와 중복)
3회차: episodic x5 (같은 주제) → semantic C 생성 (A, B와 중복)
```

Sleep Consolidation은 기존에 같은 주제의 semantic이 있는지 확인하지 않고 항상 새 semantic을 INSERT한다. 시간이 지날수록 같은 주제의 semantic 기억이 중복 생성된다. 그리고 이 semantic 기억들 자체는 다시 consolidation 대상이 되지 않는다(episodic만 처리하기 때문에).

---

### 문제 4: Soft-delete 자체가 구현되지 않음 (no-op)

**관련 코드:**
- [`forgetting-policy-service.ts:276`](../../../packages/memento-core/src/domains/forgetting/services/forgetting-policy-service.ts) — `softDeleteMemory` 구현
- [`schema.sql:5`](../../../packages/memento-core/src/infrastructure/database/database/schema.sql) — `memory_item` 스키마

```typescript
// forgetting-policy-service.ts — "소프트 삭제" 실제 구현
private async softDeleteMemory(db: any, memoryId: string): Promise<void> {
  await DatabaseUtils.run(db, `
    UPDATE memory_item 
    SET pinned = FALSE, last_accessed = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [memoryId]);
  // ⚠️ deleted_at / is_deleted 컬럼이 없어 삭제 상태를 표시하지 않음
  // ⚠️ pinned = FALSE는 이미 기본값 — 사실상 last_accessed 갱신만 발생
}
```

```sql
-- memory_item 스키마 — deleted_at, is_deleted 컬럼 없음
-- (deleted_at은 knowledge_vault 테이블에만 존재)
CREATE TABLE IF NOT EXISTS memory_item (
  id TEXT PRIMARY KEY,
  type TEXT ...,
  pinned BOOLEAN DEFAULT FALSE,
  is_consolidated BOOLEAN DEFAULT FALSE
  -- ⚠️ deleted_at 없음, is_deleted 없음
);
```

**실제 삭제 동작:**

| 단계 | 코드 | 실제 효과 |
|------|------|-----------|
| soft-delete | `pinned = FALSE` UPDATE | **no-op** (이미 FALSE인 경우가 대부분) |
| hard-delete | `DELETE FROM memory_item` | 행 완전 삭제 |

`memory_item`에는 soft-delete 상태를 표현하는 컬럼이 없다. 따라서 "soft-deleted" 기억은 일반 기억과 구별 불가능하며, consolidation 쿼리에 필터를 추가해도 의미가 없다.

원래 예상했던 문제(soft-deleted 기억이 consolidation에 포함)는 발생하지 않는다. 대신 **soft-delete 단계 자체가 무의미**하며, 망각 정책은 사실상 "아무것도 안 함 → 즉시 하드 삭제"의 두 단계만 존재한다.

---

### 문제 5: 저장 시점에 중복/유사 기억 확인 없음

`remember`는 완전한 append-only 구조다. 저장 전에 "의미적으로 유사한 기억이 이미 있는지" 확인하는 로직이 없다. AI 에이전트(Claude)가 컨텍스트 없이 `remember`를 호출하면 어제 저장한 것과 동일한 내용이 새 레코드로 추가된다.

또한 기억 저장 시 `type`이 지정되지 않으면 기본값 `episodic`으로 저장되어, semantic 지식도 episodic으로 쌓이는 경우가 발생한다.

---

## 구조화 실패 경로 요약

```
경로 ①: episodic 기억 5개 미만 유사
  → 클러스터 미형성 → 30일 후 TTL 삭제 → 구조화 기회 소멸

경로 ②: episodic 기억 5개 이상이지만 lookback 30일 초과
  → consolidation 윈도우 밖 → 처리 대상 아님 → 이후 삭제

경로 ③: consolidation 성공해도
  → 기존 semantic과 미병합 → semantic 중복 생성
  → semantic끼리 통합하는 레이어 부재 → 구조화 효과 희석
```

---

## 미검토 영역 (추가 분석 필요)

- [x] soft-delete 상태의 기억이 consolidation 쿼리에서 실제로 어떻게 처리되는지 → **문제 4로 정리 완료**: `memory_item`에 soft-delete 컬럼 없음, `softDeleteMemory()`는 no-op
- [x] `memory_injection` 프롬프트가 AI 에이전트에게 기억 구조화 가이드를 제공하는지 → **문제 5 심층 확인 완료**: `memory_injection`은 순수 조회 도구 — 구조화 가이드 없음. `remember`의 `type` 파라미터 description에 예시가 있으나 기본값이 `episodic`이고 호출 시점 지침은 없음
- [x] Triple extraction 결과가 실제로 recall/structuring에 어떻게 활용되는지 → **아래 Triple 파이프라인 분석 참고**
- [x] semantic-to-semantic consolidation (2차 통합) 가능성 → **아래 2차 통합 분석 참고**: 경로 없음, semantic은 365일까지 무제한 누적
- [ ] consolidation lookback을 TTL보다 길게 설정했을 때의 효과

---

## Triple Extraction 파이프라인 분석

### 전체 흐름

```
remember(type='episodic')
  └─ fire-and-forget (BatchScheduler JobQueue)
       └─ TripleExtractionService.extractTriples(content)  [LLM 호출]
            └─ SemanticMemoryUpdateService.updateSemanticMemory(result)
                 ├─ kg_triple 조회 → 동일 (s,p,o) 중복이면 기존 semantic UPDATE
                 ├─ findDuplicateSemanticMemory() → 유사 semantic 있으면 병합
                 └─ 없으면 새 semantic memory_item INSERT
```

별도로 `TripleExtractionBatchJob`(1시간 주기)이 미처리/실패 episodic을 재시도한다.

### Triple → Recall 연결 경로

Triple 추출의 최종 산출물은 `kg_triple` 테이블 행이 **아니라** `memory_item` 테이블의 `type='semantic'` 행이다. 이 semantic 기억은 일반 recall/hybrid search(FTS5 + 벡터)로 조회된다. `kg_triple` 테이블은 recall 쿼리에서 **전혀 참조되지 않으며** 오직 생성 시점 중복 방지(dedup registry)로만 사용된다.

### Triple Extraction이 Sleep Consolidation과 경쟁하는 구조

| 구분 | Triple Extraction | Sleep Consolidation |
|------|-------------------|---------------------|
| 트리거 | `remember` 호출 직후 (fire-and-forget) | 24시간 주기 배치 |
| 입력 | 개별 episodic 하나 | lookback 내 episodic 클러스터 (≥5개) |
| 출력 | `type='semantic'` memory_item (triple 기반) | `type='semantic'` memory_item (요약 기반) |
| 중복 처리 | `kg_triple` dedup + 유사도 병합 | 없음 (항상 새 INSERT — 문제 3) |

두 파이프라인이 **동일한** `memory_item` 테이블에 동일한 `type='semantic'` 행을 독립적으로 생성한다. 서로를 인지하지 않으므로 같은 주제의 semantic이 triple 경로와 consolidation 경로 양쪽에서 중복 생성될 수 있다.

### 결론: Triple Extraction은 정상 작동하지만 고립됨

- Triple 추출 → semantic memory 생성 경로 자체는 구현되어 있고 dedup도 있음
- 단, 생성된 semantic은 일반 hybrid search로만 접근 가능 (kg_triple 기반 탐색 경로 없음)
- Sleep Consolidation과 서로를 인식하지 않아 semantic 중복 축적에 기여
- `confidence < 0.7`이면 semantic 생성 자체를 건너뜀 — LLM 품질에 따라 생성율이 낮을 수 있음

---

## Semantic-to-Semantic Consolidation (2차 통합) 분석

### 결론: 2차 통합 경로 없음

`SleepConsolidationService`와 Triple Extraction 모두 `episodic` 기억만 입력으로 받는다.

**`findEpisodicCandidates` 쿼리:**
```sql
WHERE type = 'episodic'          -- semantic은 명시적으로 제외
  AND COALESCE(is_consolidated, 0) = 0
```

Semantic 기억은 생성된 이후 어떤 구조화 파이프라인도 처리하지 않는다.

### Semantic 기억의 실제 수명 주기

```
생성 경로 ①: Triple Extraction — episodic 하나당 semantic 최대 1개 (1시간 주기 배치)
생성 경로 ②: Sleep Consolidation — episodic 클러스터 5개당 semantic 1개 (24시간 주기)

↓ 이후 어떤 통합/병합 처리도 없음

TTL soft: 180일 (no-op — memory_item에 deleted_at 없음, 문제 4 참고)
TTL hard: 365일 → 행 완전 삭제
```

### Semantic 누적 문제

두 생성 경로가 같은 주제의 semantic을 독립적으로 생성하고, 한번 생성된 semantic은 365일까지 방치된다:

```
1개월차: semantic A (triple 경로), semantic B (consolidation 경로) — 같은 주제
3개월차: semantic C, D (triple), semantic E (consolidation) — 같은 주제
6개월차: semantic F, G, H, I, J, K ...

→ recall top-K 슬롯이 같은 지식의 변형들로 채워짐
→ ranker의 duplication_penalty (ε=0.10)가 일부 감쇄하지만, 의미적으로 유사한
  여러 semantic이 각각 독립적으로 높은 relevance score를 받으면 상쇄 불가
→ 결과적으로 다른 주제의 중요한 기억이 top-K에서 밀려남
```

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `packages/memento-core/src/domains/consolidation/services/sleep-consolidation-service.ts` | consolidation 오케스트레이터 |
| `packages/memento-core/src/domains/consolidation/services/clustering-service.ts` | 에피소딕 클러스터링 |
| `packages/memento-core/src/domains/consolidation/services/summarization-service.ts` | 클러스터 요약 (LLM / extractive) |
| `packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.ts` | consolidation DB 쿼리 |
| `packages/memento-core/src/domains/forgetting/services/forgetting-policy-service.ts` | TTL 기반 망각 정책 |
| `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` | 배치 스케줄러 |
| `packages/memento-core/src/domains/memory/tools/remember-tool.ts` | 기억 저장 (fire-and-forget 트리거) |
