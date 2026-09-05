# Feature Specification: 설치 패키지 postinstall DB 초기화 실패가 catch 에 삼켜짐

**Feature Branch**: `feature/fix-install-postinstall-db-catch`
**Spec Directory**: `specs/666-860-fix-install-postinstall-db-catch`
**Created**: 2026-09-05
**Status**: Executed — review PASS
**Issue**: [#860](https://github.com/jee1/memento/issues/860)
**Related**: [#857](https://github.com/jee1/memento/issues/857) / PR #858 (같은 파일 `.ts` import), [#859](https://github.com/jee1/memento/issues/859) (`files: ["scripts"]` 패키징)
**Input**: fix(install): 설치된 패키지에서 postinstall DB 초기화가 항상 실패하는데 catch 가 삼켜 조용히 넘어감

## Problem Statement

npm 으로 설치한 패키지에서 **DB 초기화가 한 번도 실행되지 않는다.**
`npm install` 은 성공한 것처럼 끝난다.

설치 후 자동 설정이 저장소에만 존재하는 경로로 DB 초기화를 호출한다.
패키지 tarball 에는 그 경로가 없으므로 호출은 **반드시** 실패한다.
실패는 잡혀서 경고만 찍히고 종료 코드는 0 이다. 안내하는 수동 명령도
저장소 기준이라 설치 환경에서 동작하지 않는다.

#857 의 패키지 스모크도 install 이 안 깨지는지만 봐서 이 결함을 놓쳤다.

## Goals

- 설치 패키지 postinstall 이 **실제로** DB 를 초기화한다.
- 저장소 개발 환경에서도 동일하게 초기화가 성공한다.
- 초기화 실패는 조용히 삼키지 않는다 (종료 코드 또는 동등하게 설치를 실패로 드러냄).
- 패키지 스모크가 "install 성공 + postinstall 이후 DB 파일 존재"를 검증한다.

## Non-Goals

- #859 의 `files: ["scripts"]` 가 `.ts` 130개를 싣는 패키징 문제 (별도 이슈).
- postinstall 의 네이티브 모듈 재빌드 soft-fail 정책 변경.
- `.env` 생성·시작 스크립트 생성 등 DB 외 auto-setup 단계의 실패 정책 전면 재설계.
- 기본 DB 경로(`DB_PATH` / 홈 디렉터리 기본값) 자체 변경.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 설치 후 DB 가 실제로 생긴다 (Priority: P1)

사용자가 레지스트리/tarball 에서 패키지를 설치한다. postinstall 자동 설정이
끝나면 기본(또는 지정한) DB 경로에 데이터베이스가 존재하고, 서버를 바로
기동할 수 있다.

**Why this priority**: 지금 증상은 "설치는 됐는데 DB 가 없는" 상태다. 다른
개선은 이 전제 위에 있다.

**Independent Test**: 빈 임시 디렉터리에 패키지 tarball 을 설치한 뒤,
설정한 DB 경로에 파일이 생겼는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 패키지 tarball 이 저장소 소스 트리(`packages/`)를 포함하지 않는 상태, **When** 빈 환경에 설치하면, **Then** postinstall DB 초기화가 성공하고 DB 파일이 존재한다.
2. **Given** 동일 설치, **When** 초기화에 쓰인 경로를 조회하면, **Then** 그 경로는 저장소 전용 소스 경로가 아니다.
3. **Given** 저장소 루트에서 개발용 설치/설정을 실행한 상태, **When** 동일 자동 설정의 DB 초기화 단계를 실행하면, **Then** 개발 환경에서도 초기화가 성공한다.

---

### User Story 2 - 초기화 실패가 설치 성공으로 위장되지 않는다 (Priority: P1)

DB 초기화가 실패하면 사용자가 "설치 완료"로 오해하지 않는다. 실패는
종료 코드 또는 동등한 설치 실패로 드러나고, 안내하는 수동 복구 경로도
설치 환경에서 의미가 있다.

**Why this priority**: 실패를 삼키는 것이 이 버그가 오래 숨은 직접 원인이다.
경로만 고치고 swallow 를 남기면 다음 회귀도 같은 방식으로 숨는다.

**Independent Test**: 초기화가 의도적으로 실패하는 조건에서 postinstall/
자동 설정을 실행해, 프로세스가 비정상 종료(또는 설치가 실패)하는지 확인한다.

**Acceptance Scenarios**:

1. **Given** DB 초기화 단계가 오류를 내는 상태, **When** 자동 설정의 해당 단계가 실행되면, **Then** 프로세스는 성공(0)으로 끝나지 않는다.
2. **Given** 초기화 실패 메시지, **When** 사용자에게 안내되는 수동 복구 방법을 보면, **Then** 저장소에만 존재하는 경로/명령만 가리키지 않는다 (설치 환경에서도 따라 할 수 있거나, 그런 안내를 하지 않는다).
3. **Given** 초기화가 성공한 상태, **When** 자동 설정이 끝나면, **Then** 성공 로그가 남고 종료 코드는 0 이다.

---

### User Story 3 - 패키지 스모크가 DB 초기화 회귀를 잡는다 (Priority: P2)

유지보수자가 패키지 번들 검증을 돌리면, install 이 안 깨지는 것뿐만 아니라
postinstall 이후 DB 가 실제로 생겼는지도 검사한다. 검사가 실패하면 게이트가
막는다.

**Why this priority**: #857 스모크가 이 결함을 통과시킨 재발을 막는다. P1
수정 없이 스모크만 있으면 항상 빨갛고, P1 없이 스모크를 미루면 다시 숨는다.
P1 직후 같은 작업 단위로 묶는다.

**Independent Test**: 고치기 전 상태(또는 초기화를 끄는 테스트 더블)에서
스모크를 돌리면 실패하고, 수정 후에는 통과하는지 확인한다.

**Acceptance Scenarios**:

1. **Given** 패키지 번들 검증의 empty-temp 설치 스모크, **When** 설치가 끝나면, **Then** 스모크가 지정한 DB 경로에 DB 파일이 존재하는지를 검사한다.
2. **Given** postinstall 이 DB 를 만들지 못한 상태, **When** 동일 스모크를 실행하면, **Then** 검증은 실패(비0)한다.
3. **Given** 스모크를 의도적으로 끄는 설정이 켜진 상태, **When** 번들 검증을 실행하면, **Then** 기존처럼 해당 스모크 구간만 건너뛸 수 있다 (전체 게이트 구조는 유지).

---

### Edge Cases

- 이미 DB 파일이 있는 경로에 설치/설정을 다시 돌리면: 기존 DB 를 파괴하지 않고 초기화/마이그레이션 경로로 안전히 진행한다 (기존 초기화 동작 유지).
- `DB_PATH` 가 설정된 경우: 그 경로를 사용한다. 스모크는 홈 디렉터리를 오염시키지 않도록 임시 경로를 지정할 수 있어야 한다.
- 네이티브 모듈 재빌드 실패는 이번 범위에서 soft-fail 정책을 바꾸지 않는다. DB 초기화 실패와 혼동하지 않는다.
- postinstall 이 패키지 디렉터리를 cwd 로 쓰더라도, 초기화 진입점은 저장소 전용 소스 트리에 의존하지 않는다.
- empty-temp 스모크에서 스크립트를 끄는 설치 옵션을 쓰면 DB 검사를 할 수 없다. 스모크는 postinstall 이 도는 기본 설치 경로를 전제로 한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 설치 패키지 postinstall 의 DB 초기화는 패키지에 실제로 존재하는 런타임 진입점을 사용해야 한다. 저장소에만 있는 소스 경로에 의존하면 안 된다.
- **FR-002**: 저장소 개발 환경에서 동일 자동 설정의 DB 초기화도 성공해야 한다.
- **FR-003**: DB 초기화 단계가 실패하면 자동 설정/postinstall 은 성공으로 끝나지 않아야 한다.
- **FR-004**: 실패 시 사용자에게 안내하는 수동 복구 방법은 설치 환경에서 실행 가능하거나, 실행 불가능한 저장소 전용 안내를 제거·대체해야 한다.
- **FR-005**: 패키지 번들 empty-temp 스모크는 postinstall 이후 지정 DB 경로에 DB 파일이 생겼는지 검사해야 한다.
- **FR-006**: DB 파일이 없으면 해당 스모크는 실패해야 한다.
- **FR-007**: 스모크를 끄는 기존 스위치가 있으면 그 의미(해당 구간 스킵)를 유지한다.

### Key Entities

- **Install package root**: npm 이 설치한 패키지 루트. tarball 내용이 펼쳐진 위치.
- **DB path**: 초기화가 생성·갱신하는 데이터베이스 파일 위치 (`DB_PATH` 또는 제품 기본 경로).
- **Pack smoke**: tarball 생성 후 빈 환경 설치로 런타임 폐쇄·postinstall 결과를 검사하는 게이트.

### Assumptions

- `@memento/core` 런타임은 설치 패키지 안에 번들되어 있으며, 공개 초기화 API 로 DB 초기화가 가능하다 (기존 스크립트들이 이미 그 경로를 씀).
- empty-temp 스모크는 네이티브 모듈이 설치되는 일반 `npm install` 경로를 사용한다 (현재 검증기와 동일).
- 기본 DB 경로가 홈 하위일 수 있으므로, 스모크는 검증용으로 `DB_PATH` 를 임시 경로에 둘 수 있다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 빈 환경 tarball 설치 1회 후, 스모크가 지정한 DB 경로에 DB 파일이 존재한다 (존재율 100%).
- **SC-002**: 저장소에서 동일 DB 초기화 단계를 실행하면 성공(종료 0)한다.
- **SC-003**: DB 초기화를 강제로 실패시키면 자동 설정 종료 코드가 비0 이다.
- **SC-004**: 패키지 번들 검증 게이트는 DB 미생성 시 비0 으로 실패한다.
- **SC-005**: #857 계열 "scripts 가 `.ts` 를 import 하지 않는다" 회귀 검사는 계속 통과한다.

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q1 | DB 초기화 실패 시 경고만 vs 비0 종료? | Resolved | **비0 종료**. 경고만 남기면 #860 재발과 동일한 위장이 된다. FR-003/SC-003. |
| Q2 | 저장소 `packages/` 경로 fallback 유지 vs 단일 런타임 진입점? | Resolved | **환경 분기**. 모노레포(`packages/.../init.ts` 존재)는 `tsx` 소스 경로(CI `npm ci` 직후 dist 미빌드). 설치 패키지(tarball)는 `@memento/core` 만 쓰고 실패 시 비0. (단일 API만 쓰면 postinstall 이 build 전에 깨짐 — CI 회귀.) |
| Q3 | 스모크 DB 경로를 홈 기본값 vs 임시 `DB_PATH`? | Resolved | **임시 `DB_PATH`**. 기본 경로가 홈 하위일 수 있어 CI/개발자 홈을 오염시키지 않는다. FR-005. |
| Q4 | 실패 안내를 `db:init` 유지·문구 수정 vs 설치 환경용 다른 안내? | Resolved | **저장소 전용 `npm run db:init` 안내를 설치 실패 메시지에서 제거·대체**. 실패 시에는 오류 자체와, 설치 환경에서 의미 있는 복구 힌트(예: `DB_PATH` 확인, 패키지 재설치)만 남긴다. 저장소 개발자용 `db:init` 스크립트 자체는 Non-Goals 밖 유지. |

## Brainstorm Log

### 2026-09-05 — session 1 (auto-select recommended)

- 이슈 #860 본문이 원인·제안·스모크 공백을 이미 고정. 추가 인터뷰 없이 권장안 일괄 채택.
- Categories covered: error/failure visibility (Q1), install vs repo entrypoint (Q2), smoke isolation (Q3), operator guidance (Q4).
- Out of scope confirmed: #859 packaging of `.ts` under `scripts/`, native rebuild soft-fail, default `DB_PATH` change.
- Spec Status → Brainstormed. Next: `/speckit.plan`.
