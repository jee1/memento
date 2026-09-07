# Research: #925 npm audit error JSON

## Decision: Schema gate over exit-code-only

**Choice**: Validate `auditReportVersion` + `metadata.vulnerabilities` + `vulnerabilities` (object) and reject `report.error`.

**Why**: `npm audit --json` exits non-zero when vulnerabilities exist *and* when the audit service fails. Exit code alone cannot distinguish. The issue reproduction is specifically an error payload accepted as empty vulns.

**Alternatives rejected**:
- Fail on any non-zero exit → breaks accepted-upstream path when High vulns exist (current prod has High with fixAvailable:false; npm still exits 1).
- Only check `report.error` → misses truncated/partial JSON objects without `error` key.

## Decision: Pure module under scripts/lib

**Choice**: `scripts/lib/production-audit-report.js` + vitest, same pattern as #859 allowlist.

**Why**: Constitution I; CLI script hard to unit-test without spawn mocks for every case.

## npm audit status semantics

| Situation | Typical status | stdout |
|-----------|----------------|--------|
| Clean / only accepted policy | 0 or 1 | Valid report |
| Fixable or any advisories | 1 | Valid report |
| Audit service error | 1 | `{ error: {...} }` |
| npm missing | null + `error` | empty |

Gate fails on rows 3–4 and invalid schema; rows 1–2 use existing severity/`fixAvailable` logic.
