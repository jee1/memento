# Manual regression checklist (FR-013)

**Authority**: Full checklist text in-repo (FR-020). Entry point recorded in `plan.md`.  
**When required**: Only for increments that **directly** change recall, hybrid search, or administrative HTTP **runtime behavior or request-handling paths** — see `spec.md` FR-013, FR-026, and `contracts/merge-gates.md`. Otherwise **recommended** only.

**Environment**: Local dev; `DB_PATH` / `.env` per `env.example`. Use non-production data.

---

## A. Automated baseline (run first)

From repository root:

```bash
npm run lint
npm run type-check
npm test
```

---

## B. Memory recall (MCP / agent semantics)

Execute at least one path that exercises **recall** behavior (representative queries, filters, anchors if touched):

- [ ] `npm run test:client` — MCP client scenario (adjust if your environment uses a different driver).
- [ ] If recall ranking/feedback touched: `npm run test:feedback-ranking` (when applicable to your change).

**Pass criteria**: No new failures vs baseline on main; parity with pre-change behavior for covered scenarios.

---

## C. Hybrid search

- [ ] `npm run test:search` — search scenario driver.
- [ ] Optional deep pass if ranking/vector path changed: `npm run test:vector-search` or targeted Vitest under `packages/memento-core/src/domains/search/` (as relevant).

**Pass criteria**: Representative queries return stable results (ranking/retrieval acceptable vs prior behavior).

---

## D. Administrative HTTP

- [ ] `npm run test:http-v2` **or** server tests: `npm run test:server` — use what matches the admin surface you changed.
- [ ] Manual spot-check (if routes/auth refactored): confirm admin endpoints still require expected auth (no accidental open routes).

**Pass criteria**: No unauthorized exposure; admin capabilities behave as before.

---

## E. Sign-off

- [ ] I completed sections **relevant** to my increment (skip N/A sections).
- [ ] PR description links to this checklist or summarizes sections completed.

**Reviewer**: Confirms G2 in `contracts/merge-gates.md` when applicable.

---

*Version: 2026-04-12 — evolve with new scenarios as tooling changes.*
