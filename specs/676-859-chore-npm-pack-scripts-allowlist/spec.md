# Feature Specification: npm tarball `files:["scripts"]` 허용 목록 축소

**Feature Branch**: `feature/chore-build-files-scripts-tarball-.ts-130`
**Spec Directory**: `specs/676-859-chore-npm-pack-scripts-allowlist`
**Created**: 2026-09-07
**Status**: Executed — review PASS
**Issue**: [#859](https://github.com/jee1/memento/issues/859)
**Related**: [#857](https://github.com/jee1/memento/issues/857) / PR #858 (`.ts` import in postinstall), [#860](https://github.com/jee1/memento/issues/860) / PR #864 (postinstall DB init)
**Input**: chore(build): `files:["scripts"]` 가 tarball 에 실행 불가 `.ts` 130개를 실음 — 허용 목록으로 축소

## Problem Statement

루트 `package.json` 의 `files` 에 `scripts` 디렉터리 전체가 들어 있다.
`npm pack` 결과 tarball 에는 설치된 패키지에서 실행할 수 없는 `.ts`(및 테스트 픽스처 `.spec.ts`)가
대량으로 실린다. 배포판을 만드는 도구(`prepack-bundle-core.js`, `verify-npm-pack-bundle.js` 등)도
배포판 안에 들어 있다.

용량보다 **표면적**이 문제다. #857 은 "설치 환경에서 실행될 일이 없다"고 여긴 파일이
`postinstall` 경로에 걸려 publish 를 막은 사고다. 실릴 이유가 없는 파일이 실리면 같은 사고가 다시 난다.

실측(이슈 작성 시점 main / 현재 worktree 모두 `scripts/` 하위 `.ts` ≥130):

| | 개수 (대략) |
|---|---:|
| `scripts/` 전체 | ~160+ |
| 그중 `.ts` | **~130** |
| 그중 `.spec.ts` | **~50+** |

## Goals

- 설치된 패키지에서 의미 있는 `scripts/` 진입점만 tarball 에 남긴다 (`bin` / `postinstall` 이 실제로 부르는 파일).
- tarball 에 `scripts/**/*.ts`(테스트 포함) 및 pack/verify 전용 스크립트가 실리지 않는다.
- `verify-npm-pack-bundle.js` 가 허용 목록 밖 `package/scripts/*` 경로를 보면 실패한다.
- #860 이후 postinstall DB 초기화·empty-temp 스모크는 계속 통과한다.

## Non-Goals

- 저장소 안 `scripts/` 트리 삭제·이사·TypeScript 제거.
- `dist` / `prompts` / `config` / 문서 `files` 항목의 전면 재설계.
- #860 DB 초기화 동작 변경 (이미 머지됨; allowlist 에 그 런타임 파일을 **포함**만 한다).
- 네이티브 모듈 재빌드 soft-fail 정책 변경.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 설치 패키지에 실행 불가 `.ts` 가 없다 (Priority: P1)

사용자가 레지스트리/tarball 에서 패키지를 설치한다. `node_modules/<pkg>/scripts/` 아래에는
postinstall·`memento-setup` 이 필요로 하는 `.js` 만 있고, `.ts` / `.spec.ts` / pack 전용 스크립트는 없다.

**Why this priority**: 표면적 축소가 이슈의 핵심. 이게 안 되면 #857 류 재발 여지가 남는다.

**Independent Test**: `npm pack --ignore-scripts` 산출 tarball 을 열어 `package/scripts/**/*.ts` 가 0건인지 확인.

**Acceptance Scenarios**:

1. **Given** 현재 `files` 설정으로 pack 한 상태, **When** tarball 의 `package/scripts/` 경로를 열거하면, **Then** `.ts` 로 끝나는 엔트리가 0개다.
2. **Given** 동일 tarball, **When** `package/scripts/` 파일 목록을 보면, **Then** `prepack-bundle-core.js`, `verify-npm-pack-bundle.js`, `postpack-restore-workspace.js`, `pack-with-restore.js`, `verify-bin.js` 가 없다.
3. **Given** 동일 tarball, **When** `bin.memento-setup` / `postinstall` 이 가리키는 파일을 보면, **Then** 해당 `.js` 와 그것이 직접 import 하는 `scripts/lib/*` 런타임 파일이 존재한다.

---

### User Story 2 - 허용 목록 밖 경로는 pack 게이트가 막는다 (Priority: P1)

유지보수자가 `npm run verify-pack-bundle`(또는 동일 검증기)을 돌리면, tarball 안
`package/scripts/` 아래 허용 목록에 없는 파일이 있으면 검증이 실패(비0)한다.

**Why this priority**: `files` 만 고치고 게이트가 없으면 다음 PR 이 다시 `scripts` 통째 추가해도 CI 가 못 잡는다.

**Independent Test**: 허용 목록에 없는 가짜 경로 집합을 검증 함수에 넣으면 비어 있지 않은 위반 목록이 나오고, 허용만 있으면 빈 목록이다. 통합은 실제 pack 후 게이트 통과.

**Acceptance Scenarios**:

1. **Given** tarball 경로 집합에 `package/scripts/foo.ts` 가 포함됨, **When** scripts allowlist 검사를 실행하면, **Then** 검사는 실패하고 해당 경로가 위반으로 보고된다.
2. **Given** tarball 경로가 허용 목록과 정확히 일치(및 허용 경로의 디렉터리 prefix 만), **When** 동일 검사를 실행하면, **Then** 검사는 통과한다.
3. **Given** `files` 가 다시 `scripts` 디렉터리 전체를 포함하도록 회귀한 상태, **When** `verify-npm-pack-bundle` 을 실행하면, **Then** 게이트가 비0 으로 실패한다.

---

### User Story 3 - 설치 후 postinstall / setup 은 계속 동작한다 (Priority: P1)

허용 목록으로 줄인 뒤에도 empty-temp 설치 스모크는 #860 과 같이 postinstall 후 DB 파일이 생기고,
`bin` 세 경로의 파일이 존재하며 JS resolve 가 성공한다.

**Why this priority**: 위생을 위해 기능을 깨면 안 된다. #860 이 넣은 `postinstall-db-init.js` 가 allowlist 에서 빠지면 즉시 회귀한다.

**Independent Test**: `node scripts/verify-npm-pack-bundle.js` (smoke on) 가 통과.

**Acceptance Scenarios**:

1. **Given** 축소된 `files` 로 만든 tarball, **When** empty-temp `npm install` 하면, **Then** postinstall 이 성공하고 스모크 `DB_PATH` 에 DB 파일이 있다.
2. **Given** 동일 설치, **When** `bin` 항목을 확인하면, **Then** `memento-mcp-server`, `memento-dev`, `memento-setup` 대상 파일이 모두 존재한다.
3. **Given** `MEMENTO_PACK_SMOKE=0`, **When** 검증기를 실행하면, **Then** allowlist 검사(tarball 경로)는 여전히 수행되고 empty-temp 구간만 스킵된다.

---

### Edge Cases

- tarball 에 `package/scripts/` 또는 `package/scripts/lib/` **디렉터리 엔트리**만 있고 파일이 allowlist 와 일치하면 통과 (디렉터리 자체는 위반이 아님).
- `package.json` 의 `files` 에 없는 파일이 `bin` 에만 있으면 npm 이 포함하지 않을 수 있음 → allowlist·`files`·`bin`/`postinstall` 이 동일 집합을 가리켜야 한다.
- `#`860 이후 런타임 클로저: `auto-setup.js` → `lib/cli-runtime.js` + `lib/postinstall-db-init.js`. 이슈 초안 allowlist 에 `postinstall-db-init.js` 가 빠져 있었으므로 **반드시 포함**.
- Windows 경로 구분자: 검증은 tarball 정규화 경로(`/`) 기준 (기존 `listUstarGzipEntries` 와 동일).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 루트 `package.json` `files` 는 `scripts` 디렉터리 전체가 아니라, 설치된 패키지에서 필요한 `scripts/` 파일만 나열해야 한다.
- **FR-002**: 그 최소 집합은 최소한 `scripts/auto-setup.js`, `scripts/lib/cli-runtime.js`, `scripts/lib/postinstall-db-init.js` 를 포함해야 한다.
- **FR-003**: 게시 tarball 의 `package/scripts/` 아래에 `.ts` 파일이 없어야 한다.
- **FR-004**: 게시 tarball 의 `package/scripts/` 아래에 pack/verify 전용 스크립트(`prepack-bundle-core.js`, `postpack-restore-workspace.js`, `verify-npm-pack-bundle.js`, `pack-with-restore.js`, `verify-bin.js` 및 동등한 저장소 전용 도구)가 없어야 한다.
- **FR-005**: `verify-npm-pack-bundle.js` 는 tarball 엔트리에 대해 `package/scripts/` 파일 allowlist 검사를 수행하고, 위반 시 비0 으로 실패해야 한다.
- **FR-006**: allowlist 검사 로직은 단위 테스트 가능한 순수 함수(또는 동등 모듈)로 분리되어, 실제 pack 없이도 위반/통과를 검증할 수 있어야 한다.
- **FR-007**: empty-temp 스모크(`MEMENTO_PACK_SMOKE` 기본 on)는 #860 DB 파일 존재 assert 및 bin/resolve 검사를 유지해야 한다.
- **FR-008**: `prompts`, `config`, `dist`, 문서·라이선스 `files` 항목은 이 이슈 범위에서 제거하지 않는다 (이슈 제안과 동일하게 유지).

### Key Entities

- **Pack entry path**: tarball 내부 경로 (`package/...`).
- **Scripts allowlist**: 게시가 허용된 `package/scripts/...` 파일 경로 집합.
- **Install runtime scripts**: `postinstall` / `memento-setup` 이 로드하는 `.js` 클로저.

### Assumptions

- 설치된 패키지에서 사용자·npm 이 실행하는 scripts 진입점은 `bin` 3개와 `postinstall`→`auto-setup.js` 뿐이다.
- `#`860 의 `postinstall-db-init.js` 는 이미 main 에 있다.
- `verify-npm-pack-bundle.js` 자체는 저장소에서만 돌리므로 tarball 에 실릴 필요 없다.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npm pack --ignore-scripts` tarball 에서 `package/scripts/**/*.ts` 개수 = 0.
- **SC-002**: 동일 tarball 의 `package/scripts/` 파일 개수가 allowlist 크기와 일치(디렉터리 엔트리 제외).
- **SC-003**: allowlist 단위 테스트가 위반/통과 케이스를 각각 ≥1개 고정한다.
- **SC-004**: `node scripts/verify-npm-pack-bundle.js` 가 allowlist + (#860) DB smoke 포함해 종료 0.
- **SC-005**: `scripts/js-scripts-no-ts-import` 회귀는 계속 통과.

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q1 | `files` 를 명시 파일 allowlist vs `scripts` + `!*.ts` 네거션? | Resolved | **명시 파일 allowlist**. 네거션은 다른 `.js` 도구·픽스처를 남긴다. FR-001/004. |
| Q2 | 이슈 초안의 allowlist(`auto-setup`+`cli-runtime`)만? | Resolved | **`postinstall-db-init.js` 추가 필수** (#860). FR-002. |
| Q3 | allowlist 검사를 dry-run 전용 새 스크립트 vs 기존 verify 에 부착? | Resolved | **기존 `verify-npm-pack-bundle.js` 에 부착** (이슈 제안). 로직은 `scripts/lib/` 순수 모듈로 분리해 단위 테스트 (FR-005/006). |
| Q4 | empty-temp smoke off 일 때 allowlist 검사도 스킵? | Resolved | **스킵하지 않음**. `MEMENTO_PACK_SMOKE=0` 은 empty-temp 만. allowlist 는 tarball 파싱 직후 항상 (US3-3). |

## Brainstorm Log

### 2026-09-07 — session 1 (auto-select recommended)

- 이슈 #859 본문이 원인·제안·관련 #857/#860 을 고정. 사용자 Speckit 규칙: brainstorm 추천 자동 선택.
- Categories: packaging surface (Q1), #860 runtime closure (Q2), gate placement (Q3), smoke interaction (Q4).
- Out of scope: repo scripts tree cleanup, dist/prompts/config redesign, DB init behavior.
- Spec Status → Brainstormed. Next: `/speckit.plan`.
