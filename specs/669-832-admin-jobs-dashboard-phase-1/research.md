# Research: 669-832 Admin Jobs Dashboard Phase 1

**Date**: 2026-09-06

## Decisions

### R1 — New `GET /admin/batch/stats` (not status rewrite)

- **Choice**: Sibling endpoint; leave `GET /admin/batch/status` body as today.
- **Why**: `SchedulerStatus.lastExecution` / `totalExecutions` / `errorCount` are `Map`s → `JSON.stringify` drops them to `{}`. Rewriting status is a compatibility landmine (Constitution II). Issue text allows either; brainstorm Q1=A.
- **Rejected**: Additive fields on status only — still leaves broken Maps; conflates contracts.

### R2 — Build JSON from `getDetailedStats()` + queue name snapshot

- **Choice**: Call `getBatchScheduler().getDetailedStats()`, serialize Dates → ISO strings, attach `queue: { size, runningCount, runningNames, queuedNames }`, attach per-job `intervalMs` / `enabled` when mappable.
- **Why**: `batch-scheduler-stats.ts` already returns `health` + `jobs[]` with plain numbers/booleans + Date objects.
- **Gap**: `JobQueue` today has `size`, `runningCount`, `isRunning`, `isQueued` but **no** name list getters (`job-queue.ts` ~142–183). Add `getRunningNames(): string[]` and `getQueuedNames(): string[]` (copy arrays; do not expose job closures).

### R3 — `intervalMs` / `enabled` mapping

- **Choice**: For jobs present in `intervals` map → `enabled: true`. `intervalMs` from a name→config field map where known (cleanup→cleanupInterval, …); unknown → `null`.
- **Why**: Issue asks interval/enabled; full reverse map of every recurring specialty schedule is large — null interval is OK if name+stats present.
- **Rejected**: Listing disabled-but-known jobs (e.g. memory_review_candidates when flag false) — nice-to-have, not required for Phase 1 empty/active table.

### R4 — UI pattern

- **Choice**: New `jobs` tab in `dashboard-tabs-panels.js` + panel modules mirroring review-candidates split (shared/render/fetch/boot). Manual Refresh only; fetch on first tab activation OK (still user-driven), **no** `setInterval` / SSE.
- **Embed** existing `GET /admin/batch/run-history?limit=50` in same panel.
- **Disclaimer**: short “process-local / resets on restart (#833)” note.
- **Tests**: `dashboard-jobs-panel.spec.ts` via `node:vm` like `dashboard-review-candidates-panel.spec.ts`.

### R5 — Auth

- Same Admin gate as other `/admin/batch/*` routes (no new auth model).

### R6 — Out of scope confirmed

- POST run whitelist expansion, pause/resume, durable `job_run`, Bull/Temporal.

## Open risks

| Risk | Mitigation |
|------|------------|
| Date/Map leakage in nested `status` field of detailedStats | Omit raw `status` Maps from HTTP body OR convert to plain objects in serializer — prefer **omit** nested status Maps; expose `schedulerRunning` boolean + jobs/health/queue only |
| JobQueue race during snapshot | Copy `queue.map(j => j.name)` and `[...runningJobs]` synchronously |
| Tab script load order | Follow dashboard.html script include pattern for review panel |
