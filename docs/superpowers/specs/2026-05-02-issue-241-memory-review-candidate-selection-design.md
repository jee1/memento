# 설계: 이슈 #241 — 중요 기억 리뷰 후보 산출 서비스

**상태**: 초안 (구현 전 검토)  
**날짜**: 2026-05-02  
**이슈**: [GitHub #241](https://github.com/jee1/memento/issues/241)  
**상위 맥락**: [GitHub #18](https://github.com/jee1/memento/issues/18) · 스키마·저장 모델은 [이슈 #240 설계](./2026-05-02-issue-240-memory-review-candidate-design.md)와 정합한다.

---

## 1. 배경·문제

`memory_review_candidate` 테이블(#240)이 준비되었으므로, **어떤 기억을 후보로 올릴지**를 `memory_item`과 `meta_memory_stats`만으로 결정하는 순수 산출 로직이 필요하다. 본 이슈는 조회·점수화·설명 문자열까지를 `@memento/core`에 두고, HTTP·배치·INSERT는 범위 밖으로 둔다.

---

## 2. 목표·비목표

### 2.1 목표 (#241)

- 후보 산출에 사용하는 **입력 row 타입**(DB JOIN 결과에 대응)을 TypeScript로 정의한다.
- 환경 변수 `MEMORY_REVIEW_IMPORTANCE_THRESHOLD`, `MEMORY_REVIEW_STALE_DAYS`, `MEMORY_REVIEW_MAX_CANDIDATES`를 읽어 **검증된 숫자 옵션**으로 주입 가능하게 한다(기본값·범위 검증 포함).
- 각 후보마다 **`priority`(REAL)**, **`reason`(짧은 설명 문자열)**, **`score_breakdown`(구조체)** 를 계산해 반환한다.
- **제외 규칙**: `pinned`, soft-deleted(`is_deleted`가 TRUE이거나 `deleted_at`이 NULL이 아님 — 구현 시 스키마에 맞게 하나의 일관 규칙으로 문서화), 이미 `memory_review_candidate`에 **`status = 'pending'`** 인 행이 있는 `memory_id`.
- **단위 테스트**: stale 일수 경계, importance 임계 경계, `priority`·`reason`·`score_breakdown`의 결정적(deterministic) 동작.

### 2.2 비목표 (#241)

- `memory_review_candidate`에 대한 **INSERT/UPDATE**, Admin HTTP, `BatchScheduler` Job, MCP 도구.
- 대시보드 UI, 하이브리드 검색·랭킹 공식 변경.
- `last_accessed` / `last_accessed_at`를 stale 판단에 사용하는 방식(#241 범위 밖; 아래 §3에서 고정).

---

## 3. “오래됨(stale)” 정의 (승인된 추천안)

- **회상 시각의 유일한 근원**: `meta_memory_stats.last_recalled_at` (ISO 문자열 또는 DB TIMESTAMP, 서비스에서는 UTC 기준으로 파싱).
- **`last_recalled_at`이 NULL**인 경우(통계 행 없음·한 번도 회상 집계 없음): **stale 앵커 시각**을 `memory_item.created_at`으로 둔다.  
  - 이유: NULL을 “무한히 오래됨”으로만 두면 **생성 직후 고중요 메모리**가 곧바로 후보에 들어가 MVP 노이즈가 커진다. “회상 이력이 없으면 생성 시점부터 경과 일수”로 stale를 잰다.
- **stale 일수**: `stale_days = floor( (now_utc - anchor_utc) / 1일 )` (일 단위 정수; 테스트에서는 고정 `now` 주입).
- **후보 조건**: `importance >= MEMORY_REVIEW_IMPORTANCE_THRESHOLD` **이고** `stale_days >= MEMORY_REVIEW_STALE_DAYS`.

`memory_item.last_accessed` / `last_accessed_at`는 본 서비스에서 **읽지 않는다**.

---

## 4. 접근 방식 비교·권장

| 접근 | 요약 | 장점 | 단점 |
|------|------|------|------|
| A. 단일 SQL | 필터·정렬·LIMIT까지 SQL | DB 부하 적음 | `reason`/`score_breakdown` 생성이 SQL에 비대해짐 |
| B. 전량 TS | 행 전부 로드 후 필터·점수 | 테스트 단순 | 대용량에서 메모리·이동 비용 |
| **C. 하이브리드 (권장)** | SQL로 JOIN·하드 필터·pending 제외까지, 상위 N 후보 윈도만 가져온 뒤 TS에서 `priority`/`reason`/`score_breakdown`·최종 정렬·`MAX` 적용 | 테스트·설명 필드에 유리, 쿼리는 단순 유지 | 윈도 크기를 합리적으로 잡아야 함(§7) |

**권장: C.** `score_breakdown`과 사람이 읽을 `reason`은 TypeScript에서만 생성한다.

---

## 5. 데이터 모델·타입

### 5.1 입력 row (`MemoryReviewCandidateSourceRow` 등 명명은 구현 시 일관되게)

최소 필드(이름은 구현에서 확정):

| 필드 | 출처 | 비고 |
|------|------|------|
| `memory_id` | `memory_item.id` | PK |
| `importance` | `memory_item.importance` | 0~1 |
| `pinned` | `memory_item.pinned` | TRUE면 제외 |
| `is_deleted` | `memory_item.is_deleted` | TRUE면 제외 |
| `deleted_at` | `memory_item.deleted_at` | NULL이 아니면 제외(soft delete) |
| `created_at` | `memory_item.created_at` | NULL 앵커용 |
| `last_recalled_at` | `meta_memory_stats.last_recalled_at` | LEFT JOIN; NULL 허용 |

### 5.2 출력 (`MemoryReviewCandidateSelectionItem`)

| 필드 | 타입 | 비고 |
|------|------|------|
| `memory_id` | string | |
| `priority` | number | 내림차순 정렬용(§6) |
| `reason` | string | 한 줄 요약(로캘은 구현에서 영문 고정 또는 프로젝트 관례 따름) |
| `score_breakdown` | object | §6.2 스키마 고정 |

서비스 반환 타입: `MemoryReviewCandidateSelectionItem[]` (길이 ≤ `MEMORY_REVIEW_MAX_CANDIDATES`).

---

## 6. 점수·우선순위·문구

### 6.1 `priority` (결정적·단조)

다음 **고정 공식**을 사용한다(구현·테스트가 동일해야 함):

- `stale_ratio = min(stale_days / max(MEMORY_REVIEW_STALE_DAYS, 1), 3)` — 상한 3으로 포화.
- `priority = importance * 1000 + stale_ratio * 100`

즉 importance가 우선이고, 동일 importance에서는 더 오래된 것이 위로 온다.

### 6.2 `score_breakdown` (JSON 직렬화 가능한 평면 객체)

필수 키:

- `importance` — 입력값
- `stale_days` — 정수
- `anchor_kind` — `'last_recalled_at' | 'created_at_fallback'`
- `threshold_importance` — 사용된 임계값
- `threshold_stale_days` — 사용된 일수 임계값

### 6.3 `reason`

기계 생성 한 줄. 예(영문 패턴 권장):  
`eligible: importance=0.82>=0.7, stale=45d>=14d, anchor=last_recalled_at`

---

## 7. 쿼리·윈도·상한

- **pending 제외**: `NOT EXISTS (SELECT 1 FROM memory_review_candidate c WHERE c.memory_id = memory_item.id AND c.status = 'pending')`.
- **JOIN**: `memory_item` LEFT JOIN `meta_memory_stats` ON `memory_id`.
- **하드 필터**: `NOT pinned`, soft-delete 제외 규칙은 §2.1과 동일, `importance >= threshold`.
- **윈도**: SQL 단계에서 `ORDER BY importance DESC, COALESCE(last_recalled_at, created_at) ASC` 등으로 상위 `K`행만 가져온 뒤 TS에서 `stale_days` 재계산·컷·`priority`·최종 `MAX_CANDIDATES` 적용.  
  - `K`는 `max(MEMORY_REVIEW_MAX_CANDIDATES * 10, 200)` 같은 상수로 두어 “stale 컷 후에도 MAX를 채울” 여유를 둔다(구현 주석으로 근거 명시).

---

## 8. 설정(환경 변수)

| 변수 | 의미 | 기본값 제안 | 검증 |
|------|------|-------------|------|
| `MEMORY_REVIEW_IMPORTANCE_THRESHOLD` | 최소 importance | `0.7` | 0~1 |
| `MEMORY_REVIEW_STALE_DAYS` | 최소 stale 일수 | `14` | 정수 ≥ 1 |
| `MEMORY_REVIEW_MAX_CANDIDATES` | 반환 최대 개수 | `50` | 정수 ≥ 1 |

파싱 실패 시: 서버 부트스트랩 정책에 맞게 **명시적 에러** 또는 **기본값 + 경고 로그** 중 하나를 택한다 — 구현 시 `MetaMemoryService` 등 기존 env 처리 패턴을 따른다.

---

## 9. 모듈 배치·의존성

- 위치: `packages/memento-core/src/domains/memory/services/` (파일명 예: `memory-review-candidate-selection-service.ts`).
- 의존: `better-sqlite3`의 `Database` 또는 기존 repository 추상화가 있으면 그에 맞춤. **도메인 순수 함수**(`computeStaleDays`, `computePriority`, `buildReason`)는 DB 없이 단위 테스트한다.
- 공개 API: `selectMemoryReviewCandidates(db, options)` 형태; `options`에 `now: Date`, 임계값·max(또는 env에서 읽은 값)를 넣어 테스트가 `now`를 고정한다.

---

## 10. 테스트 계획 (Vitest)

- `stale_days` 경계: `STALE_DAYS=14`, anchor가 정확히 13일 전 → 제외, 14일 전 → 포함.
- `importance` 경계: 0.699 제외, 0.7 포함.
- `pinned` / `is_deleted` / `deleted_at` / pending 행 각각 제외.
- `last_recalled_at` NULL → `created_at` 앵커로 stale 계산.
- `priority` 정렬: 동일 importance에서 stale 큰 것이 앞선다.
- `score_breakdown.anchor_kind` 값 검증.

---

## 11. 완료 조건 (이슈 본문과 매핑)

- `importance >= threshold` 이고 stale 일수 조건을 만족하는 메모리가 후보에 포함된다.
- pinned·soft-deleted·pending 후보는 제외된다.
- 각 항목에 `reason`과 `score_breakdown`이 채워진다.
- `npm test`에서 본 서비스 관련 스펙이 통과한다.

---

## 12. 다음 이슈(참고)

- 산출 결과를 `memory_review_candidate`에 **INSERT**(partial unique와 충돌 처리), Admin API, 스케줄러 Job 연동.

---

## 13. 출처

- [GitHub #241](https://github.com/jee1/memento/issues/241)  
- [GitHub #240](./2026-05-02-issue-240-memory-review-candidate-design.md)
