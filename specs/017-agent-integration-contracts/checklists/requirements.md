# Requirements Quality Checklist: Agent Integration Contracts

**Created**: 2026-06-06
**Feature**: [spec.md](../spec.md)

## Completeness

- [x] lifecycle 5종과 필수 field
- [x] identifier, sequence, late, idempotency
- [x] redaction, sensitive path, binary, limits
- [x] queue priority, timeout, retry, reason
- [x] package ownership/dependency
- [x] schema/migration/rollback
- [x] Start/Ingest/PreCompact/Stop/Get/List/Trace
- [x] threat/failure fixtures and leak surfaces

## Clarity

- [x] 모든 MUST는 검증 가능하다.
- [x] status와 reason code가 분리되었다.
- [x] retention은 30일로 결정되었다.
- [x] 신규 workspace가 결정되었다.
- [x] legacy attribution과 provenance가 구분되었다.
- [x] `[NEEDS CLARIFICATION]`이 없다.

## Compatibility and Security

- [x] MCP/assistant 공개 API 변화 없음
- [x] additive schema와 old-server rollback
- [x] version mismatch 결과 정의
- [x] redaction이 hash/storage/log/telemetry보다 선행
- [x] capture redaction 비활성화 불가
- [x] matched secret fragment 저장 금지
