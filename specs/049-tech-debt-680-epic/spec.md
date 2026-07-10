# Feature Specification: Epic #680 Tech-Debt (Issues #681–#692)

**Feature Branch**: `049-tech-debt-680-epic`
**Created**: 2026-07-10
**Status**: In Progress
**Parent Epic**: #680

---

## Scope

| Issue | TD | Title | Phase |
|-------|-----|-------|-------|
| #681 | TD-011 | MCP transport parity (stdio vs HTTP/WS) | P0 |
| #682 | TD-002 | llm-client-initializer.ts 분해 | P1 |
| #683 | TD-003 | search-ranking.ts 분해 | P1 |
| #684 | TD-006 | batch-scheduler.ts 잔여 분해 | P1 |
| #685 | TD-001 | reflexion-worker.ts 잔여 분해 | P2 |
| #686 | TD-005 | memento-client.ts 분해 | P2 |
| #687 | TD-012 | embedding-migration-service.ts 분해 | P2 |
| #688 | TD-007 | database.ts 분해 | P2 |
| #689 | TD-004 | relation-quality-validator.ts 분해 | P2 |
| #690 | TD-009 | 패치·마이너 deps | P3 |
| #691 | TD-010 | 메이저 deps 스파이크 (문서만) | P3 |
| #692 | TD-008 | vector-search-quality-metrics 분해 | P3 |

## Non-Goals

- 알고리즘·랭킹 공식 변경
- 메이저 deps 실제 업그레이드 (vitest 4, eslint 10) — 스파이크 노트만
- Public API breaking change

## Acceptance Criteria (Summary)

### #681
- [ ] `runtime-transport-parity.spec.ts` green
- [ ] HTTP/WS `tools/call` returns raw `ToolResult` (stdio parity)

### #682–#689
- [ ] Orchestrator ≤500줄, sub-modules mechanical extraction
- [ ] 기존 spec green, `npm run lint && npm run type-check`

### #690
- [ ] `npm outdated` wanted 범위 업데이트, `npm test` green

### #691
- [ ] `specs/049-tech-debt-680-epic/major-deps-spike.md` 마이그레이션 노트

### #692
- [ ] 통계·리포트 헬퍼 분리, 기존 quality spec green
