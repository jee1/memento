# Research: Admin Jobs Dashboard Phase 3 (#834)

## Current state (post-Phase 2)

- Durable `job_run` (migration **044**), `JobRunRepository`, schedule append in coordinator `finally`, manual append on `POST /admin/batch/run`.
- `GET /admin/batch/runs` + Jobs UI timeline; ring buffer `/run-history` kept.
- **POST `/admin/batch/run` whitelist**: `cleanup` | `monitoring` | `memory_review_candidates` only (`admin-batch.routes.ts`).
- **`ManualBatchSchedulerJobType`**: 6 names (`cleanup`, `monitoring`, `healthcheck`, `meta_memory_introspection`, `memory_review_candidates`, `anchor_auto_refresh`) — still smaller than `createBatchSchedulerJobRunners` (triple_extraction, log_rotation, telemetry_cleanup, …).
- **`stopBatchSchedulerJob`**: clears any `intervals` Map entry (generic).
- **`restartBatchSchedulerJob`**: only re-schedules cleanup | monitoring | healthcheck | memory_review_candidates; others → “Unknown job type”.
- Many jobs use `intervals.set` directly in `batch-recurring-schedules.ts` (not only `scheduleJob` helper).
- JobQueue: name dedupe + `isRunning`; **no** `enqueuedAt` yet (P3 needs small addition if implemented).
- No `job_run_log`; FileLogger remains process/file-based.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Log store | SQLite `job_run_log` + migration **046** | Q1; queryable by `run_id`; Constitution III |
| Log append hook | **In-execution LogBuffer** → flush after `job_run` append returns `id` | Phase 2 `job_run` is completed-only (started+ended required). Avoid provisional row / schema change. Soft-fail flush (FR-010) |
| Mid-run `run_id` | Buffer lines with `ts/level/message/context`; assign `run_id` at flush | Same as above; UI sees logs after run completes (manual Refresh). Live mid-run streaming = Non-Goal |
| Run now registry | Expand `ManualBatchSchedulerJobType` (or `RegisteredScheduleJobName`) to **all schedule job names** with a **dispatch map** `jobName → runner` derived from `createBatchSchedulerJobRunners` + schedule name aliases | Q2; eliminate growing switch drift vs runners |
| POST body field | Keep **`jobType`** (existing wire) | Constitution II; Q2 “`{ job }`” = conceptual job id; do not rename |
| POST allowlist | Same route; validate against **registered schedule job set** | Intentional widen; document in contract + implement CHANGELOG |
| Dual-run | If `isJobRunning(jobType)` (and/or queue would violate invariant) → **409** before invoke | SC-003; JobQueue dedupe alone is not a clear HTTP signal |
| Pause | `stopJob` / clear interval + record **paused** set; in-flight completes (Q6) | Existing stop semantics; no force-kill |
| Resume | Expand `restartJob` via **schedule-name → schedule\* registry** (same helpers used at startup) | Today only 4 types restartable |
| Pause while Run now | Allowed; schedule stays paused | Spec edge case |
| Resume idempotent | Already active / not paused → **200** success | Spec edge |
| Read-only | Env `ADMIN_JOBS_READ_ONLY` (default false); middleware rejects POST pause/resume/run with **403** | Q4; GETs still allowed |
| Retention | `ON DELETE CASCADE` from `job_run` **or** `deleteExpired` deletes child logs first then parents | FR-011; prefer FK CASCADE + keep deleteExpired on parent |
| Context size | Cap `context_json` length (e.g. 8–16 KiB) truncate + flag; UI collapse | Edge case |
| P3 oldest-age | **Optional**: add `enqueuedAt` on `QueuedJob`; expose `queue.oldestWaitingAgeMs` on stats | Q5; JobQueue lacks timestamp today — only if easy |
| Failed retry | UI-only: Retry → same POST run with `job_name` from failed row | Q3; no replay store |

## Log append design (detail)

1. Coordinator (schedule) and manual run path share a small `JobRunLogSink` / buffer attached to the execution context when logging is desired.
2. Call sites that today use logger for job steps may optionally also `sink.append({ level, message, context })` — **MVP**: append structured lines at start/end/error boundaries in coordinator + known failure paths (not full FileLogger mirror).
3. After successful `JobRunRepository.append` → `JobRunLogRepository.appendMany(runId, buffer)` inside try/catch soft-fail.
4. If `job_run` append fails, drop buffer (warn once) — primary job outcome unchanged.

## pause/resume for all interval jobs (detail)

- **Pause**: `stopBatchSchedulerJob(intervals, name)` already generic; also `pausedJobs.add(name)` so stats can show `enabled: false` / `paused: true` (today stats hardcodes `enabled: true`).
- **Resume**: replace `restartBatchSchedulerJob` switch with a map built alongside `scheduleAllRecurringJobs` / per-job `schedule*` functions (e.g. `RESTART_HANDLERS[name](ctx)`). Jobs gated by config flags (e.g. memory_review_candidates disabled) return false + clear message (existing behavior).
- Jobs never scheduled (config off) are not “paused” — resume may no-op/false.

## Alternatives rejected

| Alternative | Why rejected |
|-------------|--------------|
| New `POST /batch/jobs/:name/run` sibling | Q2: expand same route |
| Rename body to `{ job }` | Breaks existing clients; II |
| Migrate FileLogger into DB | Non-Goal; scope explosion |
| Provisional `job_run` row at start (`running`) | Changes Phase 2 completed-only contract; more UI states |
| Force-cancel in-flight on pause | Q6: schedule stop only |
| Redis / Bull Board | Epic Non-Goal |
| Skip dual-run HTTP 409 (rely on silent queue dedupe) | SC-003 needs observable reject |

## Open questions after research

없음 — Q1–Q6 resolved; log buffer vs provisional row decided here (buffer).
