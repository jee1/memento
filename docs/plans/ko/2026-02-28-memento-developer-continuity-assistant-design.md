# Memento Developer Continuity Assistant 설계

**일자**: 2026-02-28  
**상태**: 디자인 승인 초안  
**목적**: `memento`를 기반으로, `OpenClaw`와 유사한 개인 AI 비서 방향을 검토하되, 초기 제품은 `memory-native developer assistant`로 정의한다.

---

## 1. 문제 정의

개발자는 작업을 자주 끊고 다시 돌아온다. 이때 실제 비용은 코드를 다시 읽는 시간이 아니라, 다음 질문들에 답하는 시간이다.

- 지금 무엇을 하던 중이었는가
- 왜 이 방향을 택했는가
- 어디서 막혔는가
- 다음에 바로 무엇을 해야 하는가

기존 AI 보조 도구는 현재 세션에서는 강하지만, 세션을 넘는 연속성은 약하다. `memento`는 장기 기억 저장·검색·망각·앵커·관계 그래프를 이미 갖추고 있으므로, 이를 중심으로 `개인 데스크톱 비서`를 설계할 수 있다.

---

## 2. 외부 레퍼런스 요약

### 2.1 OpenClaw에서 확인한 점

`OpenClaw` 공식 문서 기준으로 확인한 핵심은 아래와 같다.

- `Gateway`가 채널과 세션을 통합 관리한다.
- 에이전트는 `workspace` 중심으로 동작한다.
- 메모리는 `MEMORY.md`, `memory/YYYY-MM-DD.md` 같은 워크스페이스 파일이 사실상 정본 역할을 한다.
- 개인 비서 설정은 강한 권한을 가질 수 있으므로 allowlist와 보수적 운영을 권장한다.

이 문서에서의 해석/추론:

- `OpenClaw`는 `채널/세션/워크스페이스 운영`에 강하다.
- `memento`는 `구조화된 장기 기억`에 강하다.
- 따라서 초기 제품은 `OpenClaw clone`보다 `memory-native assistant`가 더 적합하다.

### 2.2 memento에서 활용 가능한 강점

현재 `memento`는 이미 다음 요소를 갖추고 있다.

- `working`, `episodic`, `semantic`, `procedural` 메모리 타입
- 하이브리드 검색
- 앵커 슬롯(A/B/C)
- 관계 그래프 및 이웃 기억 탐색
- 망각 정책, 품질 측정, 메타 메모리 통계

즉, 새 제품은 메모리 엔진을 새로 만드는 것이 아니라, 그 위에 `연속성 오케스트레이션 계층`을 얹는 문제로 보는 것이 맞다.

### 2.3 참고 자료

- OpenClaw README: <https://github.com/openclaw/openclaw>
- OpenClaw Architecture: <https://docs.openclaw.ai/architecture>
- OpenClaw Agent Runtime: <https://docs.openclaw.ai/concepts/agent>
- OpenClaw Agent Workspace: <https://docs.openclaw.ai/agent-workspace>
- OpenClaw Memory: <https://docs.openclaw.ai/concepts/memory>
- OpenClaw Personal Assistant Setup: <https://docs.openclaw.ai/clawd>
- memento 내부 참고:
  - `docs/reference/ko/Memento-Goals.md`
  - `docs/reference/ko/Memento-Milestones.md`
  - `docs/reference/ko/Memento-M1-DetailSpecs.md`

---

## 3. 제품 방향 결정

대화에서 합의한 초기 방향은 아래와 같다.

- 제품 형태: `개인 데스크톱 비서`
- 향후 확장: `메신저 채널` 지원 가능
- 우선순위: `기억 -> 실행 -> 플래너`
- 권한 모델: `혼합형`
- 주력 도메인: `개발자 비서 -> 업무 지식 비서 -> 개인 운영 비서`
- 입력 우선순위: `IDE/코드 작업 -> 업무 대화 -> 문서/지식 저장소`
- 대표 시나리오: `작업 이어받기 -> 자동 작업 로그 -> 변경 맥락 회수`
- 진입면 우선순위: `IDE 패널형 -> CLI 동반자형 -> 백그라운드 데몬형`

