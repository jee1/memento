# Code Review: misc repair export · 손상 필터 · recall/remember -32603 (#811)

**Date**: 2026-09-05 | **Branch**: `feature/fix-misc-repair-export-recall-32603` | **Reviewer**: superspec review (`/speckit.superspec.review`)
**Scope**: 미커밋 작업 트리 — T001–T013 claimed done; US1–US5 + docs + polish gates

> **서브에이전트 디스패치**: `requesting-code-review` 스킬은 커밋 SHA 범위 기반이다. 본 worktree는 **아직 커밋 없음** → built-in 프로토콜(명세·엣지·헌법·품질·검증)로 대체.

## 요약

| 심각도 | 건수 |
|--------|------|
| Critical | 0 |
| Important | 1 |
| Suggestion | 2 |

**Verdict: PASS** — P1/P3 기능·계약·테스트 충족. 머지 전 untracked 신규 파일 스테이징 1건(I-1)만 확인하면 된다.

품질 게이트: lint(0 errors) · type-check · targeted vitest **170 passed** · `memory:repair-triple-sentences` dry-run exit 0 · graphify `GRAPH_REPORT.md` 존재.

---

## Important

### I-1. 신규 구현 파일이 git untracked 상태 (신뢰도 95)

**위치**:
- `packages/memento-core/src/shared/errors/` (전체 — `ToolInputValidationError` + spec)
- `packages/memento-core/src/domains/search/repositories/vector-search/vector-search-hybrid-query.spec.ts`

**문제**: diff에 반영된 수정 파일 외 **핵심 신규 산출물이 추적되지 않음**. 커밋 시 누락하면 CI에서 US1/US3/US5 검증·런타임 import가 깨진다.

**권장**: PR 전 `git add`로 위 경로 포함. `specs/665-811-misc-repair-export-recall/` 디렉터리도 함께 스테이징.

---

## Suggestion

### S-1. expand 상한 도달 후 예산 미달 warn 미구현 (신뢰도 85)

**위치**: `packages/memento-core/src/domains/memory/services/knowledge-context-bundle-builder.ts` (adaptive loop 종료 후)

**문제**: spec Edge / US2-6 — 검색으로 도달 가능한 정상 후보를 소진했는데 `memories.length < maxMemories`이면 **warn**(throw 금지). 현재는 손상 제외 warn만 있고, 부분 채움(1~4건 / maxMemories=5) 시 미달 warn이 없다. 동작(부분 반환·no throw)은 맞다.

**권장**: loop 종료 후 `memories.length > 0 && memories.length < maxMemories && searchLimit >= hardCap`(또는 `searchResult.items.length < searchLimit`)일 때 구조화 warn 1회 추가.

### S-2. `excludedEarly`가 마지막 search iteration만 집계 (신뢰도 82)

**위치**: `knowledge-context-bundle-builder.ts:370-372`, `:395`

**문제**: adaptive expand 중 매 iteration마다 `excludedEarly = excluded`로 **덮어씀**. 로그의 `excluded` 합계가 실제 누적 제외 건수보다 작을 수 있다. 기능·예산 채움에는 영향 없음.

**권장**: `excludedEarly += excluded` 또는 루프 밖 누적 카운터.

---

## 통과 확인 항목

### User Stories / FR / SC

| ID | 판정 | 근거 |
|----|------|------|
| US1 / FR-001·002 / SC-001·002 | **PASS** | `@memento/core` export smoke; `npm run memory:repair-triple-sentences` dry-run 0건 exit 0 |
| US2 / FR-003·004 / SC-003 | **PASS** | 조기 `hasBrokenTripleConjugation` + adaptive expand(×2, cap `min(maxMemories×16,100)`); 고비율 손상 픽스처에서 maxMemories 채움; `포함합니다`/`함합니다` 통과; 전량 손상 empty+no throw |
| US3 / FR-005·006 / SC-004 | **PASS** | `ToolInputValidationError` + `mapToolExecutionErrorToJsonRpc` → `-32602`; recall/remember type-less 테스트; `audit-tool-dispatch.mapToolDispatchError` 경유 |
| US4 / FR-008 / SC-006 | **PASS** | `docs/agents/agent-workflow.md` §진단 프로브; `AGENTS.md` §3.1 포인터 |
| US5 / FR-009 / SC-007 | **PASS** | SQL SELECT `vector_distance`; mapper `cosineDistanceToSimilarity`; `vector-search-hybrid-query.spec.ts` + mapper spec |
| FR-007 / SC-008 / OQ-5 | **PASS** | backtick remember smoke 통과; `progress.yml` `backtick_repro: unreproduced_non_blocking` |
| SC-005 | **PASS** | lint · type-check · targeted tests |

### Edge Cases (≥80% confidence)

| Case | Expected | Result |
|------|----------|--------|
| repair 0건 | exit 0, 스크립트 유지 | OK |
| 후보 전량 손상 | empty + warn, no throw | OK (손상 warn) |
| 고비율 손상 + 하위 정상 | expand로 채움 | OK (dedicated test) |
| type 누락 error mode | `-32602` stable name | OK |
| Zod / Unknown tool | `-32602` / `-32601` 회귀 없음 | OK |
| content LIKE 단독 제외 | 금지 | OK (JS predicate only) |
| expand cap 후 정상 부족 | partial + warn | **부분만** (S-1) |

### Constitution I–V

| Gate | 판정 |
|------|------|
| I Test-First | RED→GREEN 흔적: bundle adaptive, mapper hybrid, mcp-tool-call-error, export smoke |
| II Backward compat | MCP 파라미터 스키마 불변; `-32602`는 계약 정정 |
| III Schema | DDL 없음 |
| IV Quality gates | lint/type-check/tests/graphify |
| V Observability | empty bundle soft-fail; 손상 제외 warn |

### Non-Goals 준수

- `함합니다` 탐지 확장 없음 (#781)
- repair 스크립트 삭제 없음
- Zod `type` required 승격 없음
- feedback 훅 강제 없음
- fragile SQL LIKE 제외 없음

---

## 검증 (review run)

```bash
npm test -- \
  packages/memento-core/src/domains/memory/services/__tests__/knowledge-context-bundle-builder.spec.ts \
  packages/memento-server/src/server/utils/mcp-tool-call-error.spec.ts \
  packages/memento-core/src/domains/search/repositories/vector-search/vector-search-result-mapper.spec.ts \
  packages/memento-core/src/domains/search/repositories/vector-search/vector-search-hybrid-query.spec.ts \
  packages/memento-core/src/shared/errors/tool-input-validation-error.spec.ts \
  scripts/repair-triple-sentence-memories.spec.ts \
  packages/memento-core/src/domains/memory/recall/__tests__/recall-tool-basics.spec.ts \
  packages/memento-core/src/domains/memory/remember/__tests__/remember-tool.spec.ts
# → 8 files, 170 tests passed

npm run lint && npm run type-check
# → 0 errors

DB_PATH=:memory: npm run memory:repair-triple-sentences
# → 복구 대상: 0건 (dry-run), exit 0
```

---

## 병합 의견

**조건부 승인 → PASS** (I-1 스테이징 후 머지 가능).

Critical 0 · 핵심 US/FR/SC 충족. S-1은 후속 또는 동 PR polish로 처리 가능(Non-blocking).

### FAIL 시 조치 목록 (해당 없음 — PASS)

_(FAIL이었다면: I-1 스테이징, S-1 underfill warn 추가)_
