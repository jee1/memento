# Feature Specification: 입력 검증 거절이 procedural memory를 생성

**Feature Branch**: `feature/fix-reflexion-procedural-memory-content-task_goa`
**Spec Directory**: `specs/674-856-fix-reflexion-validation-skip-procedural`
**Created**: 2026-09-06
**Status**: Executed — review PASS
**Issue**: [#856](https://github.com/jee1/memento/issues/856)
**Related**: [#853](https://github.com/jee1/memento/issues/853), [#855](https://github.com/jee1/memento/issues/855)
**Input**: fix(reflexion): 입력 검증으로 거절된 호출이 procedural memory 를 생성 — 요청 content 가 task_goal 로 저장

## Problem Statement

`ToolInputValidationError`(클라이언트 입력 스키마 위반)도 `BaseTool.handleFailure` →
`FailureDetector.detectToolError` → Reflexion 큐 → procedural memory INSERT 경로를 탄다.
저장되지 않은 `remember` 요청의 `content` 앞 200자가 `task_goal`/`workflow_name` 이 된다.
라이브 DB에서 procedural 중 ~47%가 `Reflexion: %실패 기록` 이며, `task_goal` 이 붙은
건의 대부분이 잘린 요청 본문이다.

## Goals

- 입력 검증 실패는 Reflexion(절차 기억) 대상이 아니다 — 큐에 넣지 않는다.
- `task_goal` 이 명시된 경우에만 `original_task`/`task_goal` 로 쓴다. `params.content` 폴백 금지.
- 실제 런타임/시스템 실패의 Reflexion 경로는 유지한다.
- 회귀는 자동 테스트로 고정한다.

## Non-Goals

- 라이브 DB에 이미 쌓인 162건(및 잘린 `task_goal` 26건) 일괄 정리 마이그레이션
  (ops follow-up; 본 PR 범위 밖).
- `ErrorType` enum에 `validation_error` 추가.
- `detectUserFeedback` 의 feedback 텍스트 휴리스틱 변경.
- MCP 클라이언트 계약/`MEMENTO_TYPE_PARAM_MODE` 정책 변경 (#855 범위).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 검증 거절은 procedural을 만들지 않음 (Priority: P1)

에이전트가 `remember` 등에서 `type` 누락·잘못된 필드로 거절되면, 서버는
`-32602`/`ToolInputValidationError` 를 반환하고 **새 procedural memory를 만들지 않는다**.

**Why this priority**: 이슈의 핵심 오염 경로. `handleFailure` 한 곳이 24개 도구를 덮는다.

**Independent Test**: `RememberTool` (또는 `BaseTool` 서브클래스)에 mock
`failureDetector`/`reflexionWorker` 를 두고 validation throw 후
`queueFailureEvent` 미호출 확인.

**Acceptance Scenarios**:

1. **Given** `type` 없이 `remember` 호출(error 모드), **When** handle 실패, **Then** `ToolInputValidationError` 이고 `reflexionWorker.queueFailureEvent` 가 호출되지 않는다.
2. **Given** 동일 조건, **When** handle 실패, **Then** `failureDetector.detectToolError` 경로로 Reflexion 이벤트가 큐에 들어가지 않는다 (조기 return).
3. **Given** 일반 `Error` (DB 등), **When** handleFailure, **Then** 기존처럼 감지·큐잉된다.

---

### User Story 2 - content를 task_goal로 승격하지 않음 (Priority: P1)

시스템 실패로 Reflexion이 돌아가더라도, `params.content` 만으로는
`original_task`/`task_goal` 을 채우지 않는다. 명시 `task_goal` 만 사용한다.

**Why this priority**: 검증 스킵만으로는 다른 실패 경로에서 content 폴백이 남는다.

**Independent Test**: `FailureDetector.detectToolError` + recorder `extractTaskGoal`
단위 테스트.

**Acceptance Scenarios**:

1. **Given** params `{ content: "Docker permission denied…" }` without `task_goal`, **When** `detectToolError`, **Then** `event.original_task` 는 undefined.
2. **Given** params `{ task_goal: "배포 롤백" }`, **When** `detectToolError`, **Then** `original_task === "배포 롤백"`.
3. **Given** FailureEvent with `context.params.content` only, **When** recorder resolves task goal, **Then** `recordWithoutTaskGoal` 경로 (content 200자 자르기 없음).

---

### User Story 3 - 실제 실패 Reflexion은 유지 (Priority: P2)

DB/타임아웃 등 비검증 실패는 기존처럼 감지·기록된다. `task_goal` 이 있으면
dedup/merge 경로도 유지.

**Why this priority**: 버그 수정이 Reflexion 전체 비활성화로 퇴화하면 안 된다.

**Independent Test**: 기존 `failure-detector.spec.ts` 의 tool_error / task_goal 케이스 +
일반 Error 큐잉 스모크.

**Acceptance Scenarios**:

1. **Given** `new Error('Database connection failed')`, **When** detectToolError, **Then** `detected === true` 이고 `ErrorType.TOOL_ERROR`.
2. **Given** 명시 `task_goal`, **When** detect, **Then** `original_task` 설정 유지.

---

### Edge Cases

- `error.name === 'ToolInputValidationError'` 이지만 instanceof 가 실패하는 경우
  (번들/복제 Error) → name 체크로도 스킵 (recall 경계와 동일).
- `ValidationError` 등 다른 name 은 스킵하지 않는다 (기존 스펙 유지).
- `handleFailure` 훅 자체 예외는 원본 에러 전파를 막지 않는다 (기존 동작).
- `failureDetector`/`reflexionWorker` 미초기화 시 기존 로그 폴백 유지.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `BaseTool.handleFailure` 는 `ToolInputValidationError`(instanceof 또는
  `error.name === 'ToolInputValidationError'`) 이면 Reflexion 큐잉을 하지 않아야 한다.
  선택적으로 debug/info 로그만 남길 수 있다.
- **FR-002**: `FailureDetector.detectToolError` 는 `params.task_goal` 이 있을 때만
  `original_task` 를 설정해야 한다. `params.content` 폴백 MUST NOT.
- **FR-003**: `ReflexionReflectionRecorder.extractTaskGoal` 은
  `event.original_task` 또는 `context.params.task_goal` 만 사용해야 한다.
  `params.content` 폴백 MUST NOT.
- **FR-004**: 비검증 `Error` 의 detect → queue → record 경로는 유지되어야 한다.
- **FR-005**: FR-001~003 은 자동 회귀 테스트로 고정되어야 한다.

### Key Entities

- **FailureEvent**: 실패 감지 결과; `original_task` 는 명시 task_goal 전용.
- **ToolInputValidationError**: 클라이언트 입력 검증 실패; Reflexion 비대상.
- **Procedural memory (Reflexion)**: 실패 성찰 기록; 검증 거절로는 INSERT 금지.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `remember` type 누락(error 모드) 시 `queueFailureEvent` 호출 0회.
- **SC-002**: content-only params 로 `detectToolError` 시 `original_task` undefined.
- **SC-003**: 기존 failure-detector tool_error / task_goal 테스트 green.
- **SC-004**: lint / type-check / 관련 단위 테스트 green; production 변경 후 graphify 재빌드.

## Assumptions

- 이슈 제안대로 `handleFailure` 단일 가드가 충분하다 (모든 도구가 이 훅을 탄다).
- 레거시 DB 정리는 별도 ops 이슈로 분리해도 증상 재발을 막으면 SC 충족.
- `detectUserFeedback` 의 feedback→extractTaskGoal 은 “사용자 피드백 텍스트”이므로
  remember content 폴백과 성격이 다르다 (Non-Goal).

## Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| Q1 | `ErrorType`에 validation 타입을 추가할까, 아니면 handleFailure에서 조기 return만? | Resolved | 조기 return만 (신규 enum 없음). 단순·24 call site 일괄 커버. |
| Q2 | content→task_goal 폴백을 detector와 recorder 둘 다 제거할까? | Resolved | 둘 다 제거. 한쪽에 남으면 우회 가능. |
| Q3 | 기존 오염 procedural 162건을 이 PR에서 정리할까? | Resolved | Non-Goal. ops dry-run 스크립트는 follow-up. |
| Q4 | instanceof만 vs name 이중 체크? | Resolved | 이중 체크 (`recall-tool` / AGENTS.md #811 패턴). |
| Q5 | `detectUserFeedback` content/피드백 휴리스틱도 손댈까? | Resolved | 유지. remember content 폴백과 별개. |

## Brainstorm Log

### Session 1 — 2026-09-06

- Categories: boundary (validation vs system error), data pollution (content as task_goal),
  legacy cleanup, ErrorType design, feedback path.
- Auto-selected all Recommended per Speckit canonical (user `진행해줘`).
- Status → Brainstormed; open questions 0.
