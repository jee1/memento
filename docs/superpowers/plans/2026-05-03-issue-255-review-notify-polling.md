# Issue #255 — Review queue poll notify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document **polling vs `Notification` API vs SSE/WebSocket** for review-candidate alerts, recommend **polling-first** for the admin dashboard, and ship **minimal UX**: background poll of `GET /admin/memory/review-candidates?status=pending`, detect **pending count increase**, show **toast** + **tab badge** when the user is on another tab, refresh the table when on the Review tab.

**Architecture:** Reuse existing admin JSON endpoint and `mementoAdminFetch`. No new server routes. Client-only `setInterval` (60s) after the first successful list load; pause ticks when `document.visibilityState === 'hidden'`; on `visibilitychange` to visible, run one poll immediately. Track `lastPendingCount` across polls. Mirror the “WebSocket optional, polling fallback” idea used in `static/js/anchor-map.js`.

**Tech Stack:** Static `static/js/review-candidates-panel.js` (IIFE), `static/dashboard.html`, `static/css/dashboard.css` (tokens), Vitest string assertions in `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts`.

**Spec:** `docs/superpowers/specs/2026-05-03-issue-255-review-notify-polling-design.md`

**Shipped commit (reference):** `5297a2a` on branch `docs/issue-255-notify-spike` — use as baseline; following tasks include verification and regression tests added after that commit.

---

## File map

| File | Responsibility |
|------|----------------|
| `docs/superpowers/specs/2026-05-03-issue-255-review-notify-polling-design.md` | Decision record: comparison table, recommendation, manual verification, out-of-scope |
| `static/js/review-candidates-panel.js` | `fetchReviewCandidateListJson`, `applyListSuccess`, `runPollTick`, `startPollingIfNeeded`, toast/badge helpers, `initReviewCandidatesPanel` calls `loadList()` every tab visit |
| `static/dashboard.html` | `#rc-tab-badge` inside Review tab button; `#rc-toast` in panel |
| `static/css/dashboard.css` | `.m-tab-badge`, `.rc-toast` using design tokens |
| `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts` | Static regression: HTML/JS contain poll/toast/badge hooks |

---

### Task 0: Spec document

**Files:**

- Create: `docs/superpowers/specs/2026-05-03-issue-255-review-notify-polling-design.md`

- [ ] **Step 1: Write the spec** (sections: goals, option matrix, chosen minimal implementation, security/ops notes, manual test steps, follow-ups).

Use the issue #255 GitHub body for scope boundaries (no Redis, no MCP).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-03-issue-255-review-notify-polling-design.md
git commit -m "docs(spec): issue #255 review notify polling spike"
```

---

### Task 1: Panel logic — fetch, apply, poll, toast, badge

**Files:**

- Modify: `static/js/review-candidates-panel.js`

- [ ] **Step 1: Add constants and state** (after `REASON_TABLE_MAX`)

```javascript
  const POLL_INTERVAL_MS = 60 * 1000;

  let pollTimer = null;
  let visListenerRegistered = false;
  let lastPendingCount = -1;
  let toastHideTimer = null;
```

- [ ] **Step 2: Implement `fetchReviewCandidateListJson`**

Same URL and headers as existing list load: `LIST_URL`, `Accept: application/json`, `mementoAdminFetch` when defined.

Returns `{ res, body }` after `res.json()` with empty-object fallback.

- [ ] **Step 3: Implement `applyListSuccess(body)`**

Set `rc-status-line` from `body.timestamp`, set `lastPendingCount = (body.candidates || []).length`, call `showEmpty` / `hideTable` / `renderTable` exactly as the successful branch of the pre-refactor `loadList`.

- [ ] **Step 4: Refactor `loadList`**

On success: `applyListSuccess(body)` then `startPollingIfNeeded()`. On error: unchanged user-visible behavior.

- [ ] **Step 5: Implement `runPollTick`**

If `lastPendingCount < 0`, return. Fetch JSON; if `!res.ok`, return silently. Let `n = candidates.length`, `prev = lastPendingCount`. If `prev >= 0 && n > prev`: compute `delta`, call `showNewCandidatesToast(delta, onReviewTab)`, if not on Review tab call `setReviewTabBadge(n)`, if on Review tab `applyListSuccess(body)` and return. Otherwise set `lastPendingCount = n`.

- [ ] **Step 6: Implement `startPollingIfNeeded`**

Single `setInterval` at `POLL_INTERVAL_MS`; register one `visibilitychange` listener that calls `runPollTick` when document becomes visible.

- [ ] **Step 7: Toast and badge helpers**

- `clearReviewTabBadge` — `#rc-tab-badge` hidden, empty text, `aria-hidden="true"`.
- `setReviewTabBadge(totalPending)` — show count up to `99+`.
- `showNewCandidatesToast(delta, onReviewTab)` — `#rc-toast` text differentiates on-tab (“List updated.”) vs off-tab (“Open Review Queue to refresh.”); auto-hide after 8s.