### 제품 한 줄 정의

`Memento Assistant는 개발자의 작업 맥락을 장기 기억으로 구조화해, 다음 세션에서 즉시 이어서 일하게 해주는 개인 데스크톱 비서다.`

---

## 4. 핵심 아키텍처

초기 구조는 아래 5계층으로 정의한다.

### 4.0 Package Boundary 원칙

Phase 1부터 `same repo, separate packages` 구조를 전제로 한다.

- `packages/memento-core`
  - 범용 메모리 플랫폼
  - 기억 저장/검색/앵커/관계/망각/임베딩/HTTP/MCP 서버/범용 클라이언트 담당
- `packages/memento-assistant`
  - 개인비서 제품 계층
  - continuity orchestration, session lifecycle, resume snapshot, assistant CLI, 이후 IDE 패널 계약 담당

의존성 방향은 아래로 고정한다.

- `assistant -> core` 의존 허용
- `core -> assistant` 의존 금지

이 문서의 해석/추론:

- `memento core`는 독립적으로 릴리스 가능한 메모리 플랫폼이어야 한다.
- 개인비서는 같은 저장소에 있더라도 `core` 위에 얹히는 별도 제품으로 운영되어야 한다.

### 4.1 Interaction Surface

- 1순위: IDE 패널
- 2순위: CLI
- 이후: 메신저 채널, 백그라운드 알림

#### Phase 1 구체화

Phase 1의 IDE 진입면은 `packages/memento-assistant`가 제공하는 `resume snapshot contract`를 우선 대상으로 둔다. 실제 IDE 통합은 `Cursor` 같은 MCP 친화 IDE를 먼저 겨냥하고, 초기 검증 목표는 범용 IDE 확장 배포가 아니라 `작업 이어받기` 흐름 검증이다. 별도 범용 VS Code 확장은 후속 단계로 둔다.

CLI는 독립 런타임을 새로 만드는 대신, `packages/memento-assistant`가 `packages/memento-core`의 공개 API를 감싸는 `경량 세션 래퍼`로 정의한다. 즉, 초기 CLI는 새 메모리 엔진이 아니라 `start-session`, `resume`, `save-context`, `end-session` 같은 연속성 명령을 제공하는 얇은 인터페이스가 적절하다.

### 4.2 Continuity Orchestrator

제품의 핵심 계층이다.

- 세션 시작 시 현재 프로젝트·브랜치·열린 파일·최근 기억을 바탕으로 `resume summary` 생성
- 세션 중 의미 있는 변화 감지
- 세션 종료 시 `what changed / blocker / next step` 저장

여기서 말하는 `의미 있는 변화 감지`는 아래 `7.4 자동 수집 트리거`를 통해 구현한다. 즉, Continuity Orchestrator는 별도 추상 개념이 아니라, 브랜치 전환·커밋·긴 세션 종료·명시적 기억 요청 같은 트리거를 받아 기억 생성과 resume 갱신을 수행하는 계층으로 본다.

이 계층은 `packages/memento-assistant`에 둔다. 이유는 이 로직이 범용 메모리 엔진의 책임이 아니라, 특정 제품인 `developer continuity assistant`의 사용자 경험 규칙이기 때문이다.

### 4.3 Memento Memory Core

모든 기억의 정본이다.

- 장기 기억 저장
- recall/anchor/relation 기반 맥락 회수
- 중복 억제, 망각, 품질 관리

이 계층은 `packages/memento-core`에 둔다. 즉, `Memory Core`는 개인비서 내부 모듈이 아니라 독립적으로 운영 가능한 범용 메모리 플랫폼이어야 한다.

### 4.4 Action Broker

외부 행동의 승인 경계를 담당한다.

- 파일 수정
- 명령 실행
- 메시지 전송
- 캘린더/이슈/PR 변경

초기 Phase 1에서 이 계층은 제품 경계상 `packages/memento-assistant`에 둔다. `core`는 메모리 플랫폼으로 남고, 승인 정책이나 외부 액션 규칙은 assistant 계층의 책임으로 제한한다.

### 4.5 Planner Layer

