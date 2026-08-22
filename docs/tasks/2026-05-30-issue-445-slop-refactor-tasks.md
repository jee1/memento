---
title: "Tasks: Issue #445 slop 후속 리팩터"
feature: issue-445-slop-refactor
mode: brownfield
tdd_source: "docs/design/2026-05-30-issue-445-slop-refactor-tdd.md"
prd_source: "https://github.com/jee1/memento/issues/445"
generated_at: 2026-05-30
validation_passed: true
---

# Tasks: Issue #445 slop 후속 리팩터

> **출처 TDD:** docs/design/2026-05-30-issue-445-slop-refactor-tdd.md
> **완료 조건:** TDD Ch.6 **Must** AC를 모두 충족하고, Ch.6 테스트 중 **CI gate = yes** 항목이 CI에서 green
> **품질 게이트:** PR-A / PR-B / PR-C **각 PR merge 전** repo root에서 `npm test`, `npm run lint`, `npm run type-check`를 실행하고 exit 0 확인

## 추적 매트릭스 (RTM)

| PRD | AC | Task IDs | Test IDs | 구성요소 / 범위 |
|-----|-----|----------|----------|-----------------|
| [source:prd#프로덕션-critical-1건] | AC-1 | TK-004, TK-005, TK-006, TK-007, TK-008, TK-015 | T-1, T-2, T-6 | `recall-tool.ts`, recall-tool-* 파이프라인 모듈 |
| [source:prd#staticjs-요약-8-파일] | AC-2 | TK-009, TK-010, TK-011, TK-012, TK-015 | T-3, T-4, T-6 | `static/js/review-candidates-panel.js`, `static/js/memory-evolution-demo-shell.js`, `static/dashboard.html` |
| [source:prd#완료-기준-품질] | AC-3 | TK-003, TK-013, TK-016, TK-017 | T-1, T-2, T-3, T-4 | PR별 `package.json` CI 게이트 (`npm test`, `lint`, `type-check`) |
| [source:prd#완료-기준-재스캔] | AC-4 | TK-002, TK-014 | T-6 | PR 본문 SlopVerificationEvidence |

## Dependencies

```text
TK-003 blockedBy TK-001
TK-004 blockedBy TK-003
TK-005 blockedBy TK-004
TK-006 blockedBy TK-005
TK-007 blockedBy TK-006
TK-008 blockedBy TK-007
TK-013 blockedBy TK-008
TK-009 blockedBy TK-013
TK-010 blockedBy TK-009
TK-016 blockedBy TK-010
TK-011 blockedBy TK-016
TK-012 blockedBy TK-011
TK-017 blockedBy TK-012
TK-014 blockedBy TK-017
TK-015 blockedBy TK-017
```

## Phase 0: 준비 (Setup)

- [ ] TK-001 [AC-1] [setup] Issue #445 후속 작업용 feature 브랜치 `chore/issue-445-slop-refactor`를 main에서 생성
- [ ] TK-002 [P] [AC-4] [setup] `slop-detector --project <path> --js --config .slopconfig.yaml`로 Before slop 점수 기록 — 대상: `packages/memento-core/src/domains/memory/recall/recall-tool.ts`, `static/js/review-candidates-panel.js`, `static/js/memory-evolution-demo-shell.js`

## Phase 1: 기반 (Foundation)

- [ ] TK-003 [AC-3] [setup] PR-A 착수 전 브랜치 tip에서 `package.json` 기준 repo root `npm test`, `npm run lint`, `npm run type-check` green baseline 확인

## Phase 2: AC-1 — recall-tool.ts CRITICAL_DEFICIT 제거 (PR-A)

- [ ] TK-004 [AC-1] 모듈 분리 전 `packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts` 103개 케이스 전부 통과 확인 — proves T-1
- [ ] TK-005 [AC-1] `packages/memento-core/src/domains/memory/recall/recall-tool.ts` constructor의 MCP schema JSON을 `recall-tool-schema.ts` 또는 신규 `recall-tool-definition.ts`로 이동 — proves T-1
- [ ] TK-006 [AC-1] search/post-search/envelope 파이프라인을 `packages/memento-core/src/domains/memory/tools/` 하위 sibling 모듈로 분리 (예: `recall-tool-search-execution.ts`, `recall-tool-post-search.ts`, `recall-tool-envelope.ts`) — proves T-1
- [ ] TK-007 [AC-1] `packages/memento-core/src/domains/memory/recall/recall-tool.ts`의 `RecallTool.handle`을 coordinator 전용으로 축소; outer `handleFailure`·inner search telemetry rethrow 경로 유지 — proves T-1
- [ ] TK-008 [AC-1] PR-A에서 `packages/memento-core/src/domains/memory/tools/__tests__/telemetry-instrumentation.integration.spec.ts` recall 실패 체인 실행 — proves T-2
- [ ] TK-013 [AC-3] **PR-A merge 전** repo root에서 `npm test`, `npm run lint`, `npm run type-check` 실행 (`package.json` 스크립트); 모두 exit 0 — PR-A 품질 게이트

## Phase 3: AC-2 — review-candidates-panel (PR-B)

- [ ] TK-009 [AC-2] `static/js/review-candidates-panel.js`의 poll/SSE/render 클러스터를 companion script로 분리; facade 전역 유지하며 `static/dashboard.html` script 로드 순서 갱신 — proves T-3
- [ ] TK-010 [AC-2] PR-B에서 `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts` 문자열 계약 test green 유지 — proves T-3
- [ ] TK-016 [AC-3] **PR-B merge 전** repo root에서 `npm test`, `npm run lint`, `npm run type-check` 실행 (`package.json` 스크립트); 모두 exit 0 — PR-B 품질 게이트

## Phase 4: AC-2 — memory-evolution-demo-shell (PR-C)

- [ ] TK-011 [AC-2] `static/js/memory-evolution-demo-shell.js`의 scenario/auth/render 클러스터를 companion script로 분리; `static/dashboard.html` script 로드 순서 갱신 — proves T-4
- [ ] TK-012 [AC-2] PR-C에서 `packages/memento-server/src/server/dashboard-memory-evolution-demo-shell.spec.ts` 문자열 계약 test green 유지 — proves T-4
- [ ] TK-017 [AC-3] **PR-C merge 전** repo root에서 `npm test`, `npm run lint`, `npm run type-check` 실행 (`package.json` 스크립트); 모두 exit 0 — PR-C 품질 게이트

## Phase 5: AC-4 (Should) — PR slop Before/After 증거

- [ ] TK-014 [AC-4] 각 PR 본문에 slop Before/After 명령 출력 요약 붙여넣기; TDD Ch.6 SlopVerificationEvidence 절차에 따라 `https://github.com/jee1/memento/issues/445`에 증거 링크

## Phase 6: slop 검증

- [ ] TK-015 [AC-1] [AC-2] 변경 파일 After slop 스캔 실행; `recall-tool.ts`, `review-candidates-panel.js`, `memory-evolution-demo-shell.js`에 `[CRITICAL_DEFICIT]` 없음 확인 — proves T-6
