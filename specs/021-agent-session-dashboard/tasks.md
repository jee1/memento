# Tasks: Agent Session Dashboard

## Specification

- [x] T001 Constitution과 specs/014, specs/017을 검토한다.
- [x] T002 issue #460 scenarios, requirements, outcomes를 고정한다.
- [x] T003 programmatic auth, no raw redacted payload, no dependency 경계를 확정한다.

## Core Read Models

- [x] T004 session cursor/page/aggregate failing tests를 추가한다.
- [x] T005 repository types와 SQLite query를 구현한다.
- [x] T006 observation safe timeline metadata를 구현한다.

## Server API

- [x] T007 session list/aggregate route tests와 구현.
- [x] T008 provenance detail route tests와 구현.
- [x] T009 injection detail route tests와 구현.
- [x] T010 existing session detail/timeline additive DTO tests와 구현.

## Transcript Import

- [x] T011 dry-run/parse/validation failing tests.
- [x] T012 duplicate/conflict/session-order validation 구현.
- [x] T013 invalid-before-write와 transaction rollback tests.
- [x] T014 explicit commit import와 sensitive/drop 결과 구현.

## Dashboard

- [x] T015 tab/static contract failing tests.
- [x] T016 session list/aggregate/timeline UI 구현.
- [x] T017 provenance/injection detail UI 구현.
- [x] T018 loading/empty/error/degraded/redacted/dropped UX 구현.
- [x] T019 transcript file dry-run/import UI 구현.
- [x] T020 token-only CSS와 accessibility contract 검증.

## Verification and Delivery

- [x] T021 targeted tests.
- [x] T022 lint and type-check.
- [x] T023 SQL injection, PII masking, path traversal scripts and security tests.
- [x] T024 graphify rebuild.
- [x] T025 Lore commit, push, Draft PR with `Closes #460`.

## Verification Record

- Targeted feature tests: 58 passed.
- Security unit tests: 68 passed.
- `npm run type-check`: passed.
- `npm run lint`: 0 errors, repository baseline 245 security warnings.
- SQL injection, PII masking, path traversal checks: passed.
- Graphify: 5,455 nodes, 6,684 edges, 1,094 communities.
