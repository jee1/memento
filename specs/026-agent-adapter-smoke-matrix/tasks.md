# Tasks: Agent Adapter Smoke Matrix

## Specification

- [x] T001 Issue #484, Epic #452 요구를 spec에 정리한다.

## Implementation

- [x] T002 `scripts/agent-smoke-matrix.ts` runner 구현
- [x] T003 `scripts/agent-smoke-matrix.spec.ts` Vitest 추가
- [x] T004 `docs/operations/ko/agent-smoke-matrix.md` 작성
- [x] T005 package scripts `quality:agent-smoke*` 추가

## Verification

- [x] T006 `npm run quality:agent-smoke:test` 통과
- [x] T007 `npm run quality:agent-smoke` report `ok: true`
- [x] T008 lint, type-check 통과
- [x] T009 PR 생성
