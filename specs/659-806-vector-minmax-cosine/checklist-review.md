# Code Review: 벡터 유사도 절대 척도 복원 (#806)

**Date**: 2026-08-29 | **Branch**: `659-806-vector-minmax-cosine` | **Reviewer**: inline (superspec review)
**Scope**: 미커밋 작업 트리 전체 (프로덕션 5 + 문서 1 + 신규 5)

> **서브에이전트 디스패치 미적용 사유**: `requesting-code-review` 스킬은 `BASE_SHA`/`HEAD_SHA` 기반으로 리뷰어를 디스패치한다. 이 작업은 아직 커밋이 없어 SHA 범위를 만들 수 없다. built-in 리뷰 프로토콜(명세 준수 · 엣지 케이스 · 헌법 준수 · 코드 품질 · 검증 커버리지)로 대체했다.

## 요약

| 심각도 | 건수 |
|--------|------|
| Critical | 0 |
| Important | 2 |
| Suggestion | 3 |

품질 게이트는 모두 통과했다: lint / type-check / 전체 테스트(479 files, 5145 passed, 1 skipped) / graphify 재빌드.

---

## Important

### I-1. 정상 경로 결과 객체에 타입에 없는 `score` 필드가 남아 있다 (신뢰도 92)

**위치**: `packages/memento-core/src/domains/search/algorithms/hybrid-search-provider-parallel.ts:118`

```ts
      results: vecResults.map(result => ({
        ...
        score: result.similarity,     // ← VectorSearchResult 에 더 이상 없는 필드
        similarity: result.similarity,
```

**문제**: 이번 작업에서 `VectorSearchResult`(memory-embedding-service.ts:29~) 의 `score` 필드를 제거했고 대체 경로 매퍼도 더 이상 채우지 않는다. 그런데 정상 경로는 여전히 이 필드를 채운다. 결과적으로 **같은 타입으로 선언된 객체가 경로에 따라 서로 다른 형태를 갖는다** — 정상 경로에는 `score`가 있고 대체 경로에는 없다.

값의 방향은 같으므로 FR-024의 문언(“방향이 다른 필드의 공존 금지”)을 위반하지는 않는다. 그러나 **경로별로 필드 구성이 갈라지는 상태 자체가 이번에 고친 결함의 발생 조건**이었다. 타입에 선언되지 않은 필드라 향후 독자가 `result.score`를 읽으면 한쪽 경로에서만 값이 나온다.

**권장**: 118행 삭제. 값이 `similarity`와 동일하고 읽는 생산 코드가 0건임을 확인했다(type-check 통과, grep 결과 소비자 없음). 다만 이 파일은 plan.md가 정한 변경 대상 6곳 밖이므로 승인 후 반영한다.

### I-2. SC-003에 대응하는 검증이 없다 (신뢰도 95)

**위치**: `specs/659-806-vector-minmax-cosine/tasks.md` Requirements Traceability (`SC-001~SC-004 | T004`)

**문제**: T004는 SC-001·SC-002·SC-004·SC-012를 덮지만 **SC-003(“정확히 맞는 기억이 있는 쿼리 집합과 없는 쿼리 집합의 최상위 점수 분포가 구분된다”)에 해당하는 케이스가 없다.** 추적표가 SC-003을 T004에 매핑해 두었으므로 커버된 것처럼 보이지만 실제로는 비어 있다.

**권장**: 둘 중 하나를 택한다.
- (a) 실행 지점 검증에 “관련 쌍(높은 유사도 대역)”과 “무관 쌍(낮은 유사도 대역)” 합성 픽스처를 넣어 두 집단의 최상위 점수 범위가 겹치지 않음을 단언한다.
- (b) SC-003을 단위 검증 대상이 아니라 **평가 성격의 기준**으로 명시하고, 재배포 불가 코퍼스를 쓰는 로컬 측정에서 확인한다는 사실을 `progress.yml`과 추적표에 적는다(명세 Q15가 정한 방식과 일치).

권장은 (b)다. 절대 척도 복원 후 분포 구분은 코퍼스 품질에 좌우되며, 합성 픽스처로 단언하면 “주입한 값이 그대로 나온다”는 동어반복이 되기 쉽다.

---

## Suggestion

### S-1. 하이브리드 질의 SQL의 변환 산술 분할 (신뢰도 88)

**위치**: `packages/memento-core/src/domains/search/repositories/vector-search/vector-search-hybrid-query.ts:220, 286`

`COALESCE(1 - vs.vector_distance, 0)` 으로 SQL에서 변환 산술을 수행하고 매퍼는 clamp만 적용한다. FR-020의 “단일 정의” 관점에서는 변환이 두 곳으로 쪼개져 있다. 정상 동작하는 경로이고 자체 검증도 있으며 plan.md의 변경 대상 밖이므로 이번에는 손대지 않았다. `progress.yml`의 잔여 항목 R1으로 추적 중.

### S-2. import 정렬 (신뢰도 85)

