# MCP Tool Contracts: Recall Quality Feedback Loop

**Date**: 2026-03-26

---

## 1. recall 도구 변경 (기존 도구 확장)

### 변경 사항
`include_score_breakdown` 파라미터 추가. 기존 파라미터·응답 형식 불변 (하위 호환).

### 추가 입력 파라미터

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `include_score_breakdown` | boolean | false | true 시 각 결과 항목에 score_breakdown 포함 |

### `include_metadata`와 `score_breakdown`

- `include_metadata=false`이면 메타데이터 블록 전체가 생략되며, **`score_breakdown`도 포함되지 않음** (`include_score_breakdown=true`여도 동일).
- `include_metadata=true`이고 `include_score_breakdown=true`일 때만 항목에 `score_breakdown`이 붙는다.

### 응답 형식 변경 (include_metadata=true ∧ include_score_breakdown=true 시)

```json
{
  "items": [
    {
      "memory_id": "mem_xxx",
      "content": "...",
      "final_score": 0.82,
      "score_breakdown": {
        "relevance":           { "score": 0.42, "pct": 51 },
        "recency":             { "score": 0.14, "pct": 17 },
        "importance":          { "score": 0.16, "pct": 19 },
        "usage":               { "score": 0.08, "pct": 10 },
        "feedback":            { "score": 0.04, "pct": 5  },
        "duplication_penalty": { "score": 0.02, "pct": 2  },
        "total": 0.82
      }
    }
  ]
}
```

각 슬롯의 `pct`는 최종 `total`의 절대값 대비 해당 슬롯 `score` 기여 비율을 **가장 가까운 정수 백분율로 반올림**한 값이다(API는 `number`이나 표시·계약 예시는 정수).

**구현**: `@memento/core` `SearchRanking#calculateFinalScoreAndBreakdown`(`search-ranking.ts`)는 각 슬롯에 대해 `pct = Math.round((100 × 슬롯 score) / |total|)`와 동등한 값을 부여한다(`|total|`이 극소일 때는 0으로 나눔 방지용 최소 분모를 쓴다).

`include_score_breakdown=false`(기본) 또는 `include_metadata=false` 시 항목에 `score_breakdown` 필드 없음.

#### `relevance` 슬롯(복합 기여)

`score_breakdown.relevance`의 `score` / `pct`는 **순수 “α × 벡터 유사도”만**이 아니다. 최종 랭킹과 6슬롯 합산을 맞추기 위해 구현이 다음을 **동일 필드에 합산**한다: 가중 적용 후 관련성(벡터 유사도와 consolidation 블렌딩), **관계 가중치(`relation_weight`)**, **절차 메모리 부스트(`procedural_boost`)**, **프로세스 적합도(`process_attribute_fit`)**. 나머지 슬롯(recency, importance, usage, feedback, duplication_penalty)은 공식의 대응 항과 1:1에 가깝다.

---

## 2. feedback 도구 (신규 MCP 도구)

### 설명
recall 결과에 대해 helpful/not_helpful 피드백을 제출한다. **FR-004(비동기 저장)**: MCP 도구는 독립적으로 호출되며, 에이전트/클라이언트가 recall 응답 처리 **이후** 비동기로 호출하는 패턴을 권장한다(도구 자체는 recall과 결합하지 않음).

### 입력 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `memory_id` | string | ✅ | 피드백 대상 기억 ID |
| `helpful` | boolean | ✅ | true=helpful, false=not_helpful |
| `comment` | string | ❌ | 선택 코멘트 (`@memento/client.feedback()`과 동일) |
| `score` | number | ❌ | 선택 점수 |
| `score_breakdown` | object | ❌ | recall 항목의 `score_breakdown`과 동일 구조의 스냅샷(US3: not_helpful 시 낮은 요소 맥락). DB `feedback_event.score_breakdown_json`에 JSON으로 저장 |
| `session_id` | string | ❌ | MCP 세션 ID (출처 추적) |
| `agent_id` | string | ❌ | 에이전트 식별자 |

