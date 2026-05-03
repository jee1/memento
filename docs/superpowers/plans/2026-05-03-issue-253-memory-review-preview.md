# Issue #253 — Memory review row preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin `GET /admin/memory/items/:memory_id` and dashboard Review Queue row selection with a responsive preview panel showing full reason/due and memory `content`.

**Architecture:** Core holds SQL + id validation; Express admin router exposes JSON; static `review-candidates-panel.js` fetches preview on row activate; CSS grid stacks on narrow viewports.

**Tech Stack:** TypeScript, better-sqlite3, Express, Vitest, vanilla JS, design tokens.

---

### Task 1: Core preview service

**Files:**

- Create: `packages/memento-core/src/domains/memory/services/admin-memory-item-preview-service.ts`
- Create: `packages/memento-core/src/domains/memory/services/admin-memory-item-preview-service.spec.ts`
- Modify: `packages/memento-core/src/index.ts` (re-export)

- [x] Implement `parseAdminMemoryItemIdParam` and `getAdminMemoryItemPreviewById`.
- [x] Vitest: valid id, invalid id, found row, deleted row → null.

### Task 2: Admin HTTP route

**Files:**

- Modify: `packages/memento-server/src/server/routes/admin.routes.ts`
- Modify: `packages/memento-server/src/server/routes/admin.routes.spec.ts` (extend in-memory `memory_item` with `owner_id` if needed)

- [x] `GET /admin/memory/items/:memory_id` → 200 JSON, 400, 404, 500 paths.
- [x] Log without body content.

### Task 3: Dashboard markup & styles

**Files:**

- Modify: `static/dashboard.html`
- Modify: `static/css/dashboard.css`

- [x] Two-column body + preview aside + placeholder/detail regions.
- [x] Responsive single column ≤56rem.

### Task 4: Panel JavaScript

**Files:**

- Modify: `static/js/review-candidates-panel.js`

- [x] Render clickable rows with `data-*` for meta; fetch preview URL; loading/error in preview strip.
- [x] Refresh clears selection.

### Task 5: Wire tests & docs

**Files:**

- Modify: `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts`
- Modify: `docs/api/ko/api-reference.md`, `docs/api/en/api-reference.md`, `README.md`, `README.en.md`

- [x] Static asset string expectations.
- [x] API reference + README table row.

### Task 6: Verification

- [x] `npx vitest run` on touched specs.
- [x] `npm run build` (workspace) before merge.
