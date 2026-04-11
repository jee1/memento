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

### 문제 6: `schema.sql`과 migration 008 사이의 컬럼 누락

**관련 코드:**
- [`schema.sql:46`](../../../packages/memento-core/src/infrastructure/database/database/schema.sql) — `memory_item` DDL
- [`008-arigraph-schema-expansion.sql`](../../../packages/memento-core/src/infrastructure/database/database/migration/migrations/008-arigraph-schema-expansion.sql) — migration 008 SQL

`schema.sql`의 `memory_item` 테이블에 아래 3개 컬럼이 누락되어 있다:

```sql
-- migration 008이 추가하려 했던 컬럼 — schema.sql에 없음
triple_extracted BOOLEAN DEFAULT NULL,
triple_extracted_status TEXT DEFAULT NULL,
triple_extraction_metadata TEXT DEFAULT NULL,
```

**두 초기화 경로의 불일치:**

| 경로 | 결과 |
|------|------|
| 신규 DB 생성 (`schema.sql` 직접 초기화) | `triple_extracted` 계열 컬럼 **없음** |
| 기존 DB + migration 008 실행 | 컬럼 **있음** |

즉, 처음부터 새로 생성한 DB는 migration 없이 `schema.sql`만으로 초기화되기 때문에 해당 컬럼이 없다. 이때 Triple Extraction 배치 job이 실행되면 아래 로그 패턴이 반복된다:

```
INFO  Triple 추출 작업이 JobQueue에 등록
WARN  Triple 추출 실패: no such column: triple_extracted_status
WARN  Triple 추출 실패 상태 업데이트 실패: no such column: triple_extracted
INFO  Job completed successfully  ← 예외를 내부에서 흡수하므로 "성공"으로 기록됨
```

결과적으로 **Triple Extraction 파이프라인이 완전히 비활성화**된 채로 동작한다. 실패는 WARN 레벨로만 기록되고, BatchScheduler에는 성공으로 보고된다.

**수정 방법:** `schema.sql`에 누락된 3개 컬럼 및 인덱스 2개 추가 (migration 008과 동기화).

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

경로 ④: Triple Extraction 경로 (schema.sql 누락 시)
  → triple_extracted_status 컬럼 없음 → job 즉시 WARN + 종료
  → 모든 episodic이 triple 추출 없이 방치
  → Triple 경로의 semantic 생성 완전 불가
