# Issue #254 — Review / Dismiss dashboard actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `POST /admin/memory/review-candidates/:id/review` and `POST .../dismiss` from the dashboard preview panel, refresh the pending list via full refetch after success, surface 404/409/400/500 errors on `#rc-error`, and prevent double-submit with disabled buttons and `aria-busy`.

**Architecture:** Extend `#rc-preview-detail` in `static/dashboard.html` with a two-button action row. `static/js/review-candidates-panel.js` adds `data-candidate-id` on each table row, enables actions only when a row is selected and preview is visible, uses `mementoAdminFetch` with JSON POST bodies, then calls existing `loadList()` on success (same path as initial load and poll). No server or core changes.

**Tech Stack:** Static HTML/CSS/JS, `mementoAdminFetch`, Vitest string regression in `packages/memento-server`.

**Spec:** `docs/superpowers/specs/2026-05-04-issue-254-review-dismiss-ui-design.md`

---

## File map

| File | Action |
|------|--------|
| `static/dashboard.html` | Modify — inside `#rc-preview-detail`, add `#rc-preview-actions` with `#rc-btn-review` and `#rc-btn-dismiss` before closing `rc-preview-detail` |
| `static/css/dashboard.css` | Modify — after `.rc-preview-content` block (~line 848), add `.rc-preview-actions` flex layout using spacing tokens |
| `static/js/review-candidates-panel.js` | Modify — `data-candidate-id`, POST helpers, button wiring, `loadList` after success |
| `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts` | Modify — assert HTML button ids + JS POST path fragments |

---

## Constants (must match implementation)

- List URL (unchanged): `/admin/memory/review-candidates?status=pending`
- POST path template: `/admin/memory/review-candidates/<uuid>/review` and `.../dismiss` (use `encodeURIComponent` on `id` in JS)
- Element IDs: `rc-preview-actions`, `rc-btn-review`, `rc-btn-dismiss` (plus existing `rc-error`, `rc-toast`)

---

### Task 1: Failing Vitest — require #254 strings

**Files:**

- Modify: `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts`

- [ ] **Step 1: Add a new `it` inside the first `describe` block** (after the existing `review-candidates-panel.js targets pending list...` test)

Append this entire test:

```typescript
  it('review-candidates-panel.js POST review/dismiss paths and dashboard preview actions (#254)', () => {
    expect(panelJs).toContain('/admin/memory/review-candidates/');
    expect(panelJs).toContain('encodeURIComponent');
    expect(panelJs).toContain("postCandidateAction('review')");
    expect(panelJs).toContain("postCandidateAction('dismiss')");
    expect(dashboardHtml).toContain('id="rc-preview-actions"');
    expect(dashboardHtml).toContain('id="rc-btn-review"');
    expect(dashboardHtml).toContain('id="rc-btn-dismiss"');
  });
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts -t "#254"
```

(저장소 루트에서 실행. `process.cwd()`가 `static/`을 올바르게 찾도록 유지.)

Expected: **FAIL** (assertions not found in HTML/JS).

- [ ] **Step 3: Commit test only (optional checkpoint)**

```bash
git add packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts
git commit -m "test(dashboard): add #254 regression expectations for review/dismiss UI"
```

---

### Task 2: `dashboard.html` — preview action buttons

**Files:**

- Modify: `static/dashboard.html`

- [ ] **Step 1: Insert markup** inside `<div id="rc-preview-detail" ...>`, **after** the `<pre id="rc-preview-content" ...></pre>` line and **before** the closing `</div>` of `rc-preview-detail`:

```html
                <div id="rc-preview-actions" class="rc-preview-actions" aria-busy="false">
                  <button type="button" id="rc-btn-review" class="m-button m-button--secondary" disabled>Review</button>
                  <button type="button" id="rc-btn-dismiss" class="m-button m-button--secondary" disabled>Dismiss</button>
                </div>
```

- [ ] **Step 2: Commit**

```bash
git add static/dashboard.html
git commit -m "feat(dashboard): add review/dismiss buttons to review preview (#254)"
```

---

### Task 3: `dashboard.css` — action row layout

**Files:**

- Modify: `static/css/dashboard.css`

- [ ] **Step 1: Append after `.rc-preview-content { ... }` block** (after its closing `}` and before `.review-candidates-table tbody tr.rc-row--selected`):

```css
.rc-preview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}

.rc-preview-actions[aria-busy='true'] {
  opacity: 0.65;
  pointer-events: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add static/css/dashboard.css
git commit -m "style(dashboard): layout for review preview actions (#254)"
```

---

### Task 4: `review-candidates-panel.js` — POST + refetch + guards

**Files:**

- Modify: `static/js/review-candidates-panel.js`

- [ ] **Step 1: Add module-level state** after existing `let toastHideTimer = null;`:

```javascript
  let actionInFlight = false;
```

- [ ] **Step 2: In `renderTable`**, after `const dueRaw = String(c.due_at ?? '');`, add:

```javascript
      const candidateId = String(c.id ?? '');
```

Change `tr.dataset` assignments to include:

```javascript
      tr.dataset.candidateId = candidateId;
```

(Keep existing `memoryId`, `reason`, `due`, etc.)

