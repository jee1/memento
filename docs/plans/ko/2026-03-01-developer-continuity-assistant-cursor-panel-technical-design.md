# Developer Continuity Assistant Host Adapter Technical Design

**일자**: 2026-03-01  
**상태**: 디자인 초안  
**목적**: `packages/memento-assistant`를 정본으로 유지하면서, IDE나 웹 UI 같은 host adapter가 어떻게 붙어야 하는지 기술 구조를 정의한다. Cursor는 첫 번째 reference host 후보로만 다룬다.

---

## 1. 설계 전제

현재 저장소에서 continuity의 핵심은 이미 아래에 있다.

- `packages/memento-core`
  - 공개 facade
- `packages/memento-assistant`
  - continuity runtime
  - CLI
  - HTTP tools
  - `resume_session` 계약

따라서 다음 단계의 과제는 새 continuity 엔진을 만드는 것이 아니라, **이미 있는 runtime을 여러 host가 소비할 수 있게 adapter 구조를 정리하는 것**이다.

이 문서의 전제는 다음과 같다.

- 제품 중심은 `memento-assistant`
- host는 교체 가능해야 함
- Cursor는 첫 reference host일 수 있지만, 아키텍처의 중심이 되어선 안 됨
- host adapter는 thin shell이어야 함

---

## 2. 문제 정의

“IDE 패널을 만든다”는 표현은 쉽게 아래 두 가지를 섞어 버린다.

- continuity 제품 자체를 만든다
- continuity 결과를 보여주는 host UI를 만든다

여기서 우리가 실제로 필요한 것은 두 번째다. 따라서 설계는 `패널 기술`보다 `host adapter 경계`를 먼저 정의해야 한다.

핵심 질문은 아래다.

- 어떤 host든 공통으로 필요한 입력은 무엇인가
- runtime과 host의 계약은 어디까지인가
- host별 구현이 달라져도 continuity 동작은 어떻게 유지할 것인가

추가로, 아래 경계를 분명히 해야 한다.

- AI와 자유롭게 대화하는 채팅 surface
- continuity snapshot을 보여주고 최소 제어만 하는 panel surface

이 문서는 두 번째 surface만 다룬다.

---

## 3. 접근 방식 비교

### Option A. Runtime-First Adapter Architecture

- `memento-assistant`가 정본
- host는 공통 adapter contract를 통해 붙음
- Cursor 패널은 그 contract의 첫 번째 reference implementation

장점:

- host 다양성을 구조적으로 수용한다.
- CLI, 패널, 웹이 같은 contract를 공유한다.
- core/runtime과 UI 교체 비용이 작다.

단점:

- adapter 경계를 문서와 테스트로 명확히 잡아야 한다.

**권장안**: 추천.

### Option B. Cursor-First Extension Architecture

- Cursor extension 안에서 continuity 로직과 UI를 함께 처리한다.

장점:

- 초기 데모는 빠를 수 있다.

단점:

- Cursor 종속성이 커진다.
- 다른 host로 이동할 때 재사용성이 낮다.
- 패널이 제품 본체처럼 비대해질 수 있다.

### Option C. Web-Only Surface

- IDE host를 미루고 웹 대시보드만 먼저 만든다.

장점:

- 기술적으로 단순하다.
- host API 제약을 피할 수 있다.

단점:

- developer continuity의 핵심 맥락인 IDE 진입점이 사라진다.

---

## 4. 권장 아키텍처

### 4.1 패키지 역할

권장 구조:

- `packages/memento-core`
  - 공개 facade
- `packages/memento-assistant`
  - continuity runtime
  - continuity HTTP API
  - CLI
- `packages/memento-assistant-host-shared`
  - host adapter 공통 타입
  - snapshot view model
  - panel/client contract
- `packages/memento-assistant-cursor`
  - Cursor reference adapter
  - panel shell
  - workspace context resolver
  - runtime HTTP client

`packages/memento-assistant-host-shared`는 필수는 아니지만, host가 2개 이상이 될 가능성이 있으면 초기에 분리하는 편이 좋다. host가 하나뿐이라면 처음에는 `memento-assistant-cursor` 내부 모듈로 시작해도 된다.

### 4.2 의존 방향

- `memento-assistant-cursor -> memento-assistant`
- `memento-assistant-cursor -> memento-assistant-host-shared` 선택적
- `memento-assistant -> memento-core`
- `memento-core -> host adapter*` 금지
- `memento-assistant -> host adapter*` 금지

즉, host adapter는 runtime을 소비하지만, runtime은 host 존재를 몰라야 한다.

---

## 5. Host Adapter Contract

### 5.1 Host가 runtime에 넘겨야 하는 입력

최소 컨텍스트:

- `project`
- `branch`
- `session_id`
- `process_id`

선택 컨텍스트:

- `workspace_root`
- `opened_files`
- host kind
  - `cursor`
  - `vscode`
  - `web`

### 5.2 Host가 runtime에서 받아야 하는 출력

기본 출력은 `resume_session` snapshot이다.