```

---

## 미검토 영역 (추가 분석 필요)

- [x] soft-delete 상태의 기억이 consolidation 쿼리에서 실제로 어떻게 처리되는지 → **문제 4로 정리 완료**: `memory_item`에 soft-delete 컬럼 없음, `softDeleteMemory()`는 no-op
- [x] `memory_injection` 프롬프트가 AI 에이전트에게 기억 구조화 가이드를 제공하는지 → **문제 5 심층 확인 완료**: `memory_injection`은 순수 조회 도구 — 구조화 가이드 없음. `remember`의 `type` 파라미터 description에 예시가 있으나 기본값이 `episodic`이고 호출 시점 지침은 없음
- [x] Triple extraction 결과가 실제로 recall/structuring에 어떻게 활용되는지 → **아래 Triple 파이프라인 분석 참고**
- [x] semantic-to-semantic consolidation (2차 통합) 가능성 → **아래 2차 통합 분석 참고**: 경로 없음, semantic은 365일까지 무제한 누적
- [x] consolidation lookback을 TTL보다 길게 설정했을 때의 효과 → **아래 lookback/TTL 코드 기반 분석 참고**

### lookback > TTL 효과 (코드 기반)

#### 1) consolidation lookback이 실제로 하는 일

Sleep consolidation의 후보 episodic은 아래 쿼리로 결정된다:
- lookback은 `CONSOLIDATION_LOOKBACK_DAYS` (기본 30일) (`packages/memento-core/src/domains/consolidation/repositories/consolidation-repository.ts`)
- 후보 조건은 단순히 “created_at이 최근 N일 이내”이며, pinned / is_consolidated만 제외한다:
  - `WHERE type='episodic' AND is_consolidated=0 AND pinned=0 AND created_at >= now - N days`

즉, lookback을 늘리면 **DB에 남아있는 더 오래된 episodic**이 후보로 들어와 클러스터링/요약될 기회가 늘어난다.

#### 2) TTL이 현재 코드에서 ‘자동 상한’이 아닌 이유

TTL은 “시간이 지나면 무조건 삭제”가 아니라, **망각 점수(forget_score) + 임계값**을 만족할 때만 실행된다:
- cleanup job은 BatchScheduler에서 1시간 주기로 실행됨 (`cleanupInterval=1h`) (`packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`)
- hard delete는 `DELETE FROM memory_item WHERE id=?`로 실제 행 삭제 (`packages/memento-core/src/domains/forgetting/services/forgetting-policy-service.ts`)
- 하지만 hard delete 조건은:
  - `forget_score >= hardDeleteThreshold(0.8)` AND `ageDays >= ttlHard.episodic(180)` AND `!pinned`
- soft delete는 현재 “삭제 플래그”가 아니라 `pinned=false`/`last_accessed` 갱신뿐이라 사실상 no-op에 가깝다 (`softDeleteMemory()`).

따라서 **lookback을 ttlHard(episodic=180)보다 크게 설정해도**, “180일 지난 episodic이 이미 하드 삭제됐는지”에 따라 효과가 달라진다:
- (A) 하드 삭제가 충분히 일어나면: `lookback > 180`의 추가 효과가 거의 없다.
- (B) 하드 삭제가 제한적이면(점수/임계값/운영상 cleanup 미실행 등): `lookback > 180`이 실제로 후보 풀을 넓혀 구조화 기회를 늘린다.

#### 3) 정리(효과/리스크)

- 기대 효과: 느린 주제(드문 episodic)가 `minClusterSize`를 충족할 가능성 증가 → semantic 생성량 증가
- 리스크: 시간적으로 먼 episodic이 섞여 요약이 뭉개지거나, semantic 중복/누적 문제(문제 3)를 가속할 수 있음
- 결론: “lookback만 늘리면 구조화가 된다”가 아니라, **(1) forgetting cleanup의 실제 삭제 강도와 (2) 클러스터 품질 게이트/2차 통합 부재**를 함께 고려해야 한다.

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

### 관측 로그 분석: `no such column: triple_extracted_status`

> **→ 문제 6으로 분리 정리.** 근본 원인은 `schema.sql`에 `triple_extracted` 계열 컬럼이 누락된 것으로 확인됨.

```
Triple 추출 실패 (...): no such column: triple_extracted_status
Triple 추출 실패 상태 업데이트 실패: no such column: triple_extracted
... Job ... completed successfully  ← 예외를 내부에서 흡수하므로 성공으로 기록
```

- Triple 추출 로직 자체(LLM 호출)는 실행되지 않음 — 상태 컬럼 접근 시점에 즉시 실패
- BatchScheduler가 “성공”으로 기록하는 이유: job 함수가 예외를 상위로 throw하지 않고 내부 WARN으로 흡수하기 때문
- Triple Extraction 파이프라인 전체가 silently 비활성화된 상태

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

### 결론: Triple Extraction은 구현은 있으나 현재 환경에서 완전 비활성화 상태

- Triple 추출 → semantic memory 생성 경로 자체는 구현되어 있고 dedup도 있음
- **현재 `schema.sql`에 `triple_extracted` 계열 컬럼이 누락**되어, 신규 생성 DB에서는 Triple Extraction이 실행될 때마다 WARN 후 즉시 종료 (문제 6)
- 생성된 semantic은 일반 hybrid search로만 접근 가능 (`kg_triple` 기반 탐색 경로 없음)
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

## 해결 방향 및 측정 계획

> 각 문제의 해결 옵션, 선택 사유, 미선택 사유, 그리고 효과 측정 방법을 정리한다.

---

### 해결 1: 스케줄링 역전 + TTL 충돌 (문제 1)

#### 변경 내용

| 대상 | 현재 | 변경 후 | 방법 |
|------|------|---------|------|
| 망각 cleanup 주기 | 1h (하드코딩) | 24h | env `FORGETTING_CLEANUP_INTERVAL_MS` 추가 |
| Consolidation 주기 | 24h | 1h | env `SLEEP_CONSOLIDATION_INTERVAL_MS` 기본값 변경 |
| Consolidation lookback | 30d | 90d | env `CONSOLIDATION_LOOKBACK_DAYS` 기본값 변경 |

#### 옵션 검토

**옵션 A (채택): 주기 교환 + lookback 확장**

망각 주기를 늦추고 consolidation 주기를 빠르게 한다. lookback을 90d로 늘려 hard-delete TTL(180d) 안에서 2차 이상의 consolidation 기회를 확보한다.

- 선택 사유: 가장 직접적인 원인 해결. 코드 변경 최소 (기본값 변경 + 환경변수 추가). 운영 환경에서 env로 튜닝 가능.
- 유의사항: lookback 확장 단독 적용은 문제 3(semantic 병합 없음)이 해결되지 않으면 semantic 중복을 가속한다. 반드시 해결 3과 함께 적용해야 한다.

**옵션 B (미채택): lookback만 늘리고 주기는 유지**

- 미채택 사유: 근본 원인(역전된 주기)을 방치하고 lookback만 늘려도 구조화율 개선 효과가 제한적이다. 24시간마다 실행되는 consolidation이 충분히 빠른 기억에 대응하지 못하는 상황은 동일하다.

**옵션 C (미채택): TTL 자체를 늘리기**

- 미채택 사유: TTL은 메모리 사용량을 제어하는 독립된 정책이다. 구조화 문제 해결을 위해 TTL을 건드리면 망각 정책 전체에 의도치 않은 부작용이 생길 수 있다.

#### 측정 방법

```sql
-- 최근 7일 에피소딕의 구조화 완료 비율
SELECT
  COUNT(*) AS total,
  SUM(is_consolidated) AS consolidated,
  ROUND(100.0 * SUM(is_consolidated) / COUNT(*), 1) AS consolidation_rate_pct
