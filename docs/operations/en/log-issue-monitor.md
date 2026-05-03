# Log Issue Monitor Operations Guide

Log Issue Monitor is an opt-in process that periodically scans Memento runtime logs and Docker diagnostics files. It records every detected occurrence locally and creates or updates GitHub Issues for severe or recurring fingerprints.

## Run

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
```

## Local-Only Mode

When `GITHUB_TOKEN` is unset, the monitor does not write to GitHub. It only records state under `${HOME}/.memento/logs/log-issue-monitor`. This is a normal operating mode.

To explicitly disable GitHub sync, set:

```bash
LOG_ISSUE_MONITOR_DRY_RUN=true docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
```

## GitHub Sync

To enable GitHub Issue creation, provide a token with Issues write permission through `GITHUB_TOKEN`.

```bash
GITHUB_TOKEN=... docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  up -d
```

When an open issue already contains the same fingerprint, the monitor updates only its managed body block instead of opening a duplicate issue. The managed block includes occurrence count, first and last seen timestamps, and recent log excerpts.

## Key Settings

| Environment variable | Default | Description |
| --- | --- | --- |
| `GITHUB_REPOSITORY` | `jee1/memento` | Repository where issues are created |
| `LOG_ISSUE_MONITOR_CONTAINER_NAME` | `memento-mcp-server` | Container name for `docker logs` |
| `LOG_ISSUE_MONITOR_INTERVAL_SECONDS` | `30` | Polling interval |
| `LOG_ISSUE_MONITOR_WARN_THRESHOLD` | `3` | Repetition count before warning/anomaly promotion |
| `LOG_ISSUE_MONITOR_WARN_WINDOW_SECONDS` | `600` | Time window for repetition checks |
| `LOG_ISSUE_MONITOR_LABELS` | `bug,needs-triage,memento-log-monitor` | GitHub labels used for create/search |
| `LOG_ISSUE_MONITOR_MAX_EXCERPT_BYTES` | `6000` | Maximum stored/sent excerpt length |

`critical` and `error` events sync immediately. `warn` and `anomaly` events sync only after crossing the threshold within the time window.

## Output Files

- `state.json`: fingerprint counts, last seen timestamps, and GitHub issue numbers
- `occurrences.jsonl`: append-only occurrence history
- `monitor-errors.jsonl`: monitor self-errors

The default output path is `${HOME}/.memento/logs/log-issue-monitor`.

## Security

This overlay mounts the Docker socket, so use it only in trusted operations or diagnostics environments. Excerpts sent to GitHub are masked and length-limited.
