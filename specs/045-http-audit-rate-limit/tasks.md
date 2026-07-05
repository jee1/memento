# Tasks: HTTP Audit & Rate Limit (#663)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1 — Middleware

- [x] T001 Add `express-rate-limit` to `packages/memento-server/package.json`
- [x] T002 Implement `http-audit.middleware.ts` (JSONL, finish hook, key_id fallback)
- [x] T003 Implement `http-rate-limit.middleware.ts` (tools/admin buckets, 429 + Retry-After)
- [x] T004 Export from `middleware/index.ts`
- [x] T005 Wire `http-server.ts` (audit on programmatic routes, rate limit on /tools, /admin)

## Phase 2 — Tests & docs

- [x] T006 `http-audit.middleware.spec.ts`
- [x] T007 `http-rate-limit.middleware.spec.ts`
- [x] T008 `docs/reference/ko/security.md` audit + rate limit section
- [x] T009 `env.example` + `CHANGELOG.md`
- [x] T010 Spec Kit `specs/045-http-audit-rate-limit/` with #660 integration note in plan.md

## Phase 3 — Verification

- [x] T011 `npm run build` + memento-server tests green in worktree
- [x] T012 Commit on `issue-663-http-audit-rate-limit` (no push)