- [ ] **Step 8: `initReviewCandidatesPanel`**

First line `clearReviewTabBadge()`. Wire refresh once. Then `if (!loadedOnce) loadedOnce = true` and **always** `loadList()` so revisiting the tab refreshes stale rows.

- [ ] **Step 9: Commit**

```bash
git add static/js/review-candidates-panel.js
git commit -m "feat(dashboard): poll pending review candidates (#255)"
```

---

### Task 2: Markup — badge + toast

**Files:**

- Modify: `static/dashboard.html`

- [ ] **Step 1: Tab badge**

Inside the Review tab `<button id="dashboard-tab-review" ...>`:

```html
Review Queue <span id="rc-tab-badge" class="m-tab-badge hidden" aria-hidden="true"></span>
```

- [ ] **Step 2: Toast container**

After `#rc-empty` div, before `review-candidates-body`:

```html
        <div id="rc-toast" class="rc-toast hidden" role="status" aria-live="polite"></div>
```

- [ ] **Step 3: Commit**

```bash
git add static/dashboard.html
git commit -m "feat(dashboard): review queue tab badge and toast mount (#255)"
```

---

### Task 3: Styles

**Files:**

- Modify: `static/css/dashboard.css`

- [ ] **Step 1: After `.m-tab-btn.active` block**, add `.m-tab-badge` using `var(--spacing-xs)`, `var(--radius-full)`, `var(--color-warning)`, `var(--color-text-inverse)`, `var(--font-size-xs)`.

- [ ] **Step 2: After `.rc-banner--error`**, add `.rc-toast` fixed bottom-right using `var(--spacing-md)`, `var(--z-index-tooltip)`, `var(--shadow-md)`, `var(--color-bg-card)`, `var(--color-border-light)`, `var(--font-size-sm)`.

- [ ] **Step 3: Commit**

```bash
git add static/css/dashboard.css
git commit -m "style(dashboard): tab badge and poll toast tokens (#255)"
```

---

### Task 4: Vitest regression strings

**Files:**

- Modify: `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts`

- [ ] **Step 1: Append a second `describe` block** `dashboard review queue poll notify (#255)`:

```typescript
describe('dashboard review queue poll notify (#255)', () => {
  it('dashboard.html includes toast and tab badge placeholders', () => {
    expect(dashboardHtml).toContain('id="rc-toast"');
    expect(dashboardHtml).toContain('id="rc-tab-badge"');
  });

  it('review-candidates-panel.js includes polling helpers', () => {
    expect(panelJs).toContain('POLL_INTERVAL_MS');
    expect(panelJs).toContain('runPollTick');
    expect(panelJs).toContain('startPollingIfNeeded');
  });
});
```

- [ ] **Step 2: Run targeted test**

```bash
cd /path/to/repo
npx vitest --run packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts
git commit -m "test(dashboard): assert review poll notify hooks (#255)"
```

---

### Task 5: Verification gate

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: exit code 0 (warnings allowed per repo).

- [ ] **Step 2: Full test**

```bash
npm test
```

Expected: exit code 0.

- [ ] **Step 3: Manual smoke (HTTP admin)**

1. `npm run dev:http` (or your usual admin command).
2. Open dashboard, log in, open **Review Queue** once (starts poll).
3. Switch to another tab; add a pending candidate (batch/API/DB per your env).
4. Within ~60s (or switch away and back to trigger visibility poll): toast appears; if off-tab, badge on Review Queue.
5. Open Review Queue: badge clears, table matches server.

---

## Self-review (plan vs spec)

| Spec section | Task coverage |
|--------------|---------------|
| Option comparison + recommendation | Task 0 |
| Minimal polling + badge + toast | Tasks 1–3 |
| No new API / admin session | Tasks 1–2 |
| Manual verification | Task 5 |
| Vitest / regression | Task 4 |
| Follow-ups (Notification, SSE) | Task 0 prose only — no code in this issue |

No TBD placeholders in executable tasks above.

---

## Execution handoff

**Plan saved to:** `docs/superpowers/plans/2026-05-03-issue-255-review-notify-polling.md`

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task; use superpowers:subagent-driven-development between tasks.

2. **Inline Execution** — same session, checkpoints; use superpowers:executing-plans.

**Which approach?** (Core implementation may already match commit `5297a2a`; remaining checkbox work is Task 4–5 if not yet applied on your branch.)
