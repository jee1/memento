# Implementation Plan: Agent Integration Contracts

**Branch**: `017-agent-integration-contracts` | **Date**: 2026-06-06 | **Spec**: `/specs/017-agent-integration-contracts/spec.md`
**Input**: Issue #453, `tasks/0452-prd-agent-integration.md`

## Summary

구현 전에 lifecycle envelope, 보안·크기·queue 정책, package ownership, data model, API capability, migration/rollback을 고정한다. production runtime과 schema 변경은 #454/#461에서 수행한다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 24+, JSON Schema draft 2020-12 예정
**Dependencies**: npm workspaces, Express 5, Zod 3, SQLite, programmatic auth
**Storage**: additive SQLite table 설계; 실제 migration은 #454
**Testing**: contract fixtures와 leak verification 계획; runtime tests는 후속 이슈
**Performance**: hook 50ms, event 32KiB, batch 50/512KiB
**Constraints**: non-throwing, redaction-before-storage, backward compatibility, 신규 dependency 없음

## Constitution Check

- **Test-First**: PASS. 현재는 documentation/type-contract design only다. 후속 behavior 구현은 fixture test-first다.
- **Backward Compatibility**: PASS. 기존 MCP, `/tools`, assistant 변화 없음.
- **Schema Discipline**: PASS. additive schema, `schema.sql` sync, expand/contract, rollback을 명시했다.
- **Quality Gates**: 완료 전 docs audit, lint, type-check, test를 실행한다.
- **Failure Isolation**: PASS. stable reason code와 non-throwing degraded 계약을 정의했다.

초기/설계 후 게이트: **PASS**

## Structure

```text
specs/017-agent-integration-contracts/
├── spec.md
├── research.md
├── data-model.md
├── plan.md
├── tasks.md
├── quickstart.md
├── checklists/requirements.md
└── contracts/
    ├── event-envelope.md
    ├── api-capabilities.md
    └── security-failure-matrix.md
```

Future source ownership:

```text
packages/memento-agent-integration  # wire, normalization, policy, queue, adapters
packages/memento-client             # agent API transport
packages/memento-assistant          # existing turn lifecycle
packages/memento-core               # provenance domain/persistence
packages/memento-server             # authenticated API/telemetry
```

## Research Decisions

1. 신규 workspace와 assistant 분리.
2. TypeScript union + generated JSON Schema.
3. redaction 후 canonical hash.
4. late arrival 허용, terminal grace 5분.
5. 비활성화 불가 fail-closed redaction.
6. redacted payload retention 30일.
7. programmatic auth와 `/api/v1/agent`.
8. additive expand/contract migration.

## Design Outputs

1. `data-model.md`: ownership, state, entity/index/retention, migration.
2. `event-envelope.md`: lifecycle union, examples, canonicalization.
3. `api-capabilities.md`: Start/Ingest/PreCompact/Stop/Get/List/Trace.
4. `security-failure-matrix.md`: redaction, size, queue, fixture.
5. `quickstart.md`: 후속 구현 검증 순서.

## Follow-up Mapping

### #454

- core entities/repositories/migration
- server lifecycle/read/trace API
- client transport/capability
- idempotency, state, retention

### #461

- `@memento/agent-integration`
- generated schema/normalizer
- redaction/size pipeline
- priority queue/timeout/retry/degraded
- leak scan/telemetry

## Verification

- requirements ID와 contract mapping 검색.
- Markdown link audit.
- lint, type-check, full test.
- graphify rebuild.

## Complexity

| Decision | Reason | Simpler alternative rejected |
| --- | --- | --- |
| 신규 workspace | 책임·배포 분리 | assistant 결합은 turn/coding 계약을 혼합 |
| TS + JSON Schema | typed/custom adapters | TS only는 wire validation 부족 |
| 3 tables | lifecycle와 provenance 분리 | memory_item 확장은 cardinality 부적합 |
