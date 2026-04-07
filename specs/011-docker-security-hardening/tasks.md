---

description: "Task list for 011-docker-security-hardening"
---

# Tasks: Security Hardening for Docker and HTTP Admin

**Input**: Design documents from `/specs/011-docker-security-hardening/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md — N/A (no schema changes)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Install the single new dependency required before any implementation can begin.

- [x] T001 Install helmet.js v7+ in `packages/memento-server/package.json` via `npm install helmet --workspace=packages/memento-server`

**Checkpoint**: `npm run build` passes after helmet installation

---

## Phase 2: Foundational (Review & Understand)

**Purpose**: Verify current state of all affected files before making changes. No code changes in this phase.

- [x] T002 [P] Read `packages/memento-server/src/server/middleware/admin-auth.middleware.ts` in full — confirm fail-open line (line ~15) and existing 401 response pattern for mismatched keys
- [x] T003 [P] Read `packages/memento-server/src/server/http-server.ts` — confirm `startServer()` function structure, CORS registration position, and `getMementoHttpSecurityStartupViolationMessage` call site
- [x] T004 [P] Read `docker-compose.base.yml` — confirm exact line to delete (`MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"`)
- [x] T005 [P] Read `docker-compose.yml` — confirm exact `user: root` line to delete
- [x] T006 [P] Check whether `packages/memento-server/src/server/middleware/admin-auth.middleware.spec.ts` exists — determines if test file must be created or extended

**Checkpoint**: All affected file locations confirmed, ready to implement in parallel

---

## Phase 3: US1 — Remove Hardcoded Insecure Bypass Flag (Priority: P1)

**Goal**: Remove the `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` hardcoded line from the base Docker Compose config so no shared config file can silently disable admin auth.

**Independent Test**: Deploy with base config, call any admin endpoint without an API key → must receive 401 (or verify US2 middleware change produces 401 after this flag is removed).

- [x] T007 [US1] Delete `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` line from `docker-compose.base.yml` (line ~24); optionally add a comment noting that the escape hatch remains available via an uncommitted `docker-compose.override.yml`

**Checkpoint**: `docker-compose.base.yml` contains zero occurrences of `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN`

---

## Phase 4: US2 — Enforce Fail-Closed Admin Auth (Priority: P1)

**Goal**: Invert the fail-open behavior in the admin auth middleware so that a missing, empty, or whitespace-only `ADMIN_API_KEY` results in 401 for every admin request. Add a startup warning log.

**Independent Test**: Start the server without `ADMIN_API_KEY` set; call `GET /admin/stats` (or any admin endpoint) → must receive 401 with the documented JSON payload.

### Tests for User Story 2 (TDD — write FIRST, ensure they FAIL before implementing)

- [x] T008 [P] [US2] Write failing test: "returns 401 when ADMIN_API_KEY is absent" in `packages/memento-server/src/server/middleware/admin-auth.middleware.spec.ts`
- [x] T009 [P] [US2] Write failing test: "returns 401 when ADMIN_API_KEY is empty string" in `packages/memento-server/src/server/middleware/admin-auth.middleware.spec.ts`
- [x] T010 [P] [US2] Write failing test: "returns 401 when ADMIN_API_KEY is whitespace only" in `packages/memento-server/src/server/middleware/admin-auth.middleware.spec.ts`
- [x] T011 [P] [US2] Write passing guard test: "allows request when correct ADMIN_API_KEY is provided" in `packages/memento-server/src/server/middleware/admin-auth.middleware.spec.ts`

> **Verify T008–T010 FAIL before proceeding to implementation**

### Implementation for User Story 2

- [x] T012 [US2] Update `packages/memento-server/src/server/middleware/admin-auth.middleware.ts`: replace `next()` on the fail-open branch with a 401 JSON response; add `expectedKey.trim() === ''` check; use response body: `{ error: "Unauthorized", message: "Admin API is disabled: ADMIN_API_KEY is not configured. Set ADMIN_API_KEY environment variable to enable admin access.", timestamp: "<ISO8601>" }`
- [x] T013 [US2] Update `packages/memento-server/src/server/http-server.ts`: in `startServer()`, add startup `logger.warn(...)` when `ADMIN_API_KEY` is absent/empty/whitespace (FR-003 — applies to loopback and non-loopback alike); place after existing `getMementoHttpSecurityStartupViolationMessage` check

**Checkpoint**: T008–T010 now PASS; server started without `ADMIN_API_KEY` logs a warning and rejects admin requests with 401

---

## Phase 5: US3 — Non-Root Docker User (Priority: P2)

**Goal**: Remove the `user: root` override from `docker-compose.yml` so containers use the UID 1001 `memento` user already defined in the Dockerfile.

