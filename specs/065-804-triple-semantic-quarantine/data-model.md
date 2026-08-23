# Phase 1 데이터 모델: 자동 triple semantic 격리

**Plan**: [plan.md](./plan.md) | **Date**: 2026-08-22

**스키마 변경은 없다.** 이 작업은 기존 행을 지울 뿐 테이블·컬럼·인덱스를 만들지 않는다
(헌법 III 해당 없음). 따라서 이 문서는 두 가지를 정의한다 — **대상 집합의 경계**와 **러너가
만드는 산출물의 스키마**.

---

## 1. 집합 정의

### 1.1 격리 대상 (Target)

```sql
type = 'semantic'
AND subject IS NOT NULL AND subject <> ''
AND pinned = FALSE
AND substr(content, 1, length(trim(subject))) = trim(subject)
AND substr(content, length(trim(subject)) + 2, 1) = ' '
```

2026-08-22 실측 **24,086건**. 마지막 두 줄이 본문 형태 (1) 판정이며 `LIKE`를 쓰지 않는
이유는 research 확인 2에 있다.

### 1.2 본문 형태 (Content Form)

`tripleToNaturalLanguage`의 세 분기에 대응한다.

| 형태 | 정의 | 판정 | 실측 | 처리 |
|---|---|---|---:|---|
| (1) 템플릿 | `buildTripleSentence` 성공 | 위 위치 비교 통과 | 24,086 | **격리** |
| (2) 원문 폴백 | 재조립 실패 + 폴백 존재 | (1)·(3) 어느 쪽도 아님 | 116 | 보존 |
| (3) `·` 조인 | 재조립 실패 + 폴백 없음 | `content = subject‖' · '‖predicate‖' · '‖object` | 0 | 보존 |

형태 (2)는 본문이 사람이 쓴 원문이라 검색 가치가 있어 제외한다(FR-001b). 월별 폴백률이
2026-05 0.0% → 08 **11.6%**로 급증 중이므로 제외 근거의 유효 기간을 dry-run이 추적한다(FR-001c).

### 1.3 보존 대상

- episodic(3,431) / procedural(238) / working — 전량
- `subject`가 비어 있는 semantic
- 형태 (2)·(3) semantic 116건
- `pinned = TRUE`인 항목 (실측 0건이나 조항 유지)
- `project_id`·`owner_id`가 지정됐거나 `privacy_scope`가 `team`·`public`인 기억
  (실측상 대상에 0건 — 판별식이 자연히 제외)

### 1.4 연쇄 영향 (실측)

| 대상 | 처리 | 행 수 |
|---|---|---:|
| `memory_relation` | CASCADE | **54,742 / 62,289 (88%)** |
| `memory_embedding` | CASCADE | 24,086 |
| `memory_review_candidate` | CASCADE | 3,609 / 5,300 |
| `meta_memory_stats` | CASCADE | 66 |
| `feedback_event` | CASCADE | 10 |
| `memory_item_tag`·`memory_link`·`memory_provenance` | CASCADE | 0 |
| `kg_triple` | SET NULL | 24,086 (행 보존) |
| `anchor` | SET NULL | ≤3 |
| `memory_forgetting_event` | **FK 없음** → 러너가 정리 | **225,601 / 278,846** |
| `event_outbox` | 러너가 정리 | 실행분 전량 (현재 0행) |

`memory_relation` 54,742행은 **전부 한쪽 끝만 대상**이며 반대편은 생존 기억이다. `kg_triple`이
보존하지 않는 정보이므로 격리 전에 내보낸다(FR-006i).

---

## 2. 산출물 스키마

전부 `.local/quarantine-065/` 아래에 두고 **커밋하지 않는다**(FR-006b).

### 2.1 `dry-run-report.md`

| 항목 | 근거 조항 |
|---|---|
| 대상 건수 · 타입 분포 · importance 구간 분포 | FR-003 |
| 본문 형태별 전수 집계 (1)(2)(3) | FR-002g |
| 형태 (2) 월별 생성 추이 | FR-001c |
| 오탐 전수 검증 결과 (2방식 교차) | FR-002j |
| 표본 A 50건 (`ORDER BY random()`) | FR-002d |
| 코퍼스 대조: 대상 ∩ episodic·procedural = 0 | FR-004 (a) |
| `kg_triple` 보존율 | FR-004 (b), SC-004a |
| `kg_triple` predicate 정규화 지표 | FR-004d |
| 형태 (2)의 원본 episodic 생존 여부 | FR-004c |
| 귀속 분포 (`project_id`·`owner_id`·`privacy_scope`·`is_deleted`) | FR-001d |
| 격리 제외 pinned 목록 | FR-001a |
| SET NULL 될 참조별 행 수 | FR-006a |
| 고아가 될 `memory_forgetting_event` 행 수 | FR-006d |
| 리허설 소요 시간 | FR-006c, SC-007a |

### 2.2 `relations.jsonl` (FR-006i)

한 줄에 한 관계. 본문 없이 식별자만.

```json
{"target_id":"mem_…","relation_type":"extracted_from","other_id":"mem_…","other_type":"episodic"}
```

약 54,742행. `extracted_from` 25,069건이 **재추출 복구 경로**의 근거다(FR-006l).

### 2.3 `progress.jsonl` (FR-005b)

배치 단위 한 줄.

```json
{"batch":17,"at":"2026-…","ok":["mem_…"],"failed":[{"id":"mem_…","error":"…"}]}
```

재개는 판별식 재평가로 이뤄지므로 커서가 아니라 **감사 기록**이다.

### 2.4 `before.json` / `after.json` (FR-003a)

질의 10개를 사본 A·B에 각각 한 번씩 돌린 결과.

```json
{"query":"…","returned":[{"id":"mem_…","type":"semantic","form":1}]}
```

`form`은 §1.2 분류. SC-001은 after에 형태 (1)이 0건일 것을, SC-001a는 사람이 쓴 기억의 비율이
before 대비 상승할 것을 요구한다.

---

## 3. 상태 전이

```text
대상 행:  존재 ──forget(hard)──► 삭제
                                  ├─ CASCADE 9종 자동
                                  ├─ SET NULL 5종 참조만 NULL
                                  └─ FK 없음 2종 → 러너가 정리

출처 episodic:  triple_extracted=1  ──격리──►  triple_extracted=1 (불변)
                                                 └─ 재추출 스킵 (FR-006k, 의도됨)
                                                    복구는 relations.jsonl로 (FR-006l)
```