- [ ] **Step 3: Add helpers** (after `previewUrl` function is a good place):

```javascript
  function reviewCandidatePostUrl(id, action) {
    return '/admin/memory/review-candidates/' + encodeURIComponent(id) + '/' + action;
  }

  function getPreviewActionsEl() {
    return $('rc-preview-actions');
  }

  function setPreviewActionsBusy(busy) {
    const wrap = getPreviewActionsEl();
    if (wrap) {
      wrap.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
  }

  function syncReviewDismissButtons() {
    const reviewBtn = $('rc-btn-review');
    const dismissBtn = $('rc-btn-dismiss');
    const id = selectedRow && selectedRow.dataset.candidateId ? String(selectedRow.dataset.candidateId) : '';
    const detail = $('rc-preview-detail');
    const visible = detail && !detail.classList.contains('hidden');
    const enable = !!(id && visible && !actionInFlight);
    if (reviewBtn) {
      reviewBtn.disabled = !enable;
    }
    if (dismissBtn) {
      dismissBtn.disabled = !enable;
    }
  }

  function showActionToast(message) {
    const t = $('rc-toast');
    if (!t) {
      return;
    }
    t.textContent = message;
    t.classList.remove('hidden');
    if (toastHideTimer) {
      clearTimeout(toastHideTimer);
    }
    toastHideTimer = setTimeout(function () {
      t.classList.add('hidden');
      t.textContent = '';
      toastHideTimer = null;
    }, 4000);
  }

  async function postCandidateAction(action) {
    const id = selectedRow && selectedRow.dataset.candidateId ? String(selectedRow.dataset.candidateId) : '';
    if (!id || actionInFlight) {
      return;
    }
    actionInFlight = true;
    setPreviewActionsBusy(true);
    syncReviewDismissButtons();
    showError('');
    const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    const url = reviewCandidatePostUrl(id, action);
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        const msg =
          (body && (body.error || body.message)) ||
          (res.status === 409
            ? 'This candidate can no longer be updated (conflict).'
            : res.status === 404
              ? 'Review candidate not found.'
              : 'HTTP ' + res.status);
        showError(String(msg));
        return;
      }
      showActionToast(action === 'review' ? 'Marked as reviewed.' : 'Dismissed.');
      await loadList();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Network error');
    } finally {
      actionInFlight = false;
      setPreviewActionsBusy(false);
      syncReviewDismissButtons();
    }
  }
```

- [ ] **Step 4: Call `syncReviewDismissButtons()`** at end of `onRowActivate` (after `loadMemoryPreview(...)`).

- [ ] **Step 5: Extend `resetPreviewPanel`** — after existing clears, call `syncReviewDismissButtons()` (buttons stay disabled when preview hidden).

- [ ] **Step 6: Wire buttons once** inside `initReviewCandidatesPanel` after refresh button wiring (`if (!wired)` block):

```javascript
      const reviewBtn = $('rc-btn-review');
      const dismissBtn = $('rc-btn-dismiss');
      if (reviewBtn) {
        reviewBtn.addEventListener('click', function () {
          void postCandidateAction('review');
        });
      }
      if (dismissBtn) {
        dismissBtn.addEventListener('click', function () {
          void postCandidateAction('dismiss');
        });
      }
```

- [ ] **Step 7: Ensure Task 1 test strings match** — if you used template literals for URLs, update `dashboard-review-candidates-panel.spec.ts` substring expectations accordingly (must stay in sync).

- [ ] **Step 8: Commit**

```bash
git add static/js/review-candidates-panel.js
git commit -m "feat(dashboard): POST review/dismiss with refetch and guards (#254)"
```

---

### Task 5: Verify full spec file + graphify (code touch)

**Files:** (none new)

- [ ] **Step 1: Run Vitest for the dashboard static suite**

```bash
npm test --workspace packages/memento-server -- src/server/dashboard-review-candidates-panel.spec.ts
```

Expected: **all tests PASS**.

- [ ] **Step 2: Lint (repo root)**

```bash
npm run lint
```

Expected: **PASS** (no new violations).

- [ ] **Step 3: Graphify rebuild (repo rule)**

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

- [ ] **Step 4: Final commit** if graphify or lint produced changes:

```bash
git status
git add -A
git commit -m "chore: graphify refresh after #254 dashboard changes"   # only if files changed
```

---

## Plan self-review (spec coverage)

| Spec section | Tasks covering it |
|--------------|-------------------|
| POST review/dismiss from UI | Task 4 `postCandidateAction` |
| Full refetch after success | Task 4 `await loadList()` in success branch |
| 400/404/409/500 messaging | Task 4 `showError` + status fallbacks |
| Disabled / in-flight / aria-busy | Task 2 markup, Task 3 CSS, Task 4 `actionInFlight` + `syncReviewDismissButtons` |
| `data-candidate-id` | Task 4 `renderTable` |
| Preview-only actions (option A) | Task 2 buttons inside `#rc-preview-detail` |
| Tests | Task 1 + Task 5 |
| graphify after code | Task 5 |

**Placeholder scan:** None intentional.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-04-issue-254-review-dismiss-ui.md`.

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.

**2. Inline Execution** — run steps in this session with executing-plans checkpoints.

Which approach do you want for implementation?
