# 설계: 이슈 #183 — Triple 추출 `triple_extracted_status` 빈 문자열 고착

**상태**: 브레인스토밍 확정 (구현 전)  
**날짜**: 2026-04-18  
**이슈**: [GitHub #183](https://github.com/jee1/memento/issues/183) — Fix flaky AriGraph remember-tool test when triple extraction job leaves empty status

## 1. 배경

전체 `npm test` 중 `remember-tool` AriGraph 경로 테스트가 간헐적으로 실패한다. 단언은 `memory_item.triple_extracted_status`가 `success` 또는 `failed`와 일치하기를 기대하지만, 관측값이 빈 문자열 `''`로 남는 경우가 있다.

이슈 조사에 따르면 이 실패는 HTTP 신뢰 경계(issue-161) 변경과 무관한 **레거시/비동기·상태 전이** 문제로 보인다.

## 2. 목표

1. **프로덕션 (1순위)**: Triple 추출 작업이 실행되는 경로에서, 처리 시도 후 `triple_extracted_status`가 **`''`로 무기한 고착되지 않도록** 한다. 최종 상태는 기존 PRD 규칙(`success` / `failed` / `abandoned` 및 배치 재시도 정책)을 따른다.
2. **테스트·보조 (2순위)**: `remember-tool.spec.ts`의 대기·단언이 CI·로컬에서 **결정적으로** 통과하도록 필요한 만큼만 보강한다(과도한 슬립 남용은 지양).

## 3. 비목표

- Triple 추출 알고리즘(AriGraph/LLM) 자체의 품질 개선.
- 스키마 마이그레이션 또는 `memory_item` 컬럼 타입 변경(이슈 범위 밖이면 제외).
- `triple_extracted_status`에 새로운 비즈니스 상태값 대량 추가.

## 4. 근본 원인(가설)

`remember-tool.ts`에서 Triple 추출 비동기 작업은 먼저 `triple_extracted_status`를 `in_progress`로 바꾸는 `UPDATE`로 **작업 선점**을 시도한다. 이때 `WHERE` 조건이 **`triple_extracted_status IS NULL`** 만 허용한다.

SQL에서 **`''`(빈 문자열)는 `NULL`이 아니다.** 따라서 행의 상태가 `''`이면 `UPDATE`는 0행이 되고, 코드는 “이미 진행 중이거나 완료”로 간주하고 **조기 `return`** 한다. 그 결과 추출 본문이 실행되지 않고 **`''`가 유지**될 수 있다.

배치 쪽 `triple-extraction-batch-job.ts`의 `getTargetMemories`는 이미 `triple_extracted_status === ''`를 미처리로 취급한다. **동일한 “미처리” 의미를 remember 경로의 선점 쿼리와 맞출 필요가 있다.**

## 5. 결정

### 5.1 권장 변경 (프로덕션)

- `in_progress` 선점 `UPDATE`의 `WHERE` 절을 다음 의미로 확장한다:  
  **`triple_extracted_status`가 `NULL`이거나 빈 문자열 `''`인 경우**에만 선점한다.

예시(의미):

```sql
WHERE id = ?
  AND (triple_extracted_status IS NULL OR triple_extracted_status = '')
```

- 동일 파일 내 동일 패턴의 `WHERE`가 더 있으면 같은 원칙으로 정리한다. (현재 `remember-tool.ts`에서는 해당 선점 쿼리 한 곳이 핵심이다.)

### 5.2 보조 (테스트)

- 기존 폴링 루프는 `success` / `failed` 도달까지 대기하는 구조를 유지한다.
- 필요 시에만: JobQueue/스케줄러가 테스트에서 **드레인** 가능한 API가 있으면 호출하거나, 타임아웃을 **소폭** 조정한다. (1순위 수정 후에도 플레이크가 남을 때만.)

## 6. 검증

- `packages/memento-core` 대상 단위 테스트 및 `remember-tool` 관련 스펙 통과.
- 이슈 본문에 적힌 전체 스위트 커맨드(루트 `.env` 로드, `HOME=/tmp/memento-home` 등)로 재검증 권장.

## 7. 위험 및 완화

- **`in_progress`와의 구분**: 선점 조건을 넓히면 안 되는 경우는 `success` / `failed` / `abandoned` / `in_progress` 등 **이미 의미 있는 값**이 설정된 경우다. 본 설계는 **`NULL`과 `''`만** “미처리에 가깝다”고 보정하는 최소 변경이다.
- **회귀**: `enable_triple_extraction=false` 등 **의도적으로 NULL 유지**하는 시나리오는 기존 테스트로 보호된다.
