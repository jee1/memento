# Developer Continuity Assistant Host Adapter Wireframe Design

**일자**: 2026-03-01
**상태**: 구현 정렬됨
**목적**: `resume_session` 계약을 어떤 IDE에서도 소비할 수 있는 host adapter 관점으로 정리하고, 그중 하나의 reference panel wireframe과 현재 MVP 구현 상태를 함께 정의한다.

---

## 1. 문제 재정의

이전 문서는 `IDE 패널`을 다음 단계의 중심 제품처럼 읽히는 문제가 있었다. 하지만 현재 Phase 1에서 완성된 핵심은 패널이 아니라 아래 계층이다.

- `packages/memento-core`
  - 기억/검색 공개 facade
- `packages/memento-assistant`
  - developer continuity runtime
  - `resume_session`, `start_session`, `save_context`, `end_session`

따라서 다음 단계에서 화면이 필요하더라도, 그것은 제품 본체가 아니라 **host adapter**여야 한다. 즉, Cursor 패널, VS Code 패널, 웹 대시보드는 모두 같은 continuity runtime을 소비하는 서로 다른 진입면일 뿐이다.

이 문서의 목적은 다음 세 가지다.

- 제품 중심축을 `assistant runtime`으로 고정
- 패널 UI를 reference adapter로 재정의
- 어떤 host에서도 재사용 가능한 최소 wireframe 규칙 정의

---

## 2. 핵심 원칙

### 2.1 제품의 정본은 runtime이다

아래 계층이 정본이다.

- continuity snapshot 생성
- continuity 저장
- branch-aware resume
- session lifecycle

이 책임은 `packages/memento-assistant`가 가진다.

### 2.2 패널은 thin adapter다

패널은 아래만 담당한다.

- 현재 `project`, `branch`, `session_id`, `process_id` 수집
- `resume_session` 호출
- snapshot 렌더링
- `Start / Save / End / Refresh` 액션 전달

패널 안에 continuity 핵심 로직을 넣지 않는다.

### 2.3 특정 IDE 종속 표현은 최소화한다

문서와 구조는 Cursor를 첫 reference host로 삼을 수는 있어도, Cursor 전용 제품처럼 설계하면 안 된다. 따라서 wireframe은 특정 IDE API보다 **공통 정보 구조**에 먼저 맞춘다.

### 2.4 이 패널은 AI 채팅 패널이 아니다

이 문서에서 말하는 panel은 ChatGPT, Cursor Chat 같은 **자유 대화형 assistant 패널**과 다르다.

- 채팅 패널의 역할
  - 질문/답변
  - 긴 탐색
  - 자유로운 대화
- continuity panel의 역할
  - 현재 기억 상태 표시
  - `Resume / Recent Decisions / Open Threads / Next Actions` 표시
  - `Refresh / Start / Save / End` 같은 최소 제어

즉, continuity panel은 **대화 패널이 아니라 상태 확인 및 제어 패널**로 이해해야 한다.

---

## 3. 현재 구현 상태

현재 저장소에는 아래 reference host package가 이미 추가되어 있다.

- `packages/memento-assistant-cursor`
  - `buildPanelContext`
  - `createAssistantPanelClient`
  - `ResumePanelProvider`
  - `createHostPanelShell`
  - `activateHostAdapter`

현재 MVP에서 실제로 구현된 것은 다음과 같다.

- host-agnostic panel context와 snapshot view model
- `memento-assistant` HTTP runtime을 호출하는 panel client
- static HTML 기반 read-only panel renderer
- `refresh / start / save / end` 액션을 provider로 위임하는 quick capture 경로
- webview `postMessage` bridge와 host shell message handler

아직 구현되지 않은 것:

- 실제 Cursor API/manifest에 직접 결합된 production shell
- richer status badge (`fresh`, `stale`, `offline`)
- `Retry`, `Open Logs` 같은 별도 오류 액션
- host별 workspace/branch 자동 추론의 구체 구현

즉, 이 문서는 완성형 Cursor 패널을 설명하는 것이 아니라, **이미 구현된 reference shell과 장기 wireframe 방향을 함께 설명하는 문서**로 읽는 것이 맞다.

---

## 4. 접근 방식 비교

### Option A. Runtime-First + Reference Panel Adapter