초기에는 약하게 두고, 이후 목표 추적과 회고 기능으로 확장한다.

이 계층 역시 `packages/memento-assistant`에 둔다. planner는 메모리 저장소의 보편 기능이 아니라, 특정 assistant 제품의 상위 행동 계층이다.

---

## 5. 핵심 사용자 흐름

### 5.1 작업 이어받기

사용자가 IDE를 열면 비서는 다음을 복구한다.

- 무엇을 하던 중이었는가
- 어디서 막혔는가
- 어떤 결정이 이미 내려졌는가
- 다음 액션은 무엇인가

IDE 첫 화면은 아래 네 영역으로 제한한다.

- `Resume`
- `Recent Decisions`
- `Open Threads`
- `Next Actions`

### 5.2 자동 작업 로그

모든 로그를 저장하지 않고, 연속성에 필요한 변화만 구조화한다.

- 결정
- 막힘
- 실패 원인
- 해결 방향
- 다음 단계
- 관련 파일/커밋/이슈 연결

### 5.3 변경 맥락 회수

사용자가 파일, 함수, 브랜치, 커밋, 이슈를 기준으로 질문하면, 관련 기억을 묶어서 보여준다.

- 배경이 된 사건(`episodic`)
- 일반화된 지식(`semantic`)
- 반복 절차(`procedural`)
- 현재 세션 맥락(`working`)

---

## 6. 메모리 모델

핵심 원칙은 `많이 저장하는 것`이 아니라 `다음 세션에 필요한 기억만 구조화하는 것`이다.

### 6.1 기억해야 하는 것

- 현재 작업 상태
- 의사결정
- 문제 해결 흔적
- 사용자/프로젝트 선호
- 재사용 가능한 절차
- 열린 루프

### 6.2 기억하지 말아야 하는 것

- 모든 터미널 출력 원문
- 모든 대화 원문
- 일회성 잡음
- 민감정보

### 6.3 메모리 타입 매핑

- `working`: 현재 세션 상태
- `episodic`: 작업 사건 기록
- `semantic`: 프로젝트 사실, 규칙, 선호
- `procedural`: 반복 작업 절차

### 6.4 연속성 복구를 위한 최소 메모리 스키마

초기 제품은 일반 노트보다 강한 구조를 갖는 편이 좋다.

- `task`
- `decision`
- `blocker`
- `next_step`
- `artifact_link`

이 문서의 해석/추론:

- `memento`의 기존 타입을 유지하면서, 위 5개 필드를 기억 생성 규약으로 두면 초기 제품의 차별점을 유지할 수 있다.

#### Memento 매핑 규약

초기 구현에서는 새 전용 테이블을 바로 도입하기보다, 기존 `memento` 메모리 구조 위에 아래 규약으로 얹는 편이 적절하다.

- 메모리 타입:
  - 현재 진행 상태는 `working`
  - 세션 사건과 결정은 `episodic`
  - 반복 규칙과 프로젝트 선호는 `semantic`
  - 재사용 가능한 작업 순서는 `procedural`
- `tags`:
  - `task`, `decision`, `blocker`, `next-step`, `artifact-link` 같은 역할 태그를 사용
- `origin_source` 또는 동등한 JSON 메타:
  - `project`, `branch`, `commit`, `file`, `issue`, `session_id` 같은 아티팩트 연결 정보를 저장
- `importance`:
  - blocker, 장기 결정, 반복 절차는 높은 값
  - 일시적 작업 상태는 낮은 값

이 규약의 목적은 스키마를 크게 늘리지 않고도, 연속성 복구에 필요한 최소 구조를 안정적으로 유지하는 데 있다.

---

## 7. 자동 수집 규칙과 승인 경계

### 7.1 자동으로 가능한 것

- 프로젝트/브랜치/열린 파일/최근 커밋/최근 명령 메타데이터 수집
- 세션 시작/종료 요약
- 의미 있는 이벤트의 기억화
- 기억 후보 추천
- 관련 기억 추천, 열린 루프 감지

### 7.2 승인 없이는 하면 안 되는 것

- 파일 생성/수정/삭제
- git commit, push, branch 변경
- 메시지 전송
- 캘린더 변경
- 이슈/PR 작성 및 수정
- 시스템 설정 변경

