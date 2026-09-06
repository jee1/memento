# Research: 668-883-fix-dashboard-async-anchor

## R1 — Review preview race root cause

**Finding**: Preview fetch completion writes content without checking that
`state.selectedRow` still matches the request’s candidate. Actions enable from
current row id while content can be stale (`review-candidates-panel-render-preview.js`).

**Decision**: Dual guard — bump `previewGeneration` when starting fetch; on
resolve require generation match **and** `candidateId === selectedRow.dataset.candidateId`.

**Alternatives rejected**: AbortController-only (still need ignore-late-resolve);
global mutex (blocks legitimate B fetch).

## R2 — Agent Sessions race

**Finding**: `loadSessions` uses `loadGeneration`; `selectSession` / `loadTimeline`
do not (`agent-sessions-panel-data.js:57–99`). Late A responses overwrite B UI.

**Decision**: `detailGeneration` (+ selectedSessionId check) for detail/injections/timeline.

## R3 — Poll count-only apply

**Finding**: `applyQueueSnapshot` only calls `applyListSuccess` when `n > prev`
(`poll-snapshot.js:27–31`). Same count replacements/priority changes stick.

**Decision**: Compute fingerprint `id|priority|status|due` sorted join; apply when
fingerprint ≠ `lastListFingerprint`. Growth toast still uses count delta.

## R4 — SSE/full re-render wipes selection

**Finding**: `renderTable` always `clearRowSelection` + `resetPreviewPanel`.

**Decision**: Capture selected/bulk IDs before rebuild; after render restore if
IDs still present; re-open preview only if memory id unchanged.

## R5 — Checkbox Space

**Finding**: tbody `keydown` on Space/Enter `preventDefault` + `onRowActivate` for
any row, including when target is checkbox.

**Decision**: If `ev.target.closest('input[type=checkbox],.rc-cell-select')` then return early.

## R6 — Mobile map 0px + auth hidden

**Finding**: Flex `min-height: 0` chain + toolbar height → `#anchor-map` height 0 at
390×844. `.dashboard-auth-form { display:flex }` beats `[hidden]` / `.hidden`.

**Decision**: map wrapper `min-height: 200px`; `.m-tab-bar { overflow-x: auto }`;
`[hidden] { display: none !important; }` (or form-specific `[hidden]` rule).

## R7 — Test strategy

**Finding**: 27 Vitest panel tests pass; Playwright Chromium often missing locally.

**Decision**: Extend existing vm harnesses; CSS string contracts for min-height/`[hidden]`;
Playwright optional.

## NEEDS CLARIFICATION

None remaining (brainstorm Q1–Q6 resolved).
