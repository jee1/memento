# Data Model: Environment Config Cleanup

## Entity: EnvironmentVariableDefinition

- **Description**: 환경변수 한 항목의 명세.
- **Fields**:
  - `name` (string, unique): 변수명.
  - `scope` (enum): `global`, `agent`, `shared`.
  - `requiredInProduction` (boolean): 프로덕션 필수 여부.
  - `defaultPolicy` (enum): `explicit-default`, `empty-required`, `optional-empty`.
  - `description` (string): 변수 목적 설명.
  - `securityLevel` (enum): `normal`, `sensitive`.
  - `sourceOfTruth` (enum): `root-env-example`, `agent-env-example`.

## Entity: EnvironmentTemplateFile

- **Description**: 변수 목록을 제공하는 템플릿 파일.
- **Fields**:
  - `path` (string, unique): 파일 경로.
  - `role` (enum): `template`, `runtime`.
  - `ownerScope` (enum): `global`, `agent`.
  - `lastSyncedAt` (date): 마지막 동기화 일시.

## Entity: VariableAliasRule

- **Description**: 변수명 전환/호환 규칙.
- **Fields**:
  - `canonicalName` (string): 표준 변수명.
  - `legacyNames` (string[]): 과거 변수명 목록.
  - `deprecationNotice` (string): 전환 안내 문구.
  - `priorityOrder` (string[]): 충돌 시 우선순위.

## Relationships

- `EnvironmentTemplateFile` 1:N `EnvironmentVariableDefinition`
- `EnvironmentVariableDefinition` 0..1 : 1 `VariableAliasRule`

## State Rules

- 템플릿 항목은 `sourceOfTruth`가 반드시 지정되어야 한다.
- `requiredInProduction=true`인 항목은 `securityLevel=sensitive` 또는 명시적 사유가 필요하다.
- `legacyNames`가 존재하면 `deprecationNotice`도 필수다.
