# Issue #279: sqlite-vec 임베딩 차원 불일치 (384 vs 512) — 설계

## 배경

- **증상**: `Dimension mismatch for query vector for the "embedding" column. Expected 384 dimensions but received 512.`
- **출처**: 앱 로그(memento-log-monitor), fingerprint `cdad787b8cb2b6e9`.
- **의미**: `MATCH`에 넘긴 쿼리 벡터 길이(512)가 선택된 vec0 테이블 스키마(`float[384]`)와 불일치.

## 원인 분석

### 1) 테이블 선택과 쿼리 벡터 정렬 파이프라인

`VectorSearchRepositoryImpl`(`search` / `hybridSearch`)은 다음 순서를 따른다.

1. `getExpectedDimensions(provider)` — provider별 **네이티브** 차원(예: `minilm`/`lightweight` 384, `tfidf` 512).
2. `getDominantStoredDimensions(provider)` — `memory_embedding`에서 해당 `embedding_provider`의 **가장 많은** `dimensions` 값.
3. `targetDimensions = actualStoredDimensions ?? expectedDimensions`.
4. `alignQueryVectorToStoredDimensions` — `vectorCompatibilityService.project`로 `targetDimensions`에 맞춤(패딩/축소 가능).
5. `getTableName(provider, targetDimensions)` → `getVectorTableName` (`sql-security-validator.ts`).

### 2) 결함 메커니즘

- `getVectorTableName`은 **`tfidf`/`lightweight` + dimensions === 384**일 때만 `memory_item_vec`(384)로 매핑하고, 그 외 `minilm`/`lightweight` 등은 `VECTOR_SEARCH_CONFIG.tableNames`의 **고정 테이블명**만 사용한다. **`dimensions` 인자가 테이블 스키마 차원과 함께 검증되지 않는다.**
- 따라서 `memory_embedding.dimensions`에 **오염·레거시·혼재**로 인해 우세값이 **512**처럼 잘못 잡히면:
  - `targetDimensions`가 512가 되고,
  - 네이티브 쿼리 벡터(384)는 `expectedDimensions`(384)와 길이가 같아 `align`의 조기 `null` 분기에 걸리지 않고 **512로 확장(예: zero-pad)** 될 수 있으며,
  - `getTableName('minilm', 512)` / `getTableName('lightweight', 512)`는 여전히 **384차원 vec0** 테이블(`memory_item_vec_minilm`, `memory_item_vec`)을 가리킨다.
- 결과: **384 스키마 테이블 + 512 길이 MATCH 인자** → 이슈와 동일한 sqlite-vec 오류.

`tfidf`는 dimensions에 따라 `memory_item_vec`(384) vs `memory_item_vec_tfidf`(512)로 분기되어 상대적으로 덜 취약하다.

### 3) 운영에서 우세 차원이 어긋나는 경우

- 과거 TF-IDF 차원 변경(384→512) 등으로 메타데이터와 실제 벡터/트리거 경로가 어긋난 행.
- `dimensions` 컬럼 백필/마이그레이션 전후 불일치.
- 수동 DB 조작 또는 버그로 `embedding_provider`와 `dimensions` 불일치.

## 목표

- provider별 **실제 vec0 테이블 스키마**와 **MATCH 쿼리 벡터 길이**를 항상 일치시킨다.
- 레거시 `tfidf` 384/512 혼재 처리 의도는 유지한다.

## 대안

### A) `targetDimensions`를 provider별 네이티브 테이블 차원으로 상한 클램프

- `targetDimensions = min(dominantOrExpected, nativeVecDimForProvider)` 형태로, `minilm`/`openai`/`gemini`/`lightweight`는 설정상 고정 차원을 상한으로 둔다.
- **장점**: 변경 범위가 repository 한곳에 집중 가능.
- **단점**: `nativeVecDimForProvider`를 한곳에서 단일 진실로 유지해야 함(이미 `VECTOR_SEARCH_CONFIG.providerDimensions` 존재).

### B) `getDominantStoredDimensions` 오버라이드를 `tfidf`(및 필요 시 `lightweight`)에만 적용

- 레거시 분기 의도에 맞게, **고정 스키마 provider**는 `targetDimensions = expectedDimensions`(또는 테이블 스키마 차원)만 사용하고 dominant는 무시한다.
- **장점**: 의도가 명확하고 회귀 범위가 작다.
- **단점**: 향후 “저장 차원 기반 테이블 선택”이 다른 provider에 필요해지면 재검토 필요.

### C) DB 정리(데이터 수정)만으로 해결

- 잘못된 `dimensions` 행 수정·재임베딩.
- **장점**: 코드 변경 없음.
- **단점**: 근본적으로 **코드가 잘못된 메타데이터에 취약**한 상태는 남음; 재발 가능.

## 권장안

**B + A의 결합(우선 B)**: 고정 vec 테이블 provider(`minilm`, `openai`, `gemini`, `lightweight`)에서는 **저장 우세 차원으로 테이블/쿼리 차원을 바꾸지 않는다**. `tfidf`에 한해 기존 dominant 기반 `memory_item_vec` vs `memory_item_vec_tfidf` 선택을 유지한다. 구현 시 `targetDimensions` 결정 직후 **provider별 스키마 상한 클램프**를 한 줄로 이중 방어해도 된다.

## 테스트·검증

- `vector-search.repository.spec.ts`에 이미 유사 시나리오(384 저장 + 512 쿼리, 투영)가 있음 — **minilm/lightweight + dominant 512 + 네이티브 384 쿼리** 케이스를 추가해 sqlite 오류 0건·결과 일관성을 고정한다.

## 범위 밖

- 대규모 임베딩 재생성 마이그레이션(별도 이슈).
- `vector-performance.repository`의 테이블/검증 차원 불일치(별도; 본 이슈와 메시지 방향이 다를 수 있음).

## 승인 후 다음 단계

- `writing-plans` 스킬에 따라 구현용 `tasks`/계획 문서 작성 후 코드 수정.
