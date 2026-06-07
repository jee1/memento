# Tasks: Claude Code Adapter

- [x] T001 Issue, PRD, contract, local version/config 조사
- [x] T002 spec/research/plan/quickstart/tasks 정합성 확정
- [x] T003 lifecycle fixture test RED 확인
- [x] T004 adapter와 scope 구현
- [x] T005 settings plan/apply와 diagnostics 구현
- [x] T006 non-throwing runner 구현
- [x] T007 `memento connect/hook claude-code` CLI 연결
- [x] T008 package tests GREEN
- [x] T009 lint/type-check/targeted tests/security gate
- [x] T010 graphify rebuild 및 최종 검토

## Verification Note

- 어댑터 52개 및 CLI 8개 테스트가 통과했다.
- lint는 오류 0개이며 저장소 기존 security warning 245개를 보고했다.
- type-check와 정적 SQL/PII/path 검사는 통과했다.
- 전체 테스트는 현재 샌드박스에서 기존 migration backup의
  `~/.memento` 쓰기 제한과 programmatic auth loopback timeout이 발생했고,
  결과 출력 뒤 열린 핸들로 종료되지 않아 중단했다. Claude Code adapter/CLI
  변경 범위 60개 테스트에는 실패가 없다.
