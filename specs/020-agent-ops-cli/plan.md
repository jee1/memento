# Implementation Plan: Agent Operations CLI

**Branch**: `feature/issue-458-agent-ops-cli` | **Date**: 2026-06-07
**Spec**: `/specs/020-agent-ops-cli/spec.md`

## Summary

기존 health/capability/lifecycle API를 조합하는 `doctor`, `status`, `demo` CLI를 추가한다.
server에는 payload-free 운영 요약 endpoint만 추가하고 client transport를 additive하게
확장한다. 모든 출력은 stable reason code와 compatibility/guidance를 제공한다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 24+ ESM
**Dependencies**: Node built-ins, existing npm workspaces only
**Packages**: `memento-server`, `@memento/client`
**Storage**: 기존 agent/session/observation/telemetry table read-only 집계
**Testing**: Vitest route, client transport, CLI orchestration/renderer tests
**Constraints**: TDD, payload-free diagnostics, no schema/dependency/dashboard/benchmark change

## Constitution Check

- **Test-First**: CLI/route/client RED tests를 구현 전에 작성한다.
- **Backward Compatibility**: additive command, endpoint, client method만 추가한다.
- **Schema Discipline**: migration 없음.
- **Quality Gates**: lint, type-check, full test와 security workflow 동등 검증.
- **Failure Isolation**: 각 check/step 실패를 결과로 보존하고 secret을 error에 포함하지 않는다.

설계 전 게이트: **PASS**

## Architecture

```text
memento doctor/status/demo
  -> agent-ops option parser
  -> endpoint/server-info + API key resolution
  -> safe HTTP client
  -> health/capabilities/operations status/lifecycle APIs
  -> reason classifier + compatibility matrix
  -> human or JSON renderer

/api/v1/agent/operations/status
  -> allowlisted SQL aggregates
  -> payload-free status DTO
```

## File Plan

- `packages/memento-server/src/cli/agent-ops.ts`: shared options, transport, workflows,
  reason guidance, compatibility, rendering.
- `packages/memento-server/src/cli/agent-ops.spec.ts`: RED/GREEN orchestration and leak tests.
- `packages/memento-server/src/cli.ts`: routing/help only.
- `packages/memento-server/src/server/routes/agent.routes.ts`: status endpoint.
- `packages/memento-server/src/server/routes/agent.routes.spec.ts`: aggregate/leak tests.
- `packages/memento-client/src/memento-client.ts`: `getAgentOperationsStatus`.
- `packages/memento-client/src/types.ts`, `index.ts`, `agent-api.spec.ts`: query type/export/test.
- `specs/020-agent-ops-cli/*`: source-of-truth artifacts.

## Status Query

Observation과 telemetry를 UTC cutoff로 조회한다. recent events는 unified array로
시각 역순 정렬하고 limit을 적용한다. telemetry는 `agent.injection.completed`만 읽으며
extra_data에서 `session_id`, `failure_reason` 등 allowlisted scalar만 추출한다.

## Doctor Flow

1. endpoint resolve와 `/health`.
2. authenticated `/capabilities`.
3. schema/contract/event/version compatibility.
4. synthetic session start with fake password marker.
5. export에서 marker 부재와 redaction 상태 확인.
6. session cleanup.
7. reason guidance와 compatibility matrix render.

## Demo Flow

1. unique scope/session 생성.
2. first SESSION_START.
3. USER_PROMPT와 TOOL_RESULT batch ingest.
4. STOP으로 summary 생성.
5. second SESSION_START와 initial injection 확인.
6. summary memory ID가 injection item에 포함되는지 검증.
7. 두 session cleanup.

## Test Strategy

### RED

1. route status aggregate와 raw payload 부재.
2. client status transport.
3. doctor 정상/auth/schema/contract/server-down 분류.
4. redaction marker leak 0과 cleanup.
5. demo summary reuse와 failure cleanup.
6. human/JSON compatibility/guidance parity.

### Verification

- targeted Vitest: CLI, route, client
- server/client build or type-check
- `npm run lint`
- `npm run type-check`
- `npm test`
- security workflow: SQL injection, PII masking, path traversal static checks와 unit/E2E
- graphify rebuild

## Risks

- full demo retrieval ranking이 기존 unrelated memory에 영향받을 수 있다: unique owner/project/process
  scope와 summary ID 직접 비교로 완화한다.
- telemetry extra_data는 historical shape가 다를 수 있다: parse 실패는 safe degraded event로 처리한다.
- server version은 배포 패키지 버전을 따르므로 strict equality 대신 contract compatibility를 gate로 사용한다.
