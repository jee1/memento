# Implementation Plan: Codex Lifecycle Adapter

**Branch**: `feature/issue-459-codex-adapter` | **Date**: 2026-06-07  
**Spec**: `/specs/019-codex-adapter/spec.md`

## Summary

Codex 0.137.0 hook payload 5종을 공통 event contract로 변환하고, 기존
`hooks.json`을 보존하는 연결 planner/applier와 non-throwing CLI runner를 추가한다.
실제 사용자 홈 대신 injectable/temp paths로 모든 부작용을 검증한다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 24+ ESM  
**Dependencies**: Node built-ins, existing workspaces only  
**Packages**: `@memento/agent-integration`, `memento-server`  
**Testing**: Vitest, fixture replay, spawned CLI smoke  
**Constraints**: TDD, no dependency, no schema change, no home mutation in tests

## Constitution Check

- **Test-First**: RED fixture/config/runner tests before implementation.
- **Backward Compatibility**: additive exports and CLI commands only.
- **Schema Discipline**: no DB change.
- **Quality Gates**: lint, type-check, full tests, static security checks.
- **Failure Isolation**: hook-facing command always returns 0 and emits no control output.

설계 전 게이트: **PASS**

## Architecture

```text
Codex stdin JSON
  -> memento hook codex
  -> normalizeCodexHookPayload()
  -> existing CaptureRuntime policy
  -> agent API endpoint transport

memento connect codex
  -> inspectCodexCapability()
  -> planCodexHooksMerge()
  -> render diff/backup path
  -> applyCodexHooksPlan() unless --dry-run
```

### `@memento/agent-integration`

- `src/adapters/codex/types.ts`: source payload and diagnostics.
- `src/adapters/codex/normalize.ts`: validation, scope, deterministic IDs, mapping.
- `src/adapters/codex/config.ts`: pure merge plan and filesystem apply.
- `src/adapters/codex/runner.ts`: non-throwing orchestration over injected capture/dispatch.
- `src/adapters/codex/fixtures/*.json`: lifecycle replay corpus.

### `memento-server`

- `src/cli/codex.ts`: argv parsing, capability command execution, server transport.
- `src/cli.ts`: `connect codex` and internal `hook codex` dispatch/help.
- CLI tests spawn built entry or invoke exported runner with temp config.

## Data Flow

1. Hook command reads bounded stdin JSON.
2. Adapter validates discriminant and required source fields.
3. Scope and deterministic identity are derived.
4. Existing runtime applies normalization, redaction, size, queue rules.
5. Runner dispatches to start/ingest/pre-compact/stop endpoint.
6. Any failure is recorded on stderr only when invoked interactively; hook mode exits 0 quietly.

## Capability Diagnostics

- Parse semver from `codex --version`.
- Parse `hooks <stage> <enabled>` from `codex features list`.
- `0.137.0 + stable + enabled` is verified baseline.
- missing binary, unparseable version, disabled/missing hooks are explicit degraded diagnoses.
- config event presence is installation state, not runtime support proof.

## Test Strategy

### RED

1. fixture replay expects 5 valid envelopes.
2. invalid/unknown payload expects non-throwing diagnostic.
3. config merge expects preservation, backup plan, idempotency.
4. runner capture/dispatch rejection expects resolved degraded result.
5. CLI connect temp-home smoke expects file, backup, no duplicate.

### GREEN

Implement the minimum functions and CLI routing needed to satisfy each test.

### Verification

- targeted package/server tests
- `npm run lint`
- `npm run type-check`
- `npm test`
- existing path traversal, SQL injection, PII/security scripts applicable to changed surface
- graphify rebuild after code changes

## Risks

- Codex hook delivery differs by interactive/exec/tool implementation: document and diagnose, do not claim full upstream coverage.
- user hook trust is Codex-owned: preserve state and report that new handlers may require approval.
- process-per-hook sequence cannot maintain a shared monotonic counter: use clock sequence and deterministic event IDs.