- `memento-assistant`를 정본으로 둔다.
- host adapter는 같은 snapshot을 보여주는 thin UI로 만든다.
- 첫 adapter는 Cursor일 수 있지만, 구조는 host-agnostic하게 유지한다.

장점:

- IDE 다양성 문제를 구조적으로 흡수한다.
- CLI, 웹, IDE 패널이 같은 계약을 공유한다.
- 나중에 host가 바뀌어도 continuity 로직은 유지된다.

단점:

- host adapter 계층을 명시적으로 설계해야 한다.

**권장안**: 추천.

### Option B. Cursor-First Product Surface

- Cursor 패널을 먼저 만들고, 그것을 사실상 제품 중심으로 둔다.

장점:

- 특정 사용자군에는 빠르게 보일 수 있다.

단점:

- host 종속성이 지나치게 커진다.
- VS Code, 웹, 다른 IDE로 확장할 때 구조가 꼬인다.

### Option C. Web Dashboard First

- IDE 패널 대신 웹 UI를 먼저 만든다.

장점:

- host 종속성이 낮다.
- 구현 기술 선택이 자유롭다.

단점:

- “작업 이어받기”라는 맥락 진입점이 IDE 밖으로 밀린다.

---

## 5. 권장 UX 방향

권장 방향은 **Runtime-First + Reference Panel Adapter**다.

즉, 다음과 같이 이해해야 한다.

- 제품의 본체: continuity runtime
- 첫 번째 reference adapter: 사이드 패널형 IDE view
- 이후 확장 가능 adapter: 다른 IDE 패널, 웹 대시보드, 메신저, 백그라운드 알림

이 관점에서 패널의 역할은 “assistant 대화창”이 아니라 **작업 이어받기 보드**다. 사용자는 host를 열자마자 아래 질문에 대한 답을 봐야 한다.

- 지금 무엇을 이어받아야 하나
- 왜 그 방향을 택했나
- 무엇이 아직 안 끝났나
- 다음으로 무엇을 해야 하나

---

## 6. Reference Panel Wireframe

이 와이어프레임은 Cursor 전용 UI가 아니라, **어떤 host panel에도 옮길 수 있는 공통 레이아웃 예시**다.

### 5.1 기본 상태

```text
+-----------------------------------------------------------+
| Memento Assistant                                         |
| project: memento    branch: feature/resume   updated 2m   |
| [Refresh] [Start] [Save] [End]                            |
+-----------------------------------------------------------+
| Resume                                                    |
| - task: strict branch-safe resume 이후 adapter 정리       |
| - task: host adapter 기준 문서 재작성                     |
+-----------------------------------------------------------+
| Recent Decisions                                          |
| - decision: continuity의 정본은 assistant runtime         |
| - decision: host panel은 thin adapter로 둔다              |
+-----------------------------------------------------------+
| Open Threads                                              |
| - blocker: first host를 Cursor로 둘지 아직 확정 안 됨    |
| - blocker: panel보다 web dashboard가 나을지 검토 필요    |
+-----------------------------------------------------------+
| Next Actions                                              |
| - next-step: host adapter contract 문서화                 |
| - next-step: 첫 reference adapter 범위 결정               |
+-----------------------------------------------------------+
| Context                                                   |
| project=memento  session=sess-123  process=cursor         |
+-----------------------------------------------------------+
```

### 5.2 빈 상태

```text
+-----------------------------------------------------------+
| Memento Assistant                                         |
| No continuity snapshot found for this project/branch      |
|                                                           |
| This panel is only a view over the assistant runtime.     |
| Start a session or save context first.                    |
|                                                           |
| [Refresh] [Start] [Save] [End]                            |
+-----------------------------------------------------------+
```

### 5.3 로딩 상태

```text
+-----------------------------------------------------------+
| Memento Assistant                                         |
| Loading continuity snapshot from assistant runtime...     |
|                                                           |
| Resume            [.....]                                 |
| Recent Decisions  [.....]                                 |
| Open Threads      [.....]                                 |
| Next Actions      [.....]                                 |
+-----------------------------------------------------------+
```

### 5.4 오류 상태

```text
+-----------------------------------------------------------+
| Memento Assistant                                         |
| Could not load snapshot                                   |
| assistant runtime is unreachable or returned an error     |
|                                                           |
| [Refresh] [Start] [Save] [End]                            |
+-----------------------------------------------------------+
```

