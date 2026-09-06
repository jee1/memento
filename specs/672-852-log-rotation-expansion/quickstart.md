# Quickstart: Expanded log_rotation (#852)

## What changed

`log_rotation` now cleans four families: triple-extraction (age), migration logs (count cap),
docker-diagnostics (total bytes), log-issue-monitor (trim jsonl, keep `state.json`).

## Verify in development

```bash
# Unit tests (temp dirs only)
npm test -- packages/memento-core/src/infrastructure/logging/log-rotation.spec.ts

# Optional: run the job via admin/scheduler in a disposable env with injected roots
```

## Ops notes

- Defaults: migration keep **500**, diagnostics **256 MiB**, monitor jsonl **32 MiB**, TE **30d**.
- Override with `LOG_ROTATION_*` env vars (see `contracts/log-rotation-job.md`).
- Job reports use basenames/family ids only — no absolute `~/.memento` paths.
- Reducing **creation** of migration logs is #851 (out of scope here).

## Manual backlog drain

After deploy, ensure the scheduler runs `log_rotation` once (or use admin Run-now). Existing
surplus migration files and oversized diagnostics shrink on that run.
