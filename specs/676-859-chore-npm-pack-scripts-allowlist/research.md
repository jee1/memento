# Research: #859 scripts tarball allowlist

## Decision 1 — Explicit `files` paths vs negation globs

**Choice**: Explicit file paths under `scripts/`.

**Rationale**: `scripts` + `!**/*.ts` still ships pack tooling `.js`, fixtures, and non-runtime helpers — the surface that caused #857-class accidents.

**Alternatives rejected**: Negation globs; keep `scripts` and rely only on CI grep for `.ts`.

## Decision 2 — Allowlist must include #860 helper

**Choice**: `scripts/lib/postinstall-db-init.js` is mandatory.

**Rationale**: Issue #859 draft listed only `auto-setup.js` + `cli-runtime.js`. After #860/#864, `auto-setup.js` imports `postinstall-db-init.js`. Omitting it breaks postinstall.

**Alternatives rejected**: Issue draft as-is; inlining db-init back into auto-setup just to shrink list (out of scope / churn).

## Decision 3 — Gate location

**Choice**: Extend `verify-npm-pack-bundle.js`; extract pure checker to `scripts/lib/npm-pack-scripts-allowlist.js`.

**Rationale**: Issue recommendation; existing tar parse already in verify; unit tests without full pack.

**Alternatives rejected**: New standalone CI script; assert only via `npm pack --dry-run` JSON in vitest (flaky / heavy; dry-run can misreport bundled files).

## Decision 4 — Smoke env interaction

**Choice**: Allowlist runs whenever tarball is parsed; `MEMENTO_PACK_SMOKE=0` skips empty-temp only.

**Rationale**: Packaging hygiene must fail closed even when smoke is disabled for native/CI cost.
