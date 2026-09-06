# Feature Specification: 대시보드 검토·세션 비동기 상태와 모바일 Anchor Map 안정화

**Feature Branch**: `feature/fix-dashboard-anchor-map`
**Spec Directory**: `specs/668-883-fix-dashboard-async-anchor`
**Created**: 2026-09-06
**Status**: Executed — review PASS
**Issue**: [#883](https://github.com/jee1/memento/issues/883)
**Input**: fix(dashboard): 검토·세션 비동기 상태와 모바일 Anchor Map 안정화 — Review Queue stale preview, Agent Sessions race, SSE/poll selection wipe, checkbox Space, mobile map 0px, auth `[hidden]` CSS

## Problem Statement

Admin 대시보드에서 비동기 응답이 늦게 도착하면 **현재 선택과 다른 후보/세션의 본문**이 그려지고, Review/Dismiss는 **다른 ID**로 POST될 수 있다. SSE·poll 갱신은 선택·미리보기·bulk를 지우고, 체크박스 Space는 행 미리보기만 연다. 좁은 viewport에서는 Anchor Map 높이가 0이 되고, 인증 후 sign-in 폼이 CSS `display:flex` 때문에 계속 보일 수 있다.

## Goals

- 미리보기 내용·선택 UI·Review/Dismiss 대상은 **항상 동일 candidate**를 가리킨다.
- 세션 상세/injection/timeline/cursor는 **현재 선택보다 오래된 응답**으로 덮이지 않는다.
- 실시간 목록 갱신 후에도 **남아 있는** 후보의 선택·미리보기·bulk를 유지한다.
- 체크박스에서 Space는 **체크 토글**만 하고 preview를 열지 않는다.
- 320–390px에서도 탭 탐색 가능, Anchor Map **사용 가능 최소 높이** 유지.
- 인증된 상태에서는 sign-in 폼만 숨긴다 (`[hidden]` vs `display:flex` 충돌 해소).
- 위 시나리오는 **E2E 또는 DOM 수준 회귀 테스트**로 고정한다.

## Non-Goals

- Anchor Map force-layout / WS broadcast / 검색 정렬 등 #883 범위 밖 앵커 UX 결함 (별도 이슈).
- Review Queue 백엔드 선정·SSE 허브 재설계.
- Agent Sessions API 계약 변경.
- Playwright Chromium 설치/CI 브라우저 패키징 문제 해결 (로컬 executable 부재는 테스트 전략에서 우회).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review Queue stale preview 차단 (Priority: P1)

운영자가 후보 A를 고른 뒤 빠르게 B로 바꾸면, A의 memory preview가 늦게 와도 B의 본문·버튼 대상이 유지된다.

**Why this priority**: 잘못된 candidate에 Review/Dismiss가 나가면 데이터 손상.

**Independent Test**: 합성 지연 Promise로 A→B 선택 후 A 응답 도착 시 DOM/state가 B만 반영하는지 검증.

**Acceptance Scenarios**:

1. **Given** A 선택 후 preview fetch 진행 중, **When** B를 선택하고 A 응답이 늦게 도착하면, **Then** preview content·memory label은 B이고 Review/Dismiss POST 대상은 B의 candidate ID다.
2. **Given** B가 선택된 상태, **When** A 응답이 도착하면, **Then** UI 상태(selectedRow, preview fields, action enablement)가 A로 바뀌지 않는다.

---

### User Story 2 - Agent Sessions 응답 역전 차단 (Priority: P1)

세션 A→B를 빠르게 전환해도 A의 detail/injections/timeline이 B 화면을 덮지 않는다.

**Why this priority**: 목록에는 generation이 있으나 상세 경로에는 없어 동일 계열 버그.

**Independent Test**: `selectSession`/`loadTimeline`에 generation 또는 selectedSessionId 가드를 두고 지연 응답 시뮬레이션.

**Acceptance Scenarios**:

1. **Given** 세션 A detail fetch 진행 중, **When** B를 선택하고 A 응답이 늦게 오면, **Then** detail·injections·timeline·observation cursor는 B 기준만 반영한다.
2. **Given** 목록 `loadGeneration` 가드가 있는 상태, **When** 상세 경로를 고치면, **Then** 목록과 동일 패턴의 stale-drop이 적용된다.

---

### User Story 3 - SSE/poll 후 선택·목록 정합성 (Priority: P1)

실시간 갱신 후에도 목록이 정확하고, 아직 존재하는 후보의 선택·미리보기·bulk가 유지된다. poll은 pending 수뿐 아니라 목록 변경을 반영한다.

**Why this priority**: SSE 전체 재렌더·count-only poll이 운영 중 상태 소실/고착을 만든다.

**Independent Test**: 후보 감소·동수 교체·우선순위 변경·SSE 이벤트 후 state/DOM 스냅샷.

**Acceptance Scenarios**:

1. **Given** 후보 C가 선택·bulk에 포함, **When** SSE/poll로 목록이 갱신되고 C가 남으면, **Then** 선택·가능하면 preview·bulk 체크가 유지된다.
2. **Given** C가 목록에서 제거됨, **When** 갱신되면, **Then** C 선택/bulk는 제거되고 preview는 안전하게 리셋된다.
3. **Given** pending count는 동일하지만 ID 집합·priority/status가 바뀜, **When** poll하면, **Then** 테이블이 새 목록을 반영한다.

---

### User Story 4 - 체크박스 Space 접근성 (Priority: P2)

키보드 사용자가 체크박스에서 Space로 bulk 선택을 토글한다.

**Why this priority**: 현재 tbody keydown이 Space 기본동작을 막고 행 preview만 연다.

**Independent Test**: checkbox를 타깃으로 Space keydown 시 `preventDefault`/onRowActivate가 호출되지 않음.

**Acceptance Scenarios**:

1. **Given** 포커스가 행 체크박스, **When** Space, **Then** 체크가 토글되고 preview는 열리지 않는다.
2. **Given** 포커스가 행(체크박스 아님), **When** Enter/Space, **Then** 기존처럼 preview가 열린다.

---

### User Story 5 - 모바일 Anchor Map·탭·auth 가시성 (Priority: P2)

390×844(및 320px)에서 탭에 접근 가능하고 map 영역 높이가 0이 아니다. 로그인 후에는 sign-in 폼만 숨겨진다.

**Why this priority**: 모바일에서 맵 사용 불가 + 인증 UI 혼란.

**Independent Test**: CSS/computed style 또는 jsdom layout fixture; auth `[hidden]` vs `.dashboard-auth-form { display:flex }` 충돌 해소 검증.

**Acceptance Scenarios**:

1. **Given** viewport 390×844, **When** Anchor Map 탭, **Then** map 컨테이너 높이가 0이 아니고 최소 사용 가능 높이를 유지한다.
2. **Given** 좁은 폭, **When** 탭 바가 overflow하면, **Then** 가로 스크롤로 모든 탭에 접근 가능하다.
3. **Given** 인증 완료로 auth form에 `hidden`이 설정됨, **When** 스타일 적용, **Then** sign-in 폼은 보이지 않고 sign-out 등 인증 후 UI만 보인다.

---

### Edge Cases

- Preview fetch 중 같은 행을 다시 클릭해도 이중 적용/깜빡임 없이 최종 선택만 유효.
- Review/Dismiss in-flight 중 선택 변경: 진행 중 액션은 시작 시점 candidate에 묶이되, UI enablement는 현재 선택과 일치.
- SSE reconnect 직후 첫 스냅샷도 선택 보존 규칙을 따른다.
- poll 실패 backoff 중에도 수동 새로고침/행 선택은 동작한다.
- map 최소 높이와 toolbar 줄바꿈이 겹쳐도 본문 스크롤로 맵이 가려지지 않는다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Review preview 비동기 완료 시 현재 선택 candidate ID(또는 동등 generation)와 일치하지 않으면 DOM/state를 갱신하지 않는다.
- **FR-002**: Review/Dismiss 활성화 및 POST body의 candidate ID는 현재 선택과 항상 일치한다.
- **FR-003**: Agent Sessions `selectSession` / detail / injections / timeline(및 append timeline)은 stale 응답을 무시하는 generation 또는 selectedSessionId 검증을 가진다.
- **FR-004**: 목록 재렌더(SSE·poll·수동) 시 후보 ID 기준으로 가능한 선택·bulk·preview를 복원하고, 사라진 ID는 정리한다.
- **FR-005**: poll 적용 조건은 pending count 증가만이 아니라 목록 내용 변경(최소: candidate ID 집합 및 표시에 영향 있는 priority/status/due/order fingerprint)을 포함한다.
- **FR-006**: tbody keydown의 Enter/Space 행 활성화는 checkbox(및 그 자손) 타깃을 제외한다.
- **FR-007**: ≤390px 폭에서 `.m-tab-bar`(또는 동등)는 가로 스크롤로 모든 탭에 접근 가능해야 한다.
- **FR-008**: Anchor Map 탭에서 map 영역은 0px이 되지 않도록 최소 높이를 보장한다.
- **FR-009**: `[hidden]`이 적용된 `.dashboard-auth-form`(및 동등 auth 셸)은 `display:flex`보다 우선해 숨겨진다.
- **FR-010**: FR-001~009 회귀는 Vitest DOM/jsdom(또는 동등) 테스트로 고정한다. Playwright는 선택적 보조이며 Chromium 부재가 게이트를 막지 않는다.

### Key Entities

- **Review candidate row**: `data-candidate-id`, memory preview payload, bulk selection set.
- **Agent session selection**: `selectedSessionId`, load/detail generation, timeline cursor.
- **Realtime snapshot**: SSE/poll로 받은 candidate list + pending metadata.
- **Dashboard chrome**: tab bar, Anchor Map panel/toolbar, auth form visibility.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 합성 지연 A→B 시나리오에서 stale A preview 적용 횟수 = 0 (자동 테스트).
- **SC-002**: 합성 지연 세션 A→B에서 stale A detail/timeline 적용 횟수 = 0 (자동 테스트).
- **SC-003**: 목록 fingerprint 변경(동수 교체·priority 변경·감소) 후 테이블이 새 데이터를 반영 (자동 테스트).
- **SC-004**: checkbox Space가 `preventDefault`로 막히지 않음 (자동 테스트).
- **SC-005**: 390px fixture에서 map 컨테이너 computed/min height > 0 (테스트 또는 스타일 계약 검증).
- **SC-006**: auth form `[hidden]` 시 숨김 스타일이 적용됨 (자동 테스트).
- **SC-007**: 관련 기존 Review Queue Vitest(≥27) 및 신규 회귀가 green; `lint`/`type-check`/해당 테스트 통과.

## Assumptions

- 서버 API 스키마 변경 없이 프론트(및 필요 시 최소 CSS)만으로 해결 가능.
- 기존 `loadGeneration` 패턴을 세션 상세에 확장하는 것이 올바른 방향.
- 이 워크트리 브랜치 `feature/fix-dashboard-anchor-map`에서 구현한다.

## Open Questions

| ID | Question | Resolution | Status |
|----|----------|------------|--------|
| Q1 | Review stale guard 단위? | **C**: preview request generation + selected candidate ID 일치 검사 | Resolved |
| Q2 | Sessions stale guard? | **B**: selectedSessionId 재확인 + detail/timeline 전용 generation (목록 `loadGeneration`과 분리) | Resolved |
| Q3 | Poll 변경 감지 fingerprint? | **B**: candidate ID 집합 + priority/status(+due) fingerprint | Resolved |
| Q4 | SSE 후 preview 유지? | **B**: 후보·memory 동일 시 선택+preview+bulk 유지; 없으면 해당 ID만 정리 | Resolved |
| Q5 | Map min-height? | **B**: map 컨테이너 `min-height: 200px` (+ 탭 바 `overflow-x: auto`) | Resolved |
| Q6 | 테스트 주력? | **C**: Vitest/jsdom 주력, Playwright optional (Chromium 부재 시 게이트 비차단) | Resolved |

## Clarifications (from brainstorm)

- **FR-001/002**: `previewGeneration` 증가 + 완료 시 `candidateId === currentSelectedId` 이중 가드.
- **FR-003**: `selectSession` 시작 시 `detailGeneration++`; detail/injections/timeline 완료 시 generation·`selectedSessionId` 모두 일치해야 렌더.
- **FR-004/005**: `renderTable`이 무조건 `clearRowSelection`/`resetPreviewPanel`하지 않도록; diff 후 생존 ID 복원. poll은 fingerprint 변경 시에만 full apply.
- **FR-008**: `#anchor-map` 또는 래퍼에 `min-height: 200px`; flex `min-height: 0` 체인과 함께 본문 스크롤 유지.
- **FR-009**: `[hidden] { display: none !important; }` 또는 `.dashboard-auth-form[hidden]` 특이성으로 `display:flex` 덮기.

## Brainstorm Log

### 2026-09-06 — session 1 (auto-select Recommended Q1–Q6)

- Categories: concurrency (stale fetch), realtime sync, a11y keyboard, mobile layout, auth visibility, test strategy.
- All six Recommended options accepted in one pass (user Speckit canonical: brainstorm auto-pick).
- Spec Status → Brainstormed. Open Questions = 0.
- No further brainstorm needed before plan.
