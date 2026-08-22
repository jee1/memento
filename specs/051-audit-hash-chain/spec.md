# Feature Specification: Hash-Chained Audit Log

**Feature Branch**: `062-memento-uri`
**Created**: 2026-07-12
**Status**: Implemented
**Parent**: #655, dependent issue #660

## Requirements

- SQLite audit rows are append-only and contain actor, transport, action, target URI, result, evidence state, coverage gap, previous hash, and current hash.
- SHA-256 links each row to its predecessor. Verification reports the first broken row.
- `MEMENTO_AUDIT_MODE=best-effort` records incomplete coverage when possible; `strict` rejects sensitive delete, admin, and denied-auth actions when required coverage is unavailable.
- Read-only admin access exposes filtered rows and a verification-aware export.
- Retention of audit evidence is independent from memory forget/delete retention.

## Success Criteria

- Migration, enum validation, chain verification, incomplete best-effort, and strict fail-closed tests pass.
- HTTP and MCP dispatch boundaries record transport-specific audit entries without storing raw secrets.
- Security and retention documentation define the evidence and coverage limits.
