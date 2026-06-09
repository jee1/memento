# Tasks: Agent Operations CLI

## Phase 1 - Specification

- [x] T001 issue #458, PRD FR-024~026, constitution과 017~019 패턴 정리
- [x] T002 doctor/status/demo scenarios, edge cases, measurable outcomes 작성
- [x] T003 endpoint/auth/redaction/demo cleanup과 payload-free 경계 결정
- [x] T004 spec/research/data-model/plan/quickstart/tasks 상호 일치

## Phase 2 - RED Tests

- [x] T005 [FR-007,FR-008,FR-014] operations status aggregate/leak route test
- [x] T006 [FR-007] client status transport test
- [x] T007 [FR-005,FR-006] doctor success/redaction/cleanup test
- [x] T008 [FR-005,FR-012] doctor failure classification/guidance test
- [x] T009 [FR-009,FR-010] demo summary reuse/failure cleanup test
- [x] T010 [FR-011,FR-013] compatibility와 human/JSON renderer parity test
- [x] T011 targeted tests RED 원인 기록

## Phase 3 - Implementation

- [x] T012 payload-free `/operations/status` route 구현
- [x] T013 client query type와 `getAgentOperationsStatus` 구현
- [x] T014 agent ops option/endpoint/auth/safe HTTP shell 구현
- [x] T015 reason guide와 compatibility matrix 구현
- [x] T016 doctor workflow와 synthetic redaction probe 구현
- [x] T017 status workflow와 rendering 구현
- [x] T018 two-session demo와 finally cleanup 구현
- [x] T019 `cli.ts` routing/help와 운영 문서 갱신

## Phase 4 - GREEN & Review

- [x] T020 targeted tests GREEN
- [x] T021 raw payload/secret marker/API key leak grep 및 review
- [x] T022 public API/backward compatibility review

## Phase 5 - Verification

- [x] T023 graphify rebuild
- [x] T024 targeted tests
- [x] T025 `npm run lint`
- [x] T026 `npm run type-check`
- [x] T027 SQL injection/PII/path traversal static checks
- [x] T028 security unit/E2E tests
- [x] T029 `npm test`
- [x] T030 Spec Kit tasks와 verification note 갱신

## Verification Notes

- Targeted: 3 files, 27 tests passed.
- Full suite: 370 files passed, 2 skipped; 4,491 tests passed, 10 skipped.
- Lint: 0 errors; existing security warnings only.
- Type-check: all workspaces passed.
- Security: SQL injection, PII masking, path traversal static checks passed.
- Security tests: unit suites plus SQL injection/path traversal E2E passed.

## Phase 6 - Delivery

- [ ] T031 Lore protocol commit
- [ ] T032 branch push
- [ ] T033 Draft PR 생성: `Closes #458`, Spec Kit, tests, 지식 복리
