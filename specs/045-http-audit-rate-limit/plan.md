# Implementation Plan: HTTP Audit & Rate Limit

**Branch**: `issue-663-http-audit-rate-limit` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

## Summary

`memento-server` HTTP 표면에 programmatic audit JSONL 미들웨어와 `/tools`·`/admin` bucket rate limit을 추가한다.

## #660 integration note

Issue **#660** (hash-chained tamper-evident audit)와의 관계:

| #663 (this PR) | #660 (follow-up) |
|----------------|------------------|
| Flat JSONL append via `http-audit.middleware.ts` | Hash chain (`previous_hash`, `current_hash`) |
| Fields: `ts, key_id, route, tool, owner_id, agent_id, latency_ms, status` | Adds `transport`, `action`, target URI, MCP stdio hook |
| `MEMENTO_HTTP_AUDIT_MODE=best-effort` (default) | `strict` — audit failure rejects request |
| File: `{dataDir}/http-audit.jsonl` | Same file or DB-backed chain + admin export API |

**Merge strategy**: Keep #663 field names unchanged. #660 replaces the append function with a chained writer that accepts the same entry shape as input, then persists extended record. Do not duplicate parallel audit pipelines.

## Technical approach

1. `express-rate-limit` dependency on `memento-server`.
2. `http-audit.middleware.ts` — `res.on('finish')`, append JSONL, stderr on failure.
3. `http-rate-limit.middleware.ts` — factory per bucket; skip in test/disabled env.
4. Wire in `http-server.ts` after auth / tool-context where needed.
5. Unit tests for JSONL shape and 429 behavior.

## Verification

```bash
cd /path/to/worktree
npm install
npm run build
npm test -- packages/memento-server/src/server/middleware/http-audit.middleware.spec.ts
npm test -- packages/memento-server/src/server/middleware/http-rate-limit.middleware.spec.ts
npm test -- packages/memento-server
```