- `resume`
- `recentDecisions`
- `openThreads`
- `nextActions`

host는 이 응답을 그대로 보여주거나, 표시 친화 view model로 가볍게 변환만 한다.

### 5.3 Host action contract

host가 직접 처리하면 안 되는 것:

- 기억 저장 규칙
- branch filtering 로직
- continuity aggregation
- ranking

host가 해도 되는 것:

- 버튼 클릭 처리
- 간단한 입력 모달
- refresh orchestration
- loading/error/empty 상태 렌더링

host가 이번 단계에서 하지 않는 것:

- 자유 대화형 채팅 orchestration
- LLM prompt 관리
- 긴 multi-turn conversation 상태 관리

---

## 6. 구성 요소

### A. Workspace Context Resolver

역할:

- 현재 workspace root 추론
- 현재 branch 추론
- `project` 기본값 결정
- `session_id` 저장/복구

이 모듈은 host별로 구현이 달라질 수 있다.

### B. Assistant Panel Client

역할:

- `resume_session`
- `start_session`
- `save_context`
- `end_session`

이 클라이언트는 runtime HTTP contract만 안다.

### C. Snapshot View Model

역할:

- runtime 응답을 panel-friendly 구조로 변환
- 공통 섹션명과 상태를 정리

이 모듈은 가능하면 host-agnostic하게 유지한다.

### D. Host Shell

역할:

- 패널 등록
- 명령 등록
- 설정/포트 탐지
- 컨텍스트 수집
- panel과 runtime 클라이언트 orchestration

### E. Panel Renderer

역할:

- `Resume / Recent Decisions / Open Threads / Next Actions` 렌더링
- `Refresh / Start / Save / End` 표시
- loading/empty/error/stale 상태 처리

이 renderer는 chat renderer가 아니다. 입력창 중심 UI를 만들지 않고, snapshot과 최소 액션만 렌더링한다.

---

## 7. Cursor는 어떻게 들어오는가

Cursor는 아키텍처 중심이 아니라 **첫 reference host**로만 들어온다.

Cursor 전용 고려 사항:

- workspace root와 branch 수집 방식
- panel 등록 방식
- 필요하면 MCP registration 보조

하지만 아래는 Cursor에 넣지 않는다.

- continuity aggregation 로직
- resume snapshot 해석 규칙
- memory 저장 규칙

즉, Cursor adapter는 아래 정도만 맡는다.

1. host context 수집
2. runtime HTTP 호출
3. panel 렌더링

---

## 8. 데이터 흐름

### 8.1 host panel 로드

1. host shell 활성화
2. workspace context resolver 실행
3. `project`, `branch`, `session_id`, `process_id` 결정
4. assistant panel client가 `resume_session` 호출
5. snapshot view model 변환
6. panel renderer가 UI 갱신

### 8.2 quick capture

1. 사용자가 `Save` 클릭
2. host shell이 간단한 입력 UI 노출
3. assistant panel client가 `save_context` 호출
4. 성공 후 `resume_session` 재호출
5. panel renderer refresh

### 8.3 session end

1. 사용자가 `End` 클릭
2. 요약 입력
3. `end_session` 호출
4. `resume_session` 재호출
5. `Next Actions` 재표시

---

## 9. 실패 처리

### runtime 미기동

- panel에 `runtime unavailable` 표시
- `Retry` 제공
- 필요하면 기동 가이드 링크 제공

### branch 추론 실패

- `branch=unknown` 표시
- broad resume 허용 여부는 runtime contract에 따름
- UI에 `branch filtering limited` 배지 표시 가능

### host API 제약

- host별 기능 차이는 host shell 안에 가둔다.
- 공통 view model과 runtime client는 그대로 유지한다.

---

## 10. 보안과 권한

원칙:

- host adapter는 기본적으로 `읽기/요약/기억화`까지만 담당
- 파일 수정, 명령 실행, 외부 전송은 별도 승인 계층에서 처리

즉, reference adapter MVP는 **Action Broker 이전 단계**다.

또한 이 단계는 **chat assistant 이전 단계**이기도 하다. panel은 AI 대화 surface를 대체하지 않는다.

---

## 11. 단계적 권장안

### Step A. Adapter Contract First

- 공통 context 타입 정리
- runtime client 정리
- view model 정리

### Step B. Read-Only Reference Panel

- snapshot 읽기
- 4개 섹션 렌더링
- loading/empty/error 처리

### Step C. Quick Capture

- `Start / Save / End`
- 저장 후 refresh

### Step D. First Reference Host

- Cursor adapter 연결
- host 제약 확인
- 사용자 피드백 수집

### Step E. Additional Hosts or Web

- VS Code
- 웹 대시보드
- 메신저/알림 surface

---

## 12. 결론

다음 단계의 기술 설계는 “Cursor 패널을 만든다”보다 “**assistant runtime 위에 host adapter를 올리는 구조를 만든다**”가 더 정확하다.

따라서 Cursor는 아키텍처의 중심이 아니라, 그 구조를 검증하는 첫 번째 reference host로만 다루는 것이 맞다.