### 7.3 운영 원칙

- `읽기/관찰/요약/기억화`는 기본 자동
- `쓰기/전송/실행`은 기본 승인

### 7.4 자동 수집 트리거

- 브랜치 전환
- 커밋 직후
- 테스트 실패 후 수정 방향 확정 시점
- 긴 세션 종료
- 사용자의 명시적 기억 요청
- 반복 접근이 감지되는 파일/이슈

### 7.5 저장 억제 조건

- 의미 없는 짧은 명령 반복
- 설치/빌드 로그 원문 전체
- 곧바로 무의미해진 오류
- 민감정보 포함 데이터
- 사용자가 저장 제외로 표시한 컨텍스트

---

## 8. 실패 시 동작

초기 제품의 기본 전략은 `보수적 축소`다.

- 기억 회수 실패: 약한 resume만 제공하고, 기억 부족을 명시
- 확신도 낮음: 단정하지 않고 `가능성`으로 표기
- 자동 기억 생성 실패: 요약 대신 `review candidate`로 보류
- 승인 흐름 실패: 외부 액션 미실행
- 민감정보 감지: 저장 차단 또는 마스킹
- 세션 종료 요약 실패: `next_step`, `blocker`, `artifact_link` 최소 단위 저장

---

## 9. 품질 기준

초기 성공 기준은 “얼마나 많이 저장했는가”가 아니라 “다음 날 바로 이어서 일할 수 있는가”다.

- `resume usefulness`
- `next-step accuracy`
- `decision recall quality`
- `noise rate`
- `approval trust`

이 문서의 해석/추론:

- `memento`의 기존 검색 품질 메트릭과 메타 메모리 통계를 활용하면, 이 제품의 UX 지표와 연결할 수 있다.

---

## 10. MVP 범위

### 10.1 포함

- IDE 패널에서 `Resume / Recent Decisions / Open Threads / Next Actions` 제공
- CLI에서 세션 시작/종료/명시적 기억 저장
- 입력 원천은 `IDE/코드 작업`을 우선 지원
- 자동 작업 로그는 `결정`, `막힘`, `다음 단계`, `관련 아티팩트` 중심
- 외부 액션은 제안 가능하지만 기본 승인 필요
- `memento`의 기존 메모리 타입과 recall/anchor/relation 활용

### 10.2 제외

- 범용 자율 에이전트
- 다중 채널 게이트웨이의 즉시 복제
- 팀 협업용 멀티유저 시스템
- 모든 로그/대화의 완전 저장
- 메일/캘린더/메신저의 본격 자동화

---

## 11. 단계적 확장 순서

### Phase 1: Developer Continuity

- IDE 패널
- CLI 동반자
- 작업 이어받기
- 자동 작업 로그
- 변경 맥락 회수

### Phase 2: Work Knowledge Assistant

- 업무 대화 입력 흡수
- 회의/논의/결정 정리
- 프로젝트 지식 연결 강화

### Phase 3: Personal Operating Assistant

- 일정/리마인드/개인 운영 흐름
- 메신저 채널 연결
- 경량 플래너 강화

---

## 12. 결론

초기 제품은 `OpenClaw`처럼 채널 중심의 범용 비서를 먼저 만드는 것이 아니라, `memento`를 정본으로 삼는 `memory-native developer assistant`로 가는 편이 적절하다.

다만 코드 운영 관점에서는 `memento core`와 개인비서를 같은 계층으로 두면 안 된다. 따라서 같은 저장소 안에서도 `packages/memento-core`와 `packages/memento-assistant`를 분리하고, `assistant -> core` 단방향 의존 규칙을 유지하는 것이 Phase 1의 전제다.

핵심 제품 가치는 아래 한 문장으로 요약된다.

`개발자가 어제 하던 일을 오늘 정확히 이어서 하게 만드는 개인 데스크톱 비서`

이 방향은 `memento`의 기존 강점을 그대로 활용하면서, 이후 실행 자동화와 플래닝, 그리고 메신저 채널 확장으로 자연스럽게 이어질 수 있다.
