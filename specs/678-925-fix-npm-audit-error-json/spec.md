# Feature Specification: npm audit 오류 JSON fail-closed (#925)

**Feature Branch**: `feature/npm-audit-json-ci`  
**Spec Directory**: `specs/678-925-fix-npm-audit-error-json`  
**Created**: 2026-09-07  
**Status**: Executed — review PASS  
**Issue**: [#925](https://github.com/jee1/memento/issues/925)  
**Related**: [#756](https://github.com/jee1/memento/issues/756) (production audit gate), [#909](https://github.com/jee1/memento/issues/909) (의존성 조치 — 범위 밖)  
**Input**: 프로덕션 audit 스크립트가 `npm audit` 오류 JSON을 정상 보고서로 처리해 보안 CI가 fail-open 한다.

## Problem Statement

`scripts/check-production-audit-fixable.mjs` 는 `npm audit --omit=dev --json` 의 stdout 이 JSON 이면
`spawnSync` 종료 코드·보고서 스키마를 검사하지 않고 그대로 통과 경로로 보낸다.
감사 서비스 오류(`{"error":{"code":"E503",...}}`)처럼 **취약점 목록이 없는 오류 JSON** 도
`vulnerabilities || {}` 로 빈 객체 취급되어 `OK: no fixable ...` 와 exit 0 이 난다.

재현(이슈): `status: 1` + error JSON → 출력 `(no metadata)` / `OK: ...` / exit 0.

## Goals

- 감사 **오류 JSON**·**스키마 부재**·**명령/파싱 실패** 는 비정상 종료(비0).
- 정상 보고서에서 fixable High/Moderate/Critical vs upstream-blocked(`fixAvailable:false`) 분류는 #756 그대로.
- 오류 회귀를 잡는 단위 테스트 추가.

## Non-Goals

- #909 등 실제 High 취약점 패키지 업그레이드/override.
- `npm audit` 전체 정책 변경(severity 집합, `--omit=dev` 제거).
- 보안 워크플로 스텝 재배치(게이트 호출 경로는 유지; 스크립트 신뢰성만 고친다).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 감사 오류는 CI 를 실패시킨다 (Priority: P1)

유지보수자가 레지스트리/감사 서비스 장애로 `npm audit` 가 error JSON 만 돌려줘도,
프로덕션 audit 게이트는 성공으로 기록하지 않고 실패한다.

**Why this priority**: fail-open 이 이슈의 핵심 결함. 미검사 릴리스가 통과하면 게이트 의미가 없다.

**Independent Test**: error JSON 픽스처를 스크립트(또는 검증 함수)에 넣으면 비0 + 실패 메시지.

**Acceptance Scenarios**:

1. **Given** `{"error":{"code":"E503","summary":"audit service unavailable"}}`, **When** 게이트가 해당 보고서를 처리하면, **Then** 비0 으로 종료하고 OK 문구를 출력하지 않는다.
2. **Given** 동일 오류 보고서, **When** 출력을 보면, **Then** metadata 부재를 “취약점 0건”으로 해석하지 않는다(실패 사유가 드러난다).

---

### User Story 2 - 실행/파싱 실패도 fail-closed (Priority: P1)

`npm` 실행 자체가 실패하거나 stdout 이 JSON 이 아니면 게이트는 비0 이다.

**Why this priority**: 오류 JSON 만 막고 spawn/파싱 실패를 놓치면 같은 fail-open 구멍이 남는다.

**Independent Test**: 비JSON stdout·스키마 불완전 객체에 대해 검증이 실패한다.

**Acceptance Scenarios**:

1. **Given** stdout 이 JSON 이 아님, **When** 게이트가 로드를 시도하면, **Then** 비0 (기존 파싱 실패 경로 유지·강화).
2. **Given** JSON 이지만 `auditReportVersion` / `metadata.vulnerabilities` / `vulnerabilities` 중 하나 이상 없음, **When** 검증하면, **Then** 비0.
3. **Given** `spawnSync` 가 프로세스 기동 실패(`error` 설정), **When** 로드하면, **Then** 비0.

---

### User Story 3 - 정상 보고서 분류는 유지된다 (Priority: P1)

유효한 audit 보고서에서는 fixable High/Moderate/Critical 이 있으면 실패하고,
`fixAvailable:false` 인 동일 severity 는 Accepted 로 로그만 하고 통과한다.

**Why this priority**: #756 계약 회귀 금지.

**Independent Test**: 최소 정상 스키마 픽스처로 fixable→fail, accepted-only→pass.

**Acceptance Scenarios**:

1. **Given** 정상 스키마 + fixable high 1건, **When** 게이트 실행, **Then** 비0 및 FAIL 메시지.
2. **Given** 정상 스키마 + accepted-only high(`fixAvailable:false`), **When** 게이트 실행, **Then** exit 0 및 Accepted 로그.
3. **Given** 정상 스키마 + `npm audit` 가 취약점 때문에 status≠0, **When** 스키마가 유효하면, **Then** status 단독으로 실패하지 않고 분류 로직을 따른다.

---

### Edge Cases

- `vulnerabilities: {}` + 필수 메타 존재 → 정상 빈 보고서(통과).
- `error` 와 `vulnerabilities` 가 동시에 있으면 → 오류로 취급(fail-closed).
- 파일 인자 경로(`node ... audit.json`)에도 동일 스키마 검증 적용.
- `metadata` 는 있으나 `metadata.vulnerabilities` 없음 → 스키마 실패.
- `vulnerabilities` 가 배열/null → 스키마 실패(객체여야 함).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 게이트는 감사 보고서에 `error` 객체가 있으면 비0 으로 실패해야 한다.
- **FR-002**: 정상 보고서는 최소한 `auditReportVersion`, `metadata.vulnerabilities`, `vulnerabilities`(plain object) 를 포함해야 하며, 없으면 비0.
- **FR-003**: JSON 파싱 실패 시 비0 (기존 동작 유지).
- **FR-004**: `npm audit` 프로세스 기동 실패(`spawnSync.error`) 시 비0.
- **FR-005**: 스키마가 유효하면 `npm audit` 의 non-zero exit 만으로 실패하지 않는다(취약점 존재 시 npm 이 1을 주는 계약).
- **FR-006**: 유효 보고서에서 High/Moderate/Critical + `fixAvailable` truthy → 비0; 동일 severity + `fixAvailable` falsy → Accepted 로그 후 통과(#756).
- **FR-007**: 보고서 스키마 검증 로직은 단위 테스트 가능한 순수 함수로 분리되어야 한다.
- **FR-008**: `.github/workflows/security-check.yml` 의 Production npm audit 스텝은 계속 이 스크립트를 호출해야 한다.

### Key Entities

- **Audit report**: `npm audit --json` 산출물.
- **Audit error payload**: `error.code` / `error.summary` 등을 담은 실패 JSON.
- **Vulnerability entry**: `name`, `severity`, `fixAvailable`, `via`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: E503-style error JSON 픽스처로 게이트 실행 시 exit ≠ 0 (재현 시나리오 회귀 차단).
- **SC-002**: 스키마 불완전·파싱 실패·spawn 기동 실패 픽스처/모의 각각 exit ≠ 0.
- **SC-003**: 정상 accepted-only / fixable 픽스처에서 #756 분류·exit 계약 유지.
- **SC-004**: 관련 단위 테스트와 `security-check` 가 호출하는 스크립트 경로가 CI 에서 통과 가능.

## Assumptions

- npm audit JSON 의 “정상” 형태는 현재 npm 이 내는 `auditReportVersion` + `metadata.vulnerabilities` + `vulnerabilities` 맵을 기준으로 한다.
- #909 의 실제 High 4건(`fixAvailable:false`)은 Accepted 경로로 남으며 이 이슈에서 고치지 않는다.
- `tech-debt-pending` → PR 전 `tech-debt-approved` 라벨 교체는 운영 절차(구현과 별도).

## Brainstorm Log

### 2026-09-07 — coverage audit (issue text complete)

Issue acceptance + 재현이 충분해 억지 인터뷰 생략. Covered: error JSON, missing schema fields, parse fail, spawn start fail, valid report with npm exit 1, error+vulnerabilities coexistence, file-arg path. Out of Scope: dependency upgrades (#909), severity policy change.

## Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| 1 | non-zero exit alone fail? | Resolved | No — only with invalid/missing schema or spawn/parse failure (FR-005). |
| 2 | Touch workflow YAML beyond existing script call? | Resolved | Keep call; optional workflow unit assertion that step remains (FR-008). |
