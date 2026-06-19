# Implementation Plan: 028-dashboard-static-js-refactor

## Architecture

기존 `review-candidates-panel-*`, `agent-sessions-panel-*` 다파일 IIFE 패턴을 따른다. 각 모듈은 `global.__MEMENTO_*__` 또는 `global` export에 함수를 등록하고, `dashboard.html`에서 의존 순서대로 script를 로드한다.

## Module Boundaries

| 원본 | 분리 |
|------|------|
| `dashboard-tabs.js` | `dashboard-tabs-panels.js` (visibility), `dashboard-tabs-init.js` (탭별 init), `dashboard-tabs.js` (키보드·클릭·export) |
| `agent-sessions-panel-render.js` | `agent-sessions-panel-render-dom.js`, `-sessions.js`, `-timeline.js`, `-injections.js` |
| `embedding-map.js` | `embedding-map-state.js`, `-tooltip.js`, `-panel.js`, `-chart.js`, `-fetch.js`, `embedding-map.js` (init) |
| `review-candidates-panel-render.js` | `-render-preview.js`, `-render-actions.js`, `-render-list.js`, thin `render.js` |
| `review-candidates-panel-health.js` | `-health-render.js`, `-health-fetch.js`, thin `health.js` |

## Test Strategy

- 기존 Vitest contract specs 유지·필요 시 script 목록 갱신
- `npm test && npm run lint && npm run type-check`
- slop-detector: `static/js` 대상 `--js --config .slopconfig.yaml`

## Files to Touch

- `static/js/*` (신규·수정)
- `static/dashboard.html` (script tags)
- `packages/memento-server/src/server/dashboard-*-panel.spec.ts` (script 목록)
- `specs/028-dashboard-static-js-refactor/tasks.md`
