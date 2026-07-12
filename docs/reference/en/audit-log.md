# Hash-Chained Audit Log

`audit_log` is an append-only SQLite table used for MCP stdio, MCP HTTP, and HTTP administration boundaries. Each record includes the prior SHA-256 hash and a hash of its own canonical metadata. Updates and deletes are rejected by SQLite triggers; `AuditHashChainService.verify()` and `GET /api/v1/audit/export` identify the first broken link.

## Evidence Boundary

The table stores metadata only: actor/owner/agent identifiers, transport, tool or endpoint, action, target URI, result status, evidence state, and coverage verdict. It does not store raw tool arguments, tool output, credentials, or memory content.

`evidence_mode` is `full`, `redacted`, `metadata_only`, or `unavailable`. Dispatch integrations use `metadata_only` with `tool_args_state=omitted` and `output_state=omitted`. A missing authenticated actor, redacted payload, truncated output, audit write failure, or retention conflict is represented by `coverage_gap` and normally produces `audit_verdict=incomplete`.

## Modes

- `MEMENTO_AUDIT_MODE=best-effort` is the default. Memento records incomplete coverage when possible and continues a request if the audit write cannot complete.
- `MEMENTO_AUDIT_MODE=strict` checks audit-table availability and a verified actor before sensitive `delete` and `admin` actions run. An unacceptable coverage gap returns a failure before the operation. An `auth_denied` request is already rejected with 401/403, and is retained as an incomplete denied record when possible.

MCP stdio has no built-in authenticated actor. Its entries therefore use `actor_unverified`; strict deletion through stdio is rejected unless an authenticated dispatch layer supplies an actor.

## Query and Export

`GET /api/v1/audit/entries` and `GET /api/v1/audit/export` require the `admin:destructive` programmatic scope. Both accept optional `action`, `transport`, `actorId`, and `limit` (1-1000). Export adds whole-chain verification to the returned records.

## Retention and Archival

Audit retention is independent of memory deletion and forgetting. The append-only table has no automatic purge because deleting rows invalidates later links. Include the SQLite database in ordinary backups and archive verified exports before any operator-controlled database rotation. If a retention policy conflicts with the append-only constraint, record `retention_conflict` rather than silently purging chain rows.
