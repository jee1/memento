# Issue #276 — Review queue SSE + poll fallback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GET /admin/memory/review-candidates/stream` (SSE) with in-process `changed` notifications, and dashboard `EventSource` with **automatic fallback** to existing #255 polling.

**Architecture:** `review-candidates-sse-hub.ts` holds connected `express.Response` clients; `admin.routes` attaches SSE and calls `notifyReviewCandidatesChanged` after mutating routes and `memory_review_candidates` batch. Static panel mirrors anchor-map philosophy: **stream first, poll on failure**.

**Tech Stack:** Express 5, Vitest (`admin.routes.spec`, string regression spec), static IIFE `review-candidates-panel.js`.

---

## Files

| File | Role |
|------|------|
| `packages/memento-server/src/server/review-candidates-sse-hub.ts` | SSE attach, ping, fan-out, test reset |
| `packages/memento-server/src/server/routes/admin.routes.ts` | Route + notify hooks |
| `static/js/review-candidates-panel.js` | `EventSource`, `schedulePollAfterMsUnlessSse`, fallback |
| `packages/memento-server/src/server/routes/admin.routes.spec.ts` | SSE integration tests |
| `packages/memento-server/src/server/dashboard-review-candidates-panel.spec.ts` | Static string checks |
| `docs/api/en/api-reference.md`, `docs/api/ko/api-reference.md` | Admin SSE section |
| `docs/superpowers/specs/2026-05-05-issue-276-review-queue-sse-design.md` | Design record |

---

## Tasks

- [x] Hub module + admin route + notify on review/dismiss/batch
- [x] Client stream + poll coordination + unload cleanup
- [x] Vitest + API docs + design/plan docs
- [x] `npm run test:ci:server` + `npm run lint` + graphify code rebuild

## Verification

```bash
npm test && npm run lint
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```