현재 구현 기준으로는 빈 상태와 오류 상태 모두 공통 action bar를 재사용한다. `Retry`, `Open Logs` 같은 전용 오류 액션은 아직 설계 범위에만 있고 구현에는 포함되지 않았다.

---

## 6. 공통 구성 요소

### 6.1 Header

- 제품명: `Memento Assistant`
- 현재 `project`
- 현재 `branch`
- 마지막 동기화 시각
- 상태 배지
  - `fresh`
  - `stale`
  - `offline`

### 6.2 Action Bar

MVP에서는 아래 네 개면 충분하다.

- `Refresh`
- `Start`
- `Save`
- `End`

이 액션은 모두 host adapter에서 직접 처리하지 않고, assistant runtime API 호출로 위임한다.

이 액션 바는 채팅 입력창을 대체하지 않는다. 즉, 사용자가 AI와 대화하려면 기존 채팅 surface를 사용하고, continuity panel은 상태 표시와 최소 제어만 담당한다.

현재 구현 세부:

- `Refresh`: 즉시 `resume_session` refresh
- `Start`: 단순 prompt/modal 수준 입력으로 `session_id`를 받음
- `Save`: 단순 prompt/modal 수준 입력으로 `kind`, `content`를 받음
- `End`: 단순 prompt/modal 수준 입력으로 `summary`를 받음

즉, 현재 MVP는 정교한 폼 UI가 아니라 **빠른 상태 저장을 위한 최소 액션 bar**에 가깝다.

### 6.3 Snapshot Sections

각 섹션은 `resume_session` 응답을 그대로 렌더링한다.

- `Resume`
- `Recent Decisions`
- `Open Threads`
- `Next Actions`

카드 규칙:

- 제목 1줄
- 요약 2~3줄
- 길면 `Show more`
- memory id는 기본 숨김
- metadata는 디버깅 모드에서만 노출 가능

### 6.4 Context Footer

신뢰 형성과 디버깅을 위해 아래는 보이는 편이 좋다.

- `project`
- `branch`
- `session_id`
- `process_id`

---

## 8. 데이터 흐름

### 7.1 host 열기

1. host adapter가 workspace root와 branch를 확인한다.
2. `project`, `branch`, `session_id`, `process_id`를 구성한다.
3. `resume_session`을 호출한다.
4. snapshot이 있으면 4개 섹션을 렌더링한다.
5. 없으면 빈 상태를 보여준다.

### 7.2 빠른 저장

1. 사용자가 `Save`를 누른다.
2. 작은 입력 UI에서 `decision / blocker / next-step` 중 하나를 고른다.
3. adapter가 `save_context`를 호출한다.
4. 저장 후 `resume_session`을 다시 호출한다.

### 7.3 세션 종료

1. 사용자가 `End`를 누른다.
2. 짧은 summary를 입력한다.
3. adapter가 `end_session`을 호출한다.
4. 저장 후 현재 패널을 refresh한다.

현재 구현에서는 이 흐름이 webview의 `postMessage`와 host shell의 `onDidReceiveMessage`를 통해 연결된다.
---

## 9. MVP 비목표

이번 reference adapter MVP는 아래 범위를 포함하지 않는다.

- 자유 대화형 AI 채팅 UI
- 채팅형 assistant UI
- host 전용 planner/dashboard
- 전체 memory 검색 화면
- 파일 수정/명령 실행 승인 UI
- 팀 공유/멀티유저 피드
- host 전용 business logic

---

## 10. 권장 구현 순서

1. host-agnostic snapshot view model 정리
2. read-only reference panel 렌더링
3. `Refresh`와 상태 표시
4. `Start / Save / End` 최소 액션
5. 첫 번째 reference host 연결
6. 이후 web dashboard나 추가 IDE adapter 검토

---

## 11. 결론

다음 단계의 목표는 “IDE 패널을 제품 중심으로 만든다”가 아니다. 목표는 **assistant runtime을 중심으로 유지한 채, 그것을 사람이 읽을 수 있게 보여주는 첫 번째 host adapter를 정의하는 것**이다.

따라서 이 문서의 wireframe은 특정 IDE에 잠기는 설계가 아니라, 어느 host에도 옮길 수 있는 **reference panel shape**로 이해해야 한다.
