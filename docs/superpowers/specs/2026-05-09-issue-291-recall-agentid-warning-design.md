# 설계: 이슈 #291 — `recall` `memory_item` 경로의 `agent_id` 경고 제거

**상태**: 초안 (구현 전 검토)  
**날짜**: 2026-05-09  
**이슈**: [GitHub #291](https://github.com/jee1/memento/issues/291)

---

## 1. 배경·목표

운영 로그에 아래 경고가 반복적으로 쌓이고 있다.

```text
[recall] memory_item 검색 시 agent_id 파라미터는 무시됩니다
```

로그 샘플의 `agent_id`는 모두 `default`이며, 현재 계약도 `memory_item` 검색에서 `agent_id`를 실제 필터로 사용하지 않고 단순히 무시하는 쪽이다. 따라서 이번 이슈의 목표는 **검색 동작은 유지한 채 운영 경고 노이즈만 제거하는 것**이다.

**비목표**

- `agent_id`를 `memory_item` 검색 필터로 새로 지원하지 않는다.
- 다른 `recall` 경고 정책(`type`, `memory_types`, `core`/`vault`)은 변경하지 않는다.
- relation/LLM 초기화 경고(#264)는 이번 범위에 포함하지 않는다.

---

## 2. 구현 접근 비교 (3안)

| 접근 | 요약 | 장점 | 단점 |
|------|------|------|------|
| **A. `memory_item` 경로에서 warn만 제거** | `agent_id`가 와도 현재처럼 조용히 무시한다. | API 계약을 바꾸지 않고 운영 로그 노이즈를 즉시 줄인다. diff와 회귀 범위가 가장 작다. | 런타임 로그만 보면 왜 무시되는지 드러나지 않는다. |
| **B. 특정 값에서만 조건부 경고** | 예: `agent_id !== "default"`일 때만 경고한다. | 일부 비정상 입력 신호를 남길 수 있다. | 호출자 관례에 결합되고 기준이 애매하다. 경고 정책이 다시 흔들릴 수 있다. |
| **C. 경고를 에러로 승격** | `memory_item` 검색에서 `agent_id`가 오면 요청 실패. | 계약이 가장 명확하다. | 현재 “무시” 동작과 호환되지 않아 실제 호출을 깨뜨릴 수 있다. |

**선택**

- **A안 채택**. 이번 수정은 버그 이슈의 로그 정리에 집중하고, 동작 변경이나 API 계약 변경은 하지 않는다.

---

## 3. 설계

### 3.1 동작

`RecallTool`의 `memory_item` 검색 분기에서 `agent_id`가 제공되더라도 더 이상 경고를 남기지 않는다. `agent_id`는 지금과 동일하게 검색 필터 구성에 참여하지 않으며, 검색 결과와 에러 처리도 기존과 동일해야 한다.

### 3.2 변경 범위

- `packages/memento-core/src/domains/memory/tools/recall-tool.ts`
  - `memory_item` 경로의 `agent_id` warn 호출 제거
- 관련 회귀 테스트 파일
  - `agent_id`가 있어도 검색이 정상 수행되고 warn이 기록되지 않음을 검증

### 3.3 명시적 비범위

- 입력 스키마 설명 문구 변경
- `restore-anchors-tool` 등 다른 도구의 `agent_id` 처리
- 로그 레벨 전환(`warn` → `debug`) 같은 우회책

---

## 4. 테스트·검증 계획

### 4.1 실패 우선 회귀 테스트

`memory_item` 검색 호출에 `agent_id`를 포함한 테스트를 추가하거나 기존 테스트를 확장한다.

기대 결과:

- 검색은 정상 수행되어 기존과 같은 결과를 반환한다.
- logger mock에는 `'memory_item 검색 시 agent_id 파라미터는 무시됩니다'` 경고가 기록되지 않는다.

### 4.2 보호해야 할 기존 동작

아래 정책은 그대로 유지되어야 한다.

- `type`/`memory_types` 관련 경고 및 에러 정책
- `memory_types`에서 `core`/`vault` 제거 및 검증
- `memory_item` 검색 외 다른 분기의 동작

### 4.3 검증 실행

- 대상 `recall` 관련 spec 실행
- 필요 시 `type`/`memory_types` 최근 회귀와 겹치는 spec 추가 실행
- 코드 수정 후 graphify 재빌드

---

## 5. 실행 단위

이번 작업은 이슈별 격리를 위해 별도 워크트리와 브랜치에서 진행한다.

- 워크트리: `/home/jee1lee/git/memento/.worktrees/fix-issue-291`
- 브랜치: `fix/issue-291-recall-agentid-warning`

`#264`는 별도 워크트리와 별도 spec으로 이어서 처리한다.

---

## 6. 완료 조건

| 조건 | 판정 기준 |
|------|-----------|
| 운영 warn 제거 | `memory_item` 검색에서 `agent_id`를 넣어도 해당 warn이 기록되지 않는다. |
| 동작 유지 | 동일 입력에서 검색 결과/실패 정책이 기존과 동일하다. |
| 범위 통제 | `#291` 외 LLM 초기화 경고나 다른 도구 동작은 함께 변경하지 않는다. |

---

## 7. Spec self-review (체크리스트)

- **Placeholder**: 없음.
- **내부 정합**: 목표는 “warn 제거 + 동작 유지”로 전 구간 일치.
- **범위**: `RecallTool`과 회귀 테스트로 제한.
- **모호성 해소**: `agent_id`는 지원하지 않되 조용히 무시한다.
