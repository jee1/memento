# Implementation Plan: 040-static-graph-refactor

## Architecture

`anchor-map-*.js`, `embedding-map-state.js` 패턴을 따른다. `__MEMENTO_GRAPH__` 네임스페이스에 state·DOM·유틸을 두고, render/search/fetch/wire 모듈이 이를 참조한다.

## Module Boundaries

| 원본 | 분리 |
|------|------|
| `graph.js` | `graph-shared.js` (state, palette, DOM, status), `graph-search.js`, `graph-detail.js`, `graph-render.js`, `graph-fetch.js`, `graph.js` (wire+init) |
| `embedding-map-chart.js` | `embedding-map-chart-colors.js`, `-setup.js`, `-scatter.js`, thin `embedding-map-chart.js` |
| `embedding-map-fetch.js` | `embedding-map-fetch-status.js`, thin `embedding-map-fetch.js` |

## Test Strategy

- `tests/static-design-contracts.spec.ts`: `readGraphToken` → `graph-shared.js` 참조로 갱신
- `npm test && npm run lint && npm run type-check`
- `npm run lint:js` (있을 경우)

## Files to Touch

- `static/js/graph-*.js` (신규·수정)
- `static/js/embedding-map-chart-*.js`, `embedding-map-fetch-status.js`
- `static/graph.html`, `static/dashboard.html`
- `tests/static-design-contracts.spec.ts`
- `specs/040-static-graph-refactor/tasks.md`
