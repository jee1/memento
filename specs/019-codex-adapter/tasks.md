# Tasks: Codex Lifecycle Adapter

## Phase 1 - Specification

- [x] T001 issue/PRD/contract/constitution 요구사항 정리
- [x] T002 Codex 0.137.0 local feature/config/binary evidence 수집
- [x] T003 official source input schema와 config 구조 검증
- [x] T004 spec/research/plan/quickstart/tasks 상호 일치

## Phase 2 - RED Tests

- [x] T005 [FR-001,FR-002,FR-003] lifecycle 5종 fixture와 replay test 작성
- [x] T006 [FR-004,FR-005] scope/invalid payload test 작성
- [x] T007 [FR-006,FR-007,FR-012] config preservation/idempotency/backup test 작성
- [x] T008 [FR-008,FR-009] non-throwing runner failure test 작성
- [x] T009 [FR-010] version/feature capability parser test 작성
- [x] T010 [FR-011] CLI temp config smoke test 작성
- [x] T011 targeted tests를 실행해 RED 원인 기록

## Phase 3 - Implementation

- [x] T012 Codex source payload types와 fixture loader 구현
- [x] T013 lifecycle normalizer, deterministic ID, scope detection 구현
- [x] T014 pure hooks merge/diff plan과 atomic backup/apply 구현
- [x] T015 non-throwing adapter runner 구현
- [x] T016 capability inspector와 agent API transport 구현
- [x] T017 `memento connect codex`, `memento hook codex` CLI routing 구현
- [x] T018 package exports와 README/help 갱신

## Phase 4 - GREEN & Refactor

- [x] T019 targeted adapter tests GREEN
- [x] T020 CLI smoke GREEN
- [x] T021 중복 제거와 public contract review

## Phase 5 - Verification

- [x] T022 graphify rebuild
- [x] T023 `npm run lint`
- [x] T024 `npm run type-check`
- [x] T025 targeted tests 및 전체 suite 시도
- [x] T026 기존 static security checks
- [x] T027 변경 파일, RED/GREEN, 검증, 위험 보고

## Verification Note

- 어댑터 50개 및 CLI 7개 테스트가 통과했다.
- lint는 오류 0개이며 저장소 기존 security warning 245개를 보고했다.
- type-check와 정적 SQL/PII/path 검사는 통과했다.
- 전체 테스트는 현재 샌드박스에서 기존 migration backup의
  `~/.memento` 쓰기 제한과 programmatic auth loopback timeout이 발생했고,
  결과 출력 뒤 열린 핸들로 종료되지 않아 중단했다. Codex adapter/CLI 변경 범위
  57개 테스트에는 실패가 없다.
