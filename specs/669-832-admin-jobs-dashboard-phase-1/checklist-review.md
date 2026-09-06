# Spec Review: Admin Jobs Dashboard Phase 1 (#832)

**Reviewed**: 2026-09-06  
**Branch**: `feature/feat-admin-jobs-dashboard-phase-1-detailedstats`  
**Spec**: [spec.md](./spec.md) · **Contract**: [contracts/admin-batch-stats.md](./contracts/admin-batch-stats.md)  
**Reviewer**: code-review-specialist (`/speckit.superspec.review`)

## Verdict

### **PASS**

구현이 FR-001~011, SC-001~005, User Story acceptance, brainstorm edge cases, Constitution I–V와 정합합니다. confidence ≥ 80 이슈 없음.

## Findings (confidence ≥ 80 only)

| Severity | Confidence | Location | Issue | Fix |
|----------|------------|----------|-------|-----|
| — | — | — | **No blocking or important findings** | — |

> confidence < 80 후보(보고 생략): `/batch/stats` 전용 401/403 통합 테스트 부재(기존 Admin 게이트 상속), stats/queue 스냅샷 3-call 비원자성(동일 tick 내 drift 가능성).

## FR / SC Checklist

| ID | Status | Evidence |
|----|--------|----------|
| **FR-001** | **met** | `GET /admin/batch/stats` — `admin-batch.routes.ts:76–111` — health + per-job name, intervalMs, enabled, lastExecution (ISO), totalExecutions, errorCount, isRunning |
| **FR-002** | **met** | Response `queue`: size, runningCount, runningNames, queuedNames — `admin-batch.routes.ts:104–109` |
| **FR-003** | **met** | Jobs tab + schedule table + queue summary + embedded run-history — `static/dashboard.html:59,339–393`, `jobs-panel-*.js` |
| **FR-004** | **met** | No `setInterval` / `EventSource` in jobs panel; refresh via button + first tab-open only — `jobs-panel-fetch.js`, `jobs-panel.js`, `dashboard-jobs-panel.spec.ts:57–64` |
| **FR-005** | **met** | `/batch/status` handler unchanged; regression test — `admin.routes.spec.ts:1541–1570` |
| **FR-006** | **met** | Route tests (`admin.routes.spec.ts:1460–1535`) + UI smoke (`dashboard-jobs-panel.spec.ts`) + JobQueue unit tests (`job-queue.spec.ts:207+`) |
| **FR-007** | **met** | 500 body `{ error, message }` only; no path/credential fields added — `admin-batch.routes.ts:112–119` |
| **FR-008** | **met** | New `GET /admin/batch/stats`; status shape unchanged (no health/jobs/queue on status) |
| **FR-009** | **met** | Session-only Jobs tab; fetch on tab init (once) + Refresh button — `dashboard-tabs-init.js:58–62`, `jobs-panel.js:22–30` |
| **FR-010** | **met** | Run-history embedded in panel; process-local / #833 disclaimer — `dashboard.html:345–346,377–379` |
| **FR-011** | **met** | `JobQueue.getRunningNames()` / `getQueuedNames()` — `job-queue.ts:188–197`; wired via `batch-scheduler.ts:445–451` |
| **SC-001** | **met** | Jobs UI renders health, schedule table, queue summary from stats API |
| **SC-002** | **met** | Static proof: jobs panel sources exclude auto poll/SSE — `dashboard-jobs-panel.spec.ts:57–64`; `/admin/batch/stats` referenced only from jobs panel |
| **SC-003** | **met** | `GET /admin/batch/status shape remains unchanged (#832 US4)` green |
| **SC-004** | **met** | Route + UI smoke tests pass (verified 2026-09-06) |
| **SC-005** | **met** | Empty scheduler → `jobs: []`, queue zeros — `admin.routes.spec.ts:1515–1535`; UI empty rows — `jobs-panel-render.js:47–54,99–105` |

## User Story Acceptance

| Story | Scenario | Status | Notes |
|-------|----------|--------|-------|
| **US1** | 1 — schedule fields visible | **met** | Table columns match contract |
| **US1** | 2 — health summary | **met** | `renderHealth` includes runningJobs, queueSize, errorRate, uptime, memoryUsage |
| **US1** | 3 — empty / not started | **met** | Route + UI empty-safe |
| **US2** | 1 — runningCount + names | **met** | Queue section + JobQueue tests |
| **US2** | 2 — size + queued names | **met** | `queuedNames` always returned (may be `[]`) |
| **US2** | 3 — empty queue | **met** | Zeros + empty arrays |
| **US3** | 1 — single-screen flow | **met** | Schedule + queue + history in one panel |
| **US3** | 2 — no auto poll/SSE | **met** | See SC-002 |
| **US3** | 3 — Refresh updates | **met** | `jobs-panel-fetch.js:25–45` |
| **US3** | 4 — failure keeps snapshot | **met** | `dashboard-jobs-panel.spec.ts:189–195` |
| **US4** | 1 — status unchanged | **met** | Regression test |
| **US4** | 2 — run-history / run whitelist | **met** | Handlers untouched; existing tests in suite |

## Brainstorm / Edge Cases

| Edge case | Status | Evidence |
|-----------|--------|----------|
| JSON-safe (no Map/Date) | **met** | Dates → ISO; round-trip test — `admin.routes.spec.ts:1503–1505` |
| 500 safe message, no path leak | **met** | Generic error envelope |
| Large job list scroll | **met** | `.jobs-table-wrap { overflow: auto; max-height: 28rem; }` — `dashboard.css:2111–2117` |
| Unauthenticated rejected | **met** | Same Admin router/auth as other batch routes (inherited) |
| Process-local disclaimer | **met** | `dashboard.html:345–346` |
| Jobs tab placement (after Review) | **met** | Tab order: Review → Jobs → Agent Sessions — `dashboard.html:58–60` |

## Constitution Compliance

| Principle | Status | Notes |
|-----------|--------|-------|
| **I — Test-First** | **PASS** | Route, queue snapshot, UI smoke tests present and green |
| **II — Backward compatibility** | **PASS** | Additive `/batch/stats`; status/run-history/run unchanged |
| **III — Schema/migration** | **N/A** | No DB changes |
| **IV — Quality gates** | **PASS** | `type-check` 0 errors; `lint` 0 errors; focused tests green (2026-09-06) |
| **V — Observability / degradation** | **PASS** | Logger on 500; empty scheduler returns zeros; UI error path preserves prior DOM |

## Contract Compliance (`admin-batch-stats.md`)

| Rule | Status |
|------|--------|
| 200 shape (message, schedulerRunning, health, jobs, queue, timestamp) | **met** |
| No nested Map/Date | **met** |
| `GET /batch/status` unchanged | **met** |
| Empty scheduler safe | **met** |
| 401/403 / 500 patterns | **met** (same as sibling batch routes) |

## Merge Opinion

**승인** — Phase 1 read-mostly 목표·계약·회귀 요구를 충족합니다. 후속(선택): SC-002를 위한 Playwright 60s 네트워크 무활동 테스트는 Phase 2+ 품질 강화로 분리 가능.

## Verification Commands (review run)

```bash
npm test -- packages/memento-server/src/server/dashboard-jobs-panel.spec.ts \
  packages/memento-core/src/infrastructure/scheduler/__tests__/job-queue.spec.ts
npm test -- packages/memento-server/src/server/routes/admin.routes.spec.ts -t "batch/stats|batch/status"
npm run type-check && npm run lint
```