FROM memory_item
WHERE type = 'episodic'
  AND created_at >= datetime('now', '-7 days');
```

변경 전 `consolidation_rate_pct`는 0에 가까울 것으로 예상. 변경 후 24시간 내 수치가 올라가야 정상.

---

### 해결 2: 클러스터 조건 완화 (문제 2)

#### 변경 내용

`ClusteringService`의 최소 클러스터 크기와 유사도 임계값을 환경변수로 변경한다.

```typescript
// 변경 전
getMinClusterSize(): number { return 5; }

// 변경 후
getMinClusterSize(): number {
  return parseInt(process.env.CONSOLIDATION_MIN_CLUSTER_SIZE ?? '2', 10);
}
getSimilarityThreshold(): number {
  return parseFloat(process.env.CONSOLIDATION_SIMILARITY_THRESHOLD ?? '0.65');
}
```

#### 옵션 검토

**옵션 A (채택): minClusterSize 5 → 2, 임계값 0.75 → 0.65, 환경변수화**

- 선택 사유: 최솟값 5는 사용량이 적은 초기 단계에서는 사실상 consolidation 불가를 의미한다. 2개만 유사해도 요약할 수 있으며, 품질은 요약 모델이 보완한다. 환경변수화로 운영 중 조정 가능.
- 임계값 0.65는 0.75보다 더 넓은 의미 군집을 허용한다. 지나치게 낮추면 무관한 기억이 묶이므로 0.60~0.70 범위에서 실험적으로 결정한다.

**옵션 B (미채택): 최솟값만 낮추고 임계값 유지 (0.75)**

- 미채택 사유: 유사도 0.75 조건은 에피소딕 기억이 충분히 누적되지 않은 경우 클러스터가 여전히 형성되지 않는다. 두 조건을 함께 완화하지 않으면 개선 효과가 절반에 그친다.

**옵션 C (미채택): 클러스터 조건 완전 제거 (모든 에피소딕을 하나씩 요약)**

- 미채택 사유: 클러스터링 없는 개별 요약은 이미 Triple Extraction 파이프라인이 담당한다. Sleep Consolidation의 역할은 여러 기억을 군집화해 추상화하는 것이며, 이 구조를 없애면 두 파이프라인이 완전히 중복된다.

#### 측정 방법

```sql
-- consolidation 실행 결과 (telemetry_events 또는 별도 run log)
SELECT
  json_extract(extra_data, '$.clusters_found')     AS clusters_found,
  json_extract(extra_data, '$.clusters_processed') AS clusters_processed,
  ROUND(
    100.0 * json_extract(extra_data, '$.clusters_processed')
          / NULLIF(json_extract(extra_data, '$.clusters_found'), 0),
    1
  ) AS process_rate_pct
