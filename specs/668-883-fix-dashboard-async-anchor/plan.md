# Implementation Plan: 대시보드 검토·세션 비동기 상태와 모바일 Anchor Map 안정화

**Branch**: `feature/fix-dashboard-anchor-map` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/668-883-fix-dashboard-async-anchor/spec.md`
**Issue**: [#883](https://github.com/jee1/memento/issues/883)

## Summary

Admin 대시보드 프론트에서 (1) Review Queue preview·액션 stale race,
(2) Agent Sessions detail/timeline stale race, (3) SSE/poll 선택 소실·count-only poll,
(4) checkbox Space 가로채기, (5) 모바일 Anchor Map 0px·탭 overflow,
(6) auth `[hidden]` vs `display:flex` 충돌을 고친다.

서버 API·MCP 계약 변경 없음. 기존 Vitest vm/harness 패턴
(`dashboard-review-candidates-panel.spec.ts`, `dashboard-agent-sessions-panel.spec.ts`)
을 확장해 TDD로 고정한다.

## Technical Context

**Language/Version**: TypeScript 5.x (tests), vanilla JS (static dashboard), Node.js ≥24
**Primary Dependencies**: none new; Vitest + `node:vm` harness
**Storage**: N/A
**Testing**: `packages/memento-server/src/server/dashboard-*-panel.spec.ts` (+ CSS contract asserts)
**Target Platform**: Admin HTTP dashboard browsers (desktop + 320–390px)
**Project Type**: monorepo static UI bugfix
**Performance Goals**: O(n) list diff/fingerprint per snapshot; no extra network
**Constraints**: Principle I TDD; no MCP break (II); graphify after production JS/CSS edit
**Scale/Scope**: ~6–8 static JS/CSS files + existing panel specs

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | RED tests for stale races / Space / layout / hidden before code |
| Backward compatibility MCP | II (MUST) | PASS | MCP/API contracts unchanged |
| Schema/migration | III (MUST) | N/A | no DB |
| Quality gates | IV (MUST) | PASS | lint / type-check / focused tests + graphify |
| Observability | V (SHOULD) | N/A | client-only; no new failure modes on server |
| Additional Constraints | | PASS | Node 24 ESM test runner; no LoCoMo |

## Project Structure

### Documentation (this feature)

```text
specs/668-883-fix-dashboard-async-anchor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── review-preview-staleness.md
│   ├── agent-session-staleness.md
│   └── dashboard-layout-auth.md
├── checklists/requirements.md
├── progress.yml
├── spec.md
└── tasks.md
```

### Source Code (touched)

```text
static/js/
├── review-candidates-panel-shared.js          # previewGeneration, fingerprint helpers
├── review-candidates-panel-render-preview.js  # stale guard on preview apply
├── review-candidates-panel-render-actions.js  # POST target ↔ selection
├── review-candidates-panel-render-list.js     # Space/checkbox + selection restore
├── review-candidates-panel-poll-snapshot.js   # fingerprint apply (not count-only)
├── agent-sessions-panel-shared.js            # detailGeneration state
└── agent-sessions-panel-data.js              # selectSession/timeline stale drop

static/css/dashboard.css                      # [hidden], tab overflow-x, map min-height

packages/memento-server/src/server/
├── dashboard-review-candidates-panel.spec.ts # extend harness tests
└── dashboard-agent-sessions-panel.spec.ts    # extend / add race tests
```

## Complexity Tracking

없음. 기존 패널 모듈 경계 유지; 공용 util 패키지 신설 안 함.

## Execution Strategy

- Setup: harness entry points confirmed; progress.yml phases.
- Foundational [TDD]: shared state fields + fingerprint helper tests.
- US1–US3 (P1) parallel where files differ: Review race, Sessions race, poll/SSE preserve.
- US4–US5 (P2) parallel: keyboard + CSS/auth.
- Polish: lint / type-check / focused specs / graphify rebuild.
