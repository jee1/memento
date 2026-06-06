# Tasks: Agent Integration Contracts

## Specification

- [x] T001 #453와 parent PRD 범위를 추출한다.
- [x] T002 scenarios, acceptance, edge cases, outcomes를 작성한다.
- [x] T003 package placement와 retention을 결정한다.

## Research and Boundaries

- [x] T004 assistant/client/core/server 책임을 조사한다.
- [x] T005 신규 workspace 결정을 기록한다.
- [x] T006 기존 PIIMasker 한계와 fail-closed 정책을 결정한다.
- [x] T007 API auth와 migration 전략을 결정한다.

## Contracts

- [x] T008 lifecycle 5종 envelope와 example을 작성한다.
- [x] T009 idempotency, hash, sequence, late/grace 규칙을 확정한다.
- [x] T010 Start/Ingest/PreCompact/Stop/Get/List/Trace API를 작성한다.
- [x] T011 capture status/reason과 HTTP/SDK mapping을 확정한다.
- [x] T012 redaction, path, binary, 32KiB, batch, queue를 작성한다.
- [x] T013 정상·보안·장애 fixture 22종과 leak surface를 작성한다.

## Data and Migration

- [x] T014 Session state machine을 작성한다.
- [x] T015 Observation constraints/index/retention을 작성한다.
- [x] T016 Provenance와 legacy attribution 차이를 작성한다.
- [x] T017 additive migration과 rollback을 작성한다.

## Handoff and Verification

- [x] T018 #454/#461 ownership을 plan에 매핑한다.
- [x] T019 quickstart를 작성한다.
- [x] T020 checklist에서 unresolved clarification이 없음을 확인한다.
- [x] T021 `npm run docs:audit-links` 실행
- [x] T022 `npm run lint`, `npm run type-check`, `npm test` 실행
- [x] T023 graphify rebuild
- [ ] T024 GitHub #453에 산출물과 검증 결과 반영

### Validation Notes

- `npm run docs:audit-links`: 이번 spec 경로 오류는 없었으나, `.omx/state/sessions/omx-1779702102519-huowdk/AGENTS.md`의 기존 상대 링크 6건으로 실패했다.
- `npm run lint`: 오류 없이 통과했다. 기존 security warning 245건은 유지된다.
- `npm run type-check`: 모든 workspace에서 통과했다.
- `npm test`: 변경되지 않은 HTTP 통합 테스트가 30초 타임아웃에 걸려 전체 게이트는 실패했다. 이 작업은 문서와 graphify 산출물만 변경한다.
- graphify rebuild: 5,088 nodes, 6,216 edges, 1,025 communities로 완료했다.

## #454 Test-First Handoff

- [ ] H001 migration table/index/schema sync failing tests
- [ ] H002 repository duplicate/conflict/late/state tests
- [ ] H003 route capability/lifecycle tests
- [ ] H004 MCP/assistant compatibility tests

## #461 Test-First Handoff

- [ ] H005 TypeScript/JSON Schema fixture tests
- [ ] H006 secret leak scan tests
- [ ] H007 32KiB/batch/reduction boundary tests
- [ ] H008 queue/timeout/retry/non-throwing tests