FROM telemetry_events
WHERE event_type = 'consolidation.performed'
ORDER BY created_at DESC LIMIT 10;
```

변경 전 `process_rate_pct`는 0%에 가까울 것으로 예상. 변경 후 50% 이상이 목표 초기값.

---

### 해결 3: Sleep Consolidation에 Semantic 병합 로직 추가 (문제 3)

#### 변경 내용

`SleepConsolidationService`에서 새 semantic을 INSERT하기 전에 기존 유사 semantic을 검색하고, 임계값(0.85) 이상이면 병합(UPDATE)한다.

```
insertSemanticMemory() 호출 전:
  1. 신규 요약 텍스트의 임베딩 생성
  2. 기존 semantic 중 cosine similarity > 0.85인 것 조회
  3-a. 있으면: 기존 semantic의 content를 병합 업데이트 + 관계 재연결
  3-b. 없으면: 신규 INSERT (현재 동작 유지)
```

Triple Extraction의 `findDuplicateSemanticMemory()` 패턴을 재사용한다.

#### 옵션 검토

**옵션 A (채택): 임베딩 유사도 기반 병합**

- 선택 사유: Triple Extraction에서 이미 검증된 패턴이다. 코드 재사용이 가능하고, 의미 기반 dedup이므로 표현이 다른 동일 개념도 병합할 수 있다.
- 유의사항: 임베딩 생성 비용이 추가된다. 단, 이미 트랜잭션 외부에서 임베딩을 생성하는 구조가 있으므로 기존 흐름에 자연스럽게 통합 가능.

**옵션 B (미채택): 텍스트 해시 기반 exact-match dedup만 적용**

- 미채택 사유: 요약 텍스트는 입력이 같아도 LLM이 다른 표현을 생성할 수 있다. exact-match는 중복 방지 효과가 거의 없다.

**옵션 C (미채택): 병합 없이 semantic 중복 허용 + ranker 강화**

- 미채택 사유: `duplication_penalty(ε=0.10)`은 의미적으로 유사한 여러 semantic이 각각 높은 relevance를 받는 상황을 완전히 상쇄하지 못한다. 중복이 많아질수록 top-K에서 다른 주제 기억이 밀려나는 문제를 근본 해결하지 않는다.

**옵션 D (미채택): semantic-to-semantic 2차 consolidation 배치 신설**

- 미채택 사유: 별도 배치를 추가하는 것은 중복이 이미 쌓인 뒤 사후 정리하는 접근이다. 삽입 시점에 병합하는 옵션 A가 예방적으로 더 효율적이며, 배치 신설은 스케줄러 복잡도를 높인다.

#### 측정 방법

```sql
-- 전체 semantic 수의 시계열 추이 (주 1회 스냅샷 비교)
SELECT
  DATE(created_at, 'start of week') AS week,
  COUNT(*) AS semantic_count
