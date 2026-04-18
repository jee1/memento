# 설계: 이슈 #163 — EmbeddingMigrationService `execute` / `rollback` 리팩터링

**상태**: 브레인스토밍 확정 (구현 전)  
**날짜**: 2026-04-18  
**이슈**: [GitHub #163](https://github.com/jee1/memento/issues/163) — `execute()` 분리(238줄, complexity 38), `rollback()` 단순화, 중첩 깊이 개선  

**작업 브랜치·워크트리**: `issue/163-embedding-migration-refactor` — 로컬 경로 `.worktrees/issue-163-embedding-migration-refactor/` (`.cursorignore`에 포함될 수 있음 → 해당 폴더를 별도로 열거나 예외 처리)

---

## 1. 배경·문제

| 항목 | 현황(이슈 기준) |
|------|-----------------|
| `execute()` | ~238줄, cyclomatic complexity ≈ 38 |
| `rollback()` | ~62줄, complexity ≈ 15 |
| 익명 함수(`processBatch` 등) | ~82줄, complexity ≈ 13 |
| 최대 중첩 깊이 | 7 |

**파일**: `packages/memento-core/src/domains/embedding/services/embedding-migration-service.ts`

---

## 2. 목표·비기능

### 2.1 동작

- **공개 API**(`execute`, `rollback`, `createPlan`, `listTargets`, `listHistory` 등)와 **관찰 가능한 동작**은 기존과 동일해야 한다.
- 행 단위 오류 처리, `dryRun`, `autoRollbackOnFailure`, 진행 콜백·모니터, `migrationHistoryService.recordHistory` 호출 조건은 **의도적으로 변경하지 않는다**.

### 2.2 구조·품질 (1단계: 동일 파일)

**전략 (브레인스토밍 확정)**: **하이브리드** — 오케스트레이션 단계형 private + 행/배치 처리를 이름 있는 private으로 분리; `rollback`은 DELETE/RESTORE를 짧은 private으로 분할.

**수치 목표 (이름이 붙은 각 메서드 단위)**:

| 메트릭 | 목표 |
|--------|------|
| 메서드당 줄 수 | **~50줄 이하** (가이드; 초과 시 해당 블록부터 추가 분리) |
| Cyclomatic complexity | **≤ 15** (리포지토리에 ESLint `complexity` 규칙이 추가되면 그 상한에 맞춤) |
| 최대 중첩 깊이 | **≤ 5** (현재 7) |

`execute()` 최상위 본문은 **얇은 오케스트레이션**만 남긴다.

### 2.3 2단계 (별도 파일)

1단계에서 위 수치를 **어느 한 메서드에도** 만족시키기 어렵다면, **그 블록만** 별도 모듈로 분리한다 (예: `embedding-migration-execute-helpers.ts`). 전역 남발 없이 **책임 단위**로만 쪼갠다.

### 2.4 검증·도구

- `npm test`, `npm run lint`, `npm run type-check` 통과.
- 이슈에서 사용한 **slop-detector(또는 동일 정적 분석)** 재실행 시 품질 지표가 개선되었는지 확인(보조).

---

## 3. 범위 결정 (브레인스토밍 답변)

| 결정 | 선택 |
|------|------|
| 리팩터 범위 | **3**: 먼저 동일 파일 private 분리 → 수치 미달 시 파일 분리 |
| 완료/확장 판단 | **1**: 스펙에 수치 기준 명시; **초과 시** 2단계 파일 분리 |
| 테스트 | **2**: `execute` / `rollback` **핵심 경로** 단위·통합 테스트 보강 |

---

## 4. 제안 구조

### 4.1 `execute` 분리 후보

- 모니터 옵션 정규화(`effectiveMonitor`).
- 소스 행 수 집계, `initializeProgress`, 빈 소스 **조기 반환** (`total === 0`).
- Prepared statement 생성(`select` / `upsert` / `existing`).
- **단일 행 처리** (파싱, 호환성 평가, upsert, rollback 엔트리, 성공/실패 집계) — 기존 익명 `processBatch` 대체.
- 배치 루프(`while` + `notifyProgress`).
- 종료: 스텝 완료, 자동 롤백 시도, `MigrationResult` 조립, `recordHistory` 호출.

### 4.2 `rollback`

- 빈 `entries` 조기 반환(유지).
- `DELETE` / `restore` 분기 및 SQL 실행을 **짧은 private 메서드**로 분리해 중첩·길이 감소.

### 4.3 데이터 흐름

기존과 동일: `memory_embedding` 읽기 → 호환성·투영 → upsert → rollback 엔트리 누적 → 배치 반복 → 결과·(조건부) 히스토리 기록.

---

## 5. 테스트 보강

- 기존 `embedding-migration-service.spec.ts`에 성공·dry-run·수동/자동 롤백 등이 이미 있다.
- **추가**: 소스 `embedding_provider`에 해당하는 행이 **0건**일 때 `execute` — `processed === 0`, 성공 플래그, 조기 반환 경로(히스토리 미기록 등 **현재 동작**)를 고정하는 테스트 **1건**.
- 리팩터 후 전체 스펙 회귀.

---

## 6. 리스크·완화

- **회귀**: 테스트·린트·타입 체크를 PR 전 필수로 실행한다.
- **동시성**: 단일 스레드 SQLite 가정 유지; 로직만 이동한다.
- **가독성**: private 이름은 동작을 드러내는 동사구(`prepare…`, `process…`, `finalize…`)를 사용한다.

---

## 7. 참고

- 구현 단계 상세는 `docs/superpowers/plans/2026-04-18-issue-163-embedding-migration-refactor.md`를 따른다.