`memory-embedding-service.ts`에서 `vector-similarity.js` import가 `sql-security-validator.js` 앞에 삽입됐다. lint는 통과하지만 파일 내 다른 import는 대체로 알파벳 순이다. 정렬 규칙이 강제되지 않는 저장소이므로 선택 사항.

### S-3. 커밋 분할이 아직 이뤄지지 않았다 (신뢰도 90)

작업 트리에 `.specify/` 4파일(이전 `/speckit.constitution` 실행분)과 이번 구현이 함께 있다. 두 변경은 성격이 달라 같은 커밋에 들어가면 이력이 흐려진다. 커밋 시 분리를 권장한다.

---

## 통과 확인 항목

### 명세 준수

| 요구사항 | 확인 |
|----------|------|
| FR-001~FR-004 (절대 척도·결과셋 독립·1건 대 다건) | 검증 통과. `normalizedScore` 식별자 완전 소멸 |
| FR-005 (임계값 선행 순서) | 검증으로 고정 |
| FR-006 (보충 후보 절대 점수) | 정상·대체 경로 양쪽 검증 |
| FR-007/FR-008 (제공자 간 최댓값·결과셋 무관) | 검증 통과 |
| FR-009/FR-018 (표시 문구) | 결합기 **코드 변경 0**, 검증만 추가 — 설계 예측대로 |
| FR-011/FR-016/FR-024 (경로 간 척도·방향) | 대체 경로 SQL·타입·매퍼 정리 완료 |
| FR-012/FR-017 (범위·유한성) | 공용 변환의 clamp + `rankResults`의 명시적 clamp01 |
| FR-013/FR-019 (문서 일치·시점 기록) | `docs/agents/search-ranking.md` 갱신 |
| FR-015 (동결) | 임계값·가중치·프리페치·보충 값 변경 0건 |
| FR-020 (변환 단일화) | `shared/utils/vector-similarity.ts` 신설, 기존 매퍼는 재노출. 단 S-1 참고 |
| FR-021 (응답 형태 불변) | 전 워크스페이스 type-check 통과, MCP 계약 검증 통과 |
| FR-022 (필터 무변경) | diff 0건 확인 |
| FR-023 (랭킹 버전) | `facf592be6bb` → `4c46798e80ab` |

### 헌법 준수

| 원칙 | 판정 |
|------|------|
| I 테스트 우선 | **준수.** RED를 실측했다 — T004 `expected 1 to be less than 0.4`(이슈 증상 재현), T010 `similarity undefined`(방향 결함). T002만 무동작 리팩터로 기존 검증이 baseline |
| II 하위 호환 | 준수. 필드 이름·타입·범위 불변, 값 분포 변경은 plan.md 호환성 노트와 기준 문서에 기록 |
| III 스키마·마이그레이션 | 해당 없음. 스키마 변경 0 |
| IV 품질 게이트 | 준수. lint·type-check·test 통과, graphify 재빌드 후 리포트 확인, `graphify-out/` 미추적 |
| V 관측성·실패 격리 | 준수. 기존 검색 단계 로깅 유지, 대체 경로 분기 구조 불변 |
| 추가 제약 | 준수. 합성 픽스처만 사용, 보안·권한 범위 변경 0 |

### 검증 커버리지

신규 22건: 공용 유틸 6 · 실행 지점 10 · 임베딩 서비스 3 · 결합기 3. 기존 매퍼 검증 11건은 **한 줄도 고치지 않고** 통과해 리팩터가 동작을 바꾸지 않았음을 보인다.

### 리뷰 중 확인한 비결함

- `deduplicateByMaxSimilarity`의 동점 처리는 먼저 발견된 항목을 유지한다. 교정 전과 동일한 의미이므로 회귀 아님
- `rankResults`의 `clamp01`은 중복처럼 보이나 SC-012가 범위 밖 원시값을 주입해 실제로 검증한다
- 전체 테스트 1차 런의 `error-logging-service` 타임아웃은 동시 부하 탓이다. 격리 실행 19.2s(예산 30s) 통과, monitoring 도메인 미접촉

---

**결론: 머지 가능. Critical 0건.**

## 조치 결과 (2026-08-29, 리뷰 직후)

| 항목 | 상태 | 내용 |
|------|------|------|
| I-1 | **fixed** | `hybrid-search-provider-parallel.ts:118`의 `score: result.similarity,` 삭제. 정상·대체 경로의 결과 객체 형태가 일치한다. 검증 76 files / 1000 tests 통과 |
| I-2 | **resolved** | 권장안 (b) 채택. SC-003을 평가 성격 기준으로 명시하고 `tasks.md` 추적표와 `progress.yml`에 측정 방식(로컬 코퍼스 측정, 집계·해시만 기록)을 남겼다 |
| S-1 | 추적 | `progress.yml` 잔여 항목 R1으로 유지. 정상 동작 경로이며 이번 범위 밖 |
| S-2 | 미조치 | 정렬 규칙이 강제되지 않는 저장소. lint 통과 |
| S-3 | **done** | `.specify/` 변경과 구현을 분리해 커밋 |