FROM memory_item
WHERE type = 'semantic'
GROUP BY 1
ORDER BY 1;
```

병합 로직 적용 후 `semantic_count`의 증가 기울기가 완만해지거나 안정화되어야 한다. 병합 전에는 선형 증가가 예상됨.

---

### 해결 4: Soft-delete 구현 (문제 4)

#### 변경 내용 (옵션 A 채택)

`memory_item` 테이블에 soft-delete 상태 컬럼을 추가하고, 모든 조회 쿼리에 필터를 적용한다.

```sql
-- 신규 마이그레이션 추가
ALTER TABLE memory_item ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE memory_item ADD COLUMN deleted_at DATETIME DEFAULT NULL;
```

```typescript
// forgetting-policy-service.ts
private async softDeleteMemory(db: any, memoryId: string): Promise<void> {
  await DatabaseUtils.run(db, `
    UPDATE memory_item
    SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [memoryId]);
}
```

모든 조회 쿼리(`findEpisodicCandidates`, `recall`, `search`, `memory_injection` 등)에 `AND (is_deleted IS NULL OR is_deleted = 0)` 필터 추가.

#### 옵션 검토

**옵션 A (채택): 스키마 컬럼 추가 + 조회 필터 적용 (정석)**

- 선택 사유: soft-delete의 본래 목적(즉시 삭제 대신 유예 기간 부여, 복구 가능성 확보)을 구현한다. 망각 정책 2단계(soft → hard)가 실제로 작동하게 된다. `deleted_at` 컬럼은 "언제 삭제 예약됐는가"를 추적할 수 있어 디버깅과 운영 관찰에도 유용하다.
- 변경 범위: 스키마 마이그레이션 + 전체 조회 쿼리 필터 추가. 변경 파일 수가 많지만 각 변경은 단순하다.

**옵션 B (미채택): soft-delete 단계 제거, hard-delete만 유지 (pragmatic)**

- 미채택 사유: 현재 no-op인 것은 사실이나, 망각 정책의 2단계 구조(soft → hard)는 설계 의도가 있다. 삭제 전 유예 기간을 두어 실수로 인한 데이터 손실을 방지하는 목적이다. 단순화를 위해 이 구조를 제거하면 향후 "삭제 취소", "최근 삭제된 기억 보기" 같은 기능을 추가하기 어려워진다.

**옵션 C (미채택): `pinned` 컬럼을 soft-delete 플래그로 재활용**

- 미채택 사유: `pinned`는 "중요한 기억을 영구 보존"이라는 별도의 의미가 있다. 재활용하면 두 개념이 충돌하고 쿼리 로직이 복잡해진다. 새 컬럼 추가가 명확하다.

#### 측정 방법

```sql
-- soft-delete 상태의 기억이 실제로 생기는지 확인
SELECT
  is_deleted,
  COUNT(*) AS count,
  MIN(deleted_at) AS earliest,
  MAX(deleted_at) AS latest
FROM memory_item
GROUP BY is_deleted;

-- recall 결과에 soft-deleted 기억이 포함되지 않는지 검증 (필터 적용 확인)
SELECT COUNT(*)
FROM memory_item
WHERE is_deleted = 1;
-- 이 수가 0이 아니어야 soft-delete가 실제로 발생하고 있다는 의미
-- recall 결과에 이 기억들이 없어야 필터가 올바름
```

---

### 해결 5: 저장 시점 중복 감지 (문제 5)

#### 단계적 접근

즉각적 변경과 장기 개선을 분리한다.

**1단계 (즉시, 코드 변경 최소): `remember` 툴 가이드 강화**

`remember` 툴의 파라미터 description에 타입 선택 기준을 명확히 추가하고, `memory_injection` 응답에 "현재 유사한 기억 N개 존재" 힌트를 포함한다.

- 선택 사유: 호출자(AI 에이전트)가 중복 여부를 인지하고 타입을 올바르게 선택하도록 유도한다. 구현 비용 없이 즉시 효과.
- 한계: 강제가 아니므로 호출자가 무시하면 중복이 계속 발생한다.

**2단계 (중기): write-time dedup hint**

```typescript
// remember-tool.ts — 저장 전 유사도 검사
const similar = await searchSimilar(content, { threshold: 0.85, limit: 3 });
if (similar.length > 0) {
  return {
    ...savedResult,
    warning: `유사한 기억 ${similar.length}개 존재`,
    similar_ids: similar.map(m => m.id)
  };
}
```

- 선택 사유: 기존 기억을 덮어쓰지 않고 경고만 반환하므로 기존 동작에 영향 없다. 호출자가 판단하도록 위임.
- 미채택 강도(hard reject): 저장 자체를 막으면 에이전트가 기억을 저장하지 못하는 상황이 발생할 수 있어 위험도가 높다.

**3단계 (장기): content hash 기반 exact-match dedup**

완전히 동일한 텍스트는 기존 기억의 `last_accessed`를 갱신하고 신규 INSERT를 생략한다.

- 선택 사유: 동일 내용을 반복 저장하는 비용을 제거. hash 계산 비용이 낮다.
- 한계: 표현이 조금 다른 동일 개념은 잡지 못한다. 2단계(유사도 검사)와 상호 보완적.

#### 측정 방법

```sql
-- 동일 owner가 24시간 내 저장한 기억 수 추이 (중복 저장 빈도 간접 지표)
SELECT
  owner_id,
  DATE(created_at) AS day,
  COUNT(*) AS daily_memory_count
FROM memory_item
WHERE type = 'episodic'
GROUP BY owner_id, day
ORDER BY day DESC;
```

2단계 적용 후 `daily_memory_count` 급증 패턴이 줄어들어야 한다.

---

### 해결 6: schema.sql / migration 008 동기화 (문제 6)

#### 변경 내용

`schema.sql`의 `memory_item` DDL에 누락된 3개 컬럼과 2개 인덱스를 추가한다.

```sql
-- 추가할 컬럼 (migration 008과 동기화)
triple_extracted BOOLEAN DEFAULT NULL,
triple_extracted_status TEXT DEFAULT NULL,
triple_extraction_metadata TEXT DEFAULT NULL,

-- 추가할 인덱스
CREATE INDEX IF NOT EXISTS idx_memory_item_triple_extracted
  ON memory_item(triple_extracted)
  WHERE triple_extracted IS NULL OR triple_extracted = 0;

CREATE INDEX IF NOT EXISTS idx_memory_item_triple_status
  ON memory_item(triple_extracted_status)
  WHERE triple_extracted_status IS NOT NULL;
```

#### 옵션 검토

**옵션 A (채택): schema.sql에 직접 추가 (migration과 동기화)**

- 선택 사유: 신규 DB와 기존 DB(migration 경로)의 스키마를 일치시키는 유일한 정답. 변경 범위가 schema.sql 1개 파일로 최소화된다. 기존 DB는 migration 008이 이미 적용되어 있으므로 영향 없음.

**옵션 B (미채택): migration 009를 새로 만들어 기존 DB에도 적용**

- 미채택 사유: 이미 migration 008로 컬럼이 있는 기존 DB에 "동일 컬럼 추가" migration을 실행하면 오류가 발생하거나 `IF NOT EXISTS` 처리가 필요해진다. 근본 원인은 schema.sql 누락이므로 거기서 수정하는 것이 맞다.

**옵션 C (미채택): Triple Extraction 기능 자체를 비활성화**

- 미채택 사유: 기능을 끄는 것은 해결이 아니다. Triple Extraction은 개별 episodic에서 semantic을 추출하는 핵심 파이프라인이며, Sleep Consolidation이 처리하지 못하는 케이스(클러스터 미형성)를 보완한다.

#### 측정 방법

```sql
-- 수정 후 Triple Extraction 성공 여부 확인
SELECT
  triple_extracted,
  triple_extracted_status,
  COUNT(*) AS count
FROM memory_item
WHERE type = 'episodic'
GROUP BY triple_extracted, triple_extracted_status;
```

수정 전: 이 쿼리 자체가 `no such column` 오류 발생.  
수정 후: `triple_extracted = 1, triple_extracted_status = 'success'` 행이 쌓여야 정상.

---

## 종합 측정 지표

문제 해결 전후를 비교하기 위한 핵심 지표 5개:

| 지표 | 쿼리/방법 | 목표 |
|------|-----------|------|
| **에피소딕 구조화율** | `SUM(is_consolidated) / COUNT(*)` WHERE type='episodic', 최근 30일 | ↑ (현재 ≈ 0%) |
| **Triple 추출 성공률** | `SUM(triple_extracted=1) / COUNT(*)` WHERE type='episodic' | ↑ (현재 = 0%) |
| **Consolidation 클러스터 효율** | `clusters_processed / clusters_found` FROM telemetry_events | ↑ (현재 ≈ 0%) |
| **Semantic 누적 증가율** | `COUNT(*)` WHERE type='semantic' 주간 증가량 | ↓ (병합 후 안정화) |
| **배치 WARN 발생 수** | 로그에서 `triple_extracted_status` 관련 WARN 카운트 | 0으로 수렴 |

---

## 측정 접근성 분석 및 보강 계획

### 현재 접근 가능한 측정 경로

위 5개 지표 중 **현재 기능(MCP 툴 / admin HTTP API)으로 직접 조회 가능한 것은 없다**.

| 지표 | 현재 접근 경로 | 한계 |
|------|--------------|------|
| 에피소딕 구조화율 | 없음 | `is_consolidated` 컬럼을 노출하는 툴이 없음 |
| Triple 추출 성공률 | 없음 | `triple_extracted` 컬럼을 노출하는 툴이 없음 |
| Consolidation 클러스터 효율 | admin HTTP `/admin/stats` (간접) | `consolidation.performed` telemetry_events를 MCP로 미노출 |
| Semantic 누적 증가율 | `get_telemetry_summary` → `type_distribution` (비율만) | 절대값·시계열 없음, 주간 추이 확인 불가 |
| 배치 WARN 발생 수 | 서버 로그 직접 확인 | 구조화된 쿼리 불가 |

현재는 모두 **SQLite DB 직접 접근**(sqlite3 CLI 또는 관리 스크립트)이 필요하다.

### 접근성 보강 옵션 검토

**옵션 A (채택): 기존 `get_telemetry_summary` + admin API에 지표 추가**

- `get_telemetry_summary` MCP 응답에 consolidation 품질 지표 블록 추가:
  - `consolidation_rate`: 최근 30일 에피소딕 중 `is_consolidated=1` 비율
  - `triple_extraction_rate`: 전체 에피소딕 중 `triple_extracted=1` 비율
  - `cluster_efficiency`: 마지막 `consolidation.performed` 이벤트의 `clusters_processed / clusters_found`
  - `semantic_count_7d`: 최근 7일 semantic 생성 건수 (누적 추이 기준점)
- admin HTTP API에 `/admin/stats/consolidation` 엔드포인트 추가:
  - 주간 semantic 생성 시계열
  - Triple Extraction 상태 분포 (`triple_extracted_status` 별 카운트)
  - 최근 N회 `consolidation.performed` 이벤트 요약

선택 사유: 지표를 AI 에이전트(MCP)와 운영자(HTTP admin) 모두가 조회할 수 있게 된다. 기존 `TelemetryRepository.queryMemoryQuality()`에 쿼리 추가만으로 구현 가능해 변경 범위가 작다. 해결 1~6 적용 후 효과를 정량적으로 검증하는 루프가 완성된다.

**옵션 B (미채택): DB 직접 쿼리 방식 유지**

- 미채택 사유: 측정을 위해 매번 서버에 접속해 sqlite3 CLI를 실행해야 한다. 자동화·모니터링 불가. AI 에이전트가 스스로 개선 효과를 확인할 수 없어 자기 교정 루프가 작동하지 않는다.

**옵션 C (미채택): 별도 측정 대시보드/스크립트 신설**

- 미채택 사유: 이미 `telemetry_events`, `telemetry_daily_metrics` 테이블과 admin API 인프라가 존재한다. 새 컴포넌트를 추가하는 것보다 기존 경로를 확장하는 것이 유지보수 비용이 낮다.

### 옵션 A 구현 범위 (코드 변경 예정)

```
변경 대상 1: TelemetryRepository.queryMemoryQuality()
  → is_consolidated 비율, triple_extracted 비율, semantic_count_7d 쿼리 추가

변경 대상 2: GetTelemetrySummaryTool (MCP)
  → memory_quality 응답 블록에 consolidation_quality 섹션 추가
  → 반환 필드: consolidation_rate, triple_extraction_rate,
               cluster_efficiency (마지막 run 기준), semantic_count_7d

변경 대상 3: admin HTTP API
  → GET /admin/stats/consolidation 엔드포인트 신설
  → 응답: weekly_semantic_counts (7주), triple_status_distribution,
           recent_consolidation_runs (최근 10회)
```

> ⚠️ 코드 변경은 해결 1~6 구현 이후 단계로 예정. 지표가 의미 있으려면 먼저 consolidation이 실제로 동작해야 한다.

---

## 구현 우선순위

문제들 사이의 의존성을 고려한 권장 순서:

```
1단계 — 기반 복구 (독립적, 영향 범위 최소):
  └─ 해결 6: schema.sql 수정 → Triple Extraction 즉시 복구

2단계 — 타이밍 수정 (낮은 리스크):
  └─ 해결 1: 스케줄러 주기 변경 + lookback 확장
           ⚠️ 단독 적용 시 semantic 중복 가속 — 3단계와 함께 배포 권장

3단계 — 중복 방지 (해결 1과 묶음 배포):
  └─ 해결 3: Sleep Consolidation semantic 병합 로직
           (이 단계 없이 2단계만 적용하면 semantic 중복 폭증 위험)

4단계 — 클러스터 조건 완화:
  └─ 해결 2: minClusterSize + 임계값 환경변수화
           (3단계 이후 적용해야 완화된 조건으로 늘어난 consolidation이 중복을 만들지 않음)

5단계 — 데이터 품질:
  └─ 해결 4: soft-delete 스키마 + 필터 적용 (마이그레이션 포함)
  └─ 해결 5: write-time dedup hint → 단계적 강화

6단계 — 측정 접근성 보강 (옵션 A):
  └─ get_telemetry_summary에 consolidation_quality 블록 추가
  └─ /admin/stats/consolidation 엔드포인트 신설
  ⚠️ 1~5단계 이후 적용: consolidation이 실제로 동작한 뒤 지표가 의미 있음
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