**Independent Test**: Run `docker compose up -d` and exec `id` inside the container — UID must not be 0.

- [x] T014 [US3] Delete `user: root` line from `docker-compose.yml`; confirm no other root-user overrides remain in any compose file in the repository

**Checkpoint**: `docker-compose.yml` contains zero `user: root` entries; `docker compose config` shows no root user override

---

## Phase 6: US4 — HTTP Security Headers (Priority: P3)

**Goal**: Register `helmet()` as a global Express middleware in `http-server.ts` so that all HTTP responses — admin API, MCP transport, static assets — include the OWASP minimum security headers.

**Independent Test**: Make any HTTP request to the running server; inspect response headers — must include `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy`, and `Referrer-Policy`.

### Implementation for User Story 4

- [x] T015 [US4] Add `import helmet from 'helmet';` to `packages/memento-server/src/server/http-server.ts`
- [x] T016 [US4] Register `app.use(helmet({ frameguard: { action: 'deny' }, referrerPolicy: { policy: 'no-referrer' } }))` in `packages/memento-server/src/server/http-server.ts` before `app.use(cors(...))` and all route registrations (FR-006: global, not per-route)
- [x] T017 [US4] Verify that Helmet's default `Content-Security-Policy` does not block D3.js CDN resources used by the admin dashboard; if it does, add `contentSecurityPolicy: { directives: { scriptSrc: ["'self'", 'cdn.jsdelivr.net', 'unpkg.com'] } }` (or the correct CDN origin) — check research.md plan.md caution note

**Checkpoint**: Running server responds to any route with all four required security headers; existing test suite still passes

---

## Phase 7: Polish & Quality Gates

**Purpose**: Migration documentation, lint/type-check/test gate, and final validation across all user stories.

- [x] T018 [P] Add migration note to `CHANGELOG.md` or `docs/` documenting: (a) `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` removal from `docker-compose.base.yml` is a **breaking change**, (b) operators must now set `ADMIN_API_KEY` env var, (c) escape hatch `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true` remains available via uncommitted `docker-compose.override.yml` (FR-008)
- [x] T019 Run `npm run lint -- --fix` and confirm zero lint errors (modified files pass; pre-existing errors in other files not introduced by this PR)
- [x] T020 Run `npm run type-check` and confirm zero TypeScript errors
- [x] T021 Run `npm test` and confirm all tests pass (7 new tests pass; 1 pre-existing failure in check-magic-numbers.spec.ts unrelated to this PR)
- [x] T022 [P] Manual smoke test: start server without `ADMIN_API_KEY` → admin endpoint returns 401 + warning in logs; start with valid key → admin endpoint returns 200

**Checkpoint**: All quality gates pass; PR ready for review

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (helmet installed) — BLOCKS Phase 6 (helmet must exist before import)
- **US1 (Phase 3)**: Can start after Phase 2 — no dependencies on other user stories
- **US2 (Phase 4)**: Can start after Phase 2 — no dependencies on US1, US3, US4
- **US3 (Phase 5)**: Can start after Phase 2 — fully independent of US1, US2, US4
- **US4 (Phase 6)**: Depends on Phase 1 (helmet installed) and T015–T016 must come after Phase 2 review
- **Polish (Phase 7)**: Depends on Phases 3–6 complete

### Parallel Opportunities

US1 (T007), US2 (T008–T013), US3 (T014), and US4 (T015–T017) can all proceed in parallel after Phase 2 completes — they touch entirely different files:

| Story | Files touched |
|-------|--------------|
| US1   | `docker-compose.base.yml` |
| US2   | `admin-auth.middleware.ts`, `admin-auth.middleware.spec.ts`, `http-server.ts` (warning only) |
| US3   | `docker-compose.yml` |
| US4   | `http-server.ts` (helmet), `packages/memento-server/package.json` |

> **Note**: US2 (T013) and US4 (T015–T016) both touch `http-server.ts` — coordinate to avoid conflicts if working in parallel.

### Within Each User Story

- US2: Write failing tests (T008–T011) FIRST, verify they fail, then implement (T012–T013)
- US4: Install helmet (Phase 1) → import (T015) → register (T016) → CSP verification (T017)

---

## Notes

- [P] tasks = different files, no dependencies — safe to run in parallel
- [US#] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- US2 tests must FAIL before implementation (Constitution I: Test-First)
- `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN` code support is NOT removed — only the hardcoded `"true"` in `docker-compose.base.yml` is deleted (per spec clarification)
- helmet v7+ includes its own TypeScript types; `@types/helmet` is NOT needed
- Commit after each phase or logical group