HTTP 연동 시 `@memento/client`의 `feedback(memory_id, helpful, comment?, score?, score_breakdown?, options?: FeedbackCallOptions)`에서 `session_id`·`agent_id`를 선택적으로 보내면 위 MCP 파라미터와 동일하게 저장된다(FR-002). 5번째 인자는 `score_breakdown`으로 두어 `feedback(id, h, comment, score, breakdown)` 호출이 자연스럽게 동작하고, 출처 추적은 6번째 `options`로 전달한다.

### 응답 형식 (`@memento/client` FeedbackResult와 정합)

```json
{
  "success": true,
  "memory_id": "mem_xxx",
  "feedback_id": "42",
  "helpful": true,
  "created_at": "2026-03-27T12:00:00.000Z"
}
```

`feedback_id`는 문자열, `created_at`은 DB에 기록된 타임스탬프(ISO 8601 문자열).

### 오류 처리

| 케이스 | 응답 |
|--------|------|
| memory_id 존재하지 않음 | `{ "success": false, "error": "memory not found" }` |
| 저장 실패 | `{ "success": false, "error": "storage error" }` — recall은 영향 없음 |

---

## 3. CLI 스크립트 인터페이스

### 3.1 카테고리 매핑 검증

```bash
npm run quality:benchmark:verify-categories
# 출력: 각 쿼리의 category → macro_category 매핑 결과 + 누락 경고
```

### 3.2 카테고리별 품질 리포트

```bash
npm run quality:benchmark:category-report
# 출력 예시:
# macro_category | queries | MRR | NDCG@5 | NDCG@10 | MRR>=0.5
# episodic_recent   |       4 | 0.72  |  0.68  |   0.71  | PASS
# procedural        |       6 | 0.41  |  0.38  |  0.40   | FAIL
```

**SC-006 (30초)**: 본 명령 실행 시 벤치마크 DB **시드 완료 후** `collectCategoryMetrics`부터 리포트 출력까지의 **스크립트 구간 벽시계**만 상한을 적용한다. 체크아웃·`npm ci`·전체 테스트 등 CI 워크플로 누적 시간은 이 자동 게이트 범위에 포함되지 않는다(`spec.md` SC-006).

### 3.3 A/B 가중치 비교

```bash
npm run quality:benchmark:compare-profiles -- --profile-a default --profile-b feedback-heavy
# JSON stdout: ABComparisonReport (profile_a_mrr, profile_b_mrr, p_value, significant, verdict, …)
```

스크립트는 **통계 리포트와 verdict만** stdout으로 내며, `config/ranking-weights.toml` 또는 `config/ranking-profiles/*.toml`을 **자동으로 수정하지 않는다**(오프라인 A/B 범위; `spec.md` Assumptions).

#### 프로파일 승격 → CI·런타임 기준선 (수동 운영)

1. `compare-profiles`로 `verdict`가 `a_better` 또는 `b_better`인지, `significant`·`p_value`를 확인한다.
2. 우승 프로파일 TOML(예: `config/ranking-profiles/feedback-heavy.toml`)의 가중치를 **`config/ranking-weights.toml`에 반영**한다(프로젝트 단일 소스; 필요 시 `default.toml`과 내용 동기화).
3. 변경을 PR로 리뷰·머지한다. **CI의 카테고리 리포트·벤치마크는 머지 후 커밋의 `ranking-weights.toml`을 읽는다**고 가정한다 — “자동 승격”은 저장소 설정 커밋으로 완료된다.

---

## 4. 구현 단일 소스 (모노레포)

- **도메인·도구·스키마의 규범(canonical) 구현**은 `packages/memento-core`이다.
- 루트 `src/domains/memory/tools/feedback-tool.ts` 등은 `@memento/core`를 **재내보내기**하여 HTTP(memento-dev)와 패키지가 동일 구현을 쓰도록 한다. 스키마·마이그레이션 변경 시 **core와 루트 `src/infrastructure/...` 복제본**을 함께 갱신해 드리프트를 막는다.

---

## 5. 마이그레이션 번호 참고

- TS 러너 마이그레이션: `packages/memento-core/src/infrastructure/database/database/migration/migrations/0NN-*.ts` (순차 버전).
- SQL 참고 스크립트: `.../database/migrations/00N_*.sql` — 번호 체계가 TS와 별도이지만, 파일 헤더 주석에 대응하는 TS 마이그레이션 이름을 적어 두었다.
