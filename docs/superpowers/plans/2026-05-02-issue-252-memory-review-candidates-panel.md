# Issue #252 — Review candidates dashboard panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth dashboard tab that lists **pending** memory review candidates via `GET /admin/memory/review-candidates?status=pending`, with loading / empty / error UI and token-based styling; fix `dashboard-tabs.js` selectors to match `m-tab-bar` / `m-tab-btn` markup so tab switching works.

**Architecture:** Extend `static/dashboard.html` with a new tab + `tab-review-candidates` panel and mount `static/js/review-candidates-panel.js` (IIFE) exposing `window.initReviewCandidatesPanel`, invoked from `activateTab('review')` in `dashboard-tabs.js` (same pattern as `initEmbeddingMap`). Client uses only `mementoAdminFetch` for the admin JSON endpoint. No status filter UI; no preview or POST (#253–#254).

**Tech Stack:** Static HTML/CSS/JS (no bundler), existing `memento-admin-fetch.js`, Vitest in `memento-server` reading static files for regression.

**Spec:** `docs/superpowers/specs/2026-05-02-issue-252-memory-review-candidates-panel-design.md`

---

## File map

| File | Action |
|------|--------|
| `static/js/dashboard-tabs.js` | Modify — selectors `.m-tab-bar` / `.m-tab-btn`; `activateTab` handles `review` + `initReviewCandidatesPanel`; resize branch includes `review` |
| `static/dashboard.html` | Modify — fourth tab button + `tab-review-candidates` panel markup + script tag for `review-candidates-panel.js` |
| `static/js/review-candidates-panel.js` | Create — fetch, render table, loading/error/empty, refresh button |
| `static/css/dashboard.css` | Modify — layout block for review panel (flex, padding via tokens); optional `.rc-*` helpers |
| `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts` | Create — asserts HTML/JS contain required strings and corrected selectors |

---

## Constants (copy into implementation)

- List URL: `/admin/memory/review-candidates?status=pending`
- `reason` display cap: **120** characters (ellipsis if longer)
- Panel element IDs (must match HTML and JS): `tab-review-candidates`, `rc-loading`, `rc-error`, `rc-empty`, `rc-table-wrap`, `rc-table`, `rc-refresh-btn`, `rc-status-line`, `dashboard-tab-review`

---

### Task 0: Fix tab selectors + wire `review` tab in `dashboard-tabs.js`

**Files:**

- Modify: `static/js/dashboard-tabs.js`

- [ ] **Step 1: Replace wrong selectors**

Apply these replacements (whole file):

| Find | Replace |
|------|---------|
| `document.querySelectorAll('.tab-bar .tab-btn')` | `document.querySelectorAll('.m-tab-bar .m-tab-btn')` |
| `document.querySelectorAll('.tab-btn')` | `document.querySelectorAll('.m-tab-btn')` |
| `document.querySelector('.tab-btn[data-tab="' + name + '"]')` | `document.querySelector('.m-tab-btn[data-tab="' + name + '"]')` |
| `document.querySelector('.tab-bar')` | `document.querySelector('.m-tab-bar')` |
| `target.classList.contains('tab-btn')` | `target.classList.contains('m-tab-btn')` |
| `document.querySelector('.tab-btn[data-tab="anchor"]')` | `document.querySelector('.m-tab-btn[data-tab="anchor"]')` |

- [ ] **Step 2: Extend `activateTab` for the review panel**

Inside `activateTab`, after `const graphPanel = ...` add:

```javascript
    const reviewPanel = document.getElementById('tab-review-candidates');
```

After the `graphPanel` visibility block, add:

```javascript
    if (reviewPanel) {
      reviewPanel.classList.toggle('active', name === 'review');
      reviewPanel.setAttribute('aria-hidden', name === 'review' ? 'false' : 'true');
    }
```

After the `if (name === 'embedding' && typeof window.initEmbeddingMap === 'function')` block, add:

```javascript
    if (name === 'review' && typeof window.initReviewCandidatesPanel === 'function') {
      window.initReviewCandidatesPanel();
    }
```

Change the resize branch from:

```javascript
    } else if (name === 'anchor' || name === 'embedding') {
```

to:

```javascript
    } else if (name === 'anchor' || name === 'embedding' || name === 'review') {
```

- [ ] **Step 3: Commit**

```bash
git add static/js/dashboard-tabs.js
git commit -m "fix(dashboard): align tab script selectors with m-tab-* markup (#252)"
```

---

### Task 1: `dashboard.html` — fourth tab + panel shell

**Files:**

- Modify: `static/dashboard.html`

- [ ] **Step 1: Add tab button** (after the Memory Graph tab button, before `</div>` closing `m-tab-bar`)

```html
      <button type="button" id="dashboard-tab-review" class="m-tab-btn" role="tab" tabindex="-1" aria-selected="false" aria-controls="tab-review-candidates" data-tab="review">Review Queue</button>
```

- [ ] **Step 2: Add tabpanel** (after `tab-graph` panel, before closing `dashboard-container`)

```html
    <div id="tab-review-candidates" class="tab-panel session-only" role="tabpanel" aria-labelledby="dashboard-tab-review" aria-hidden="true">
      <div class="review-candidates-layout">
        <header class="review-candidates-header">
          <h2 class="review-candidates-title">Memory review candidates</h2>
          <button type="button" id="rc-refresh-btn" class="m-button m-button--secondary">Refresh</button>
        </header>
        <p id="rc-status-line" class="review-candidates-status" aria-live="polite"></p>
        <div id="rc-loading" class="rc-banner hidden">Loading…</div>
        <div id="rc-error" class="rc-banner rc-banner--error hidden" role="alert"></div>
        <div id="rc-empty" class="rc-banner hidden">No pending review candidates.</div>
        <div id="rc-table-wrap" class="review-candidates-table-wrap hidden">
          <table id="rc-table" class="review-candidates-table">
            <thead>
              <tr>
                <th scope="col">Priority</th>
                <th scope="col">Memory ID</th>
                <th scope="col">Status</th>
                <th scope="col">Reason</th>
                <th scope="col">Due</th>
                <th scope="col">Candidate ID</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Add script** (after `embedding-map.js`, before `</body>`)

```html
  <script src="/static/js/review-candidates-panel.js"></script>
```

- [ ] **Step 4: Commit**

```bash
git add static/dashboard.html
git commit -m "feat(dashboard): add review queue tab shell (#252)"
```

---

### Task 2: `review-candidates-panel.js` — fetch + render

**Files:**

- Create: `static/js/review-candidates-panel.js`

- [ ] **Step 1: Create file with full implementation**

```javascript
/**
 * Review candidates panel (#252) — pending list via mementoAdminFetch
 */
(function (global) {
  'use strict';

  const LIST_URL = '/admin/memory/review-candidates?status=pending';
  const REASON_MAX = 120;

  let wired = false;
  let loadedOnce = false;

  function $(id) {
    return document.getElementById(id);
  }

  function setHidden(el, hidden) {
    if (!el) {
      return;
    }
    el.classList.toggle('hidden', hidden);
  }

  function clearStatus() {
    const line = $('rc-status-line');
    if (line) {
      line.textContent = '';
    }
  }

  function truncateReason(text) {
    if (!text) {
      return '';
    }
    if (text.length <= REASON_MAX) {
      return text;
    }
    return text.slice(0, REASON_MAX) + '…';
  }

  function renderTable(candidates) {
    const wrap = $('rc-table-wrap');
    const table = $('rc-table');
    const tbody = table && table.querySelector('tbody');
    if (!wrap || !tbody) {
      return;
    }
    tbody.textContent = '';
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        escapeHtml(String(c.priority ?? '')) +
        '</td><td class="rc-cell-mono">' +
        escapeHtml(String(c.memory_id ?? '')) +
        '</td><td>' +
        escapeHtml(String(c.status ?? '')) +
        '</td><td class="rc-cell-reason">' +
        escapeHtml(truncateReason(String(c.reason ?? ''))) +
        '</td><td class="rc-cell-mono">' +
        escapeHtml(String(c.due_at ?? '')) +
        '</td><td class="rc-cell-mono">' +
        escapeHtml(String(c.id ?? '')) +
        '</td>';
      tbody.appendChild(tr);
    }
    setHidden(wrap, false);
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showLoading(on) {
    setHidden($('rc-loading'), !on);
  }

  function showError(msg) {
    const el = $('rc-error');
    if (el) {
      el.textContent = msg || 'Request failed';
    }
    setHidden($('rc-error'), !msg);
  }

  function showEmpty(on) {
    setHidden($('rc-empty'), !on);
  }

  function hideTable() {
    setHidden($('rc-table-wrap'), true);
  }

  async function loadList() {
    const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    showError('');
    showLoading(true);
    hideTable();
    showEmpty(false);
    clearStatus();

    try {
      const res = await fetchFn(LIST_URL, { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(function () {
        return {};
      });
      showLoading(false);
      if (!res.ok) {
        const msg =
          (body && (body.error || body.message)) ||
          'HTTP ' + res.status;
        showError(String(msg));
        return;
      }
      const candidates = (body && body.candidates) || [];
      const ts = body && body.timestamp;
      const line = $('rc-status-line');
      if (line && ts) {
        line.textContent = 'Last updated: ' + ts;
      }
      if (!candidates.length) {
        showEmpty(true);
        return;
      }
      renderTable(candidates);
    } catch (e) {
      showLoading(false);
      showError(e instanceof Error ? e.message : 'Network error');
    }
  }

  function initReviewCandidatesPanel() {
    if (!wired) {
      wired = true;
      const btn = $('rc-refresh-btn');
      if (btn) {
        btn.addEventListener('click', function () {
          loadedOnce = true;
          loadList();
        });
      }
    }
    if (!loadedOnce) {
      loadedOnce = true;
      loadList();
    }
  }

  global.initReviewCandidatesPanel = initReviewCandidatesPanel;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Commit**

```bash
git add static/js/review-candidates-panel.js
git commit -m "feat(dashboard): load pending review candidates list (#252)"
```

---

### Task 3: `dashboard.css` — layout + table readability

**Files:**

- Modify: `static/css/dashboard.css`

- [ ] **Step 1: Append styles** (after `.m-tab-btn.active` block or near other tab-panel rules)

Open `static/css/tokens.css` and **replace** `--color-danger` / `--color-danger-text` below with tokens that actually exist (e.g. semantic error colors if defined); if none, use existing `--color-text-main` plus a simple border token.

```css
/* Review candidates panel (#252) */
.review-candidates-layout {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: var(--spacing-md);
  gap: var(--spacing-sm);
  background: var(--color-bg-main);
}

.review-candidates-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.review-candidates-title {
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text-main);
}

.review-candidates-status {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.rc-banner {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  color: var(--color-text-main);
}

.rc-banner--error {
  border: 1px solid var(--color-tab-border);
  color: var(--color-text-main);
}

.review-candidates-table-wrap {
  overflow: auto;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--color-tab-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
}

.review-candidates-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.review-candidates-table th,
.review-candidates-table td {
  padding: var(--spacing-xs) var(--spacing-sm);
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--color-tab-border);
}

.review-candidates-table th {
  position: sticky;
  top: 0;
  background: var(--color-bg-card);
  z-index: 1;
}

.rc-cell-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  word-break: break-all;
}

.rc-cell-reason {
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 36rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add static/css/dashboard.css
git commit -m "style(dashboard): review candidates panel layout (#252)"
```

---

### Task 4: Vitest static regression

**Files:**

- Create: `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts`

- [ ] **Step 1: Add spec**

```typescript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const tabsJs = readFileSync(resolve(root, 'static/js/dashboard-tabs.js'), 'utf8');
const panelJs = readFileSync(resolve(root, 'static/js/review-candidates-panel.js'), 'utf8');

describe('dashboard review candidates panel (#252)', () => {
  it('dashboard.html includes review tab, panel, and script', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-review"');
    expect(dashboardHtml).toContain('data-tab="review"');
    expect(dashboardHtml).toContain('id="tab-review-candidates"');
    expect(dashboardHtml).toContain('/static/js/review-candidates-panel.js');
    expect(dashboardHtml).toContain('id="rc-refresh-btn"');
  });

  it('dashboard-tabs.js uses m-tab selectors and review branch', () => {
    expect(tabsJs).toContain('.m-tab-bar');
    expect(tabsJs).toContain('.m-tab-btn');
    expect(tabsJs).not.toContain(".querySelectorAll('.tab-btn')");
    expect(tabsJs).toContain("'tab-review-candidates'");
    expect(tabsJs).toContain('initReviewCandidatesPanel');
  });

  it('review-candidates-panel.js targets pending list endpoint', () => {
    expect(panelJs).toContain('/admin/memory/review-candidates?status=pending');
    expect(panelJs).toContain('initReviewCandidatesPanel');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts
```

Expected: all tests **PASS**.

- [ ] **Step 3: Commit**

```bash
git add packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts
git commit -m "test(server): static regression for review candidates dashboard (#252)"
```

---

### Task 5: Quality gates + graphify

**Files:** (none — commands only)

- [ ] **Step 1: Full server tests + lint**

```bash
npm run test:ci:server
npm run lint
```

Expected: **PASS** / no new errors.

- [ ] **Step 2: Graphify (repo rule)**

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

- [ ] **Step 3: Commit graphify outputs if changed**

```bash
git status
# If graphify-out changed:
git add graphify-out/
git commit -m "chore(graphify): rebuild after #252 dashboard changes"
```

---

## Plan self-review

| Spec section | Covered by |
|--------------|------------|
| `?status=pending` default | Task 2 URL constant; Task 4 assertion |
| No status filter UI | No task adds filter controls |
| Tab selector fix + PR narrative | Task 0 commit message + Task 0 steps |
| Column fields (subset) | Task 1 table columns + Task 2 render |
| Loading / empty / error | Task 1 markup + Task 2 logic |
| Tokens / consistency | Task 3 uses `var(--…)` |
| Out of scope #253–255 | Not in tasks |
| Tests | Task 4–5 |

**Placeholder scan:** None intentional.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-issue-252-memory-review-candidates-panel.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — same session, executing-plans style checkpoints

**Which approach do you want?**
