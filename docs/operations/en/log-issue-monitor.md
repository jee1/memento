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

## Troubleshooting: `Invalid string length`

### Symptoms

The container keeps running under `restart: unless-stopped`, but logs repeat roughly every 30 seconds (`LOG_ISSUE_MONITOR_INTERVAL_SECONDS`):

```text
log-issue-monitor error: Invalid string length
```

The same error is appended to `~/.memento/logs/log-issue-monitor/monitor-errors.jsonl`.

### Cause

- `diagnostics/*.jsonl` and `docker-diagnostics/*.jsonl` grow without rotation
- Each cycle loads entire files into memory, exceeding the Node.js (V8) **maximum string size (~512MB)**
- **Not the same as Docker memory limits (e.g. 1GB)** — OOM would show `Killed` or heap OOM instead

Related epic: [#420](https://github.com/jee1/memento/issues/420)

### Diagnosis

```bash
du -sh ~/.memento/logs/diagnostics/*.jsonl ~/.memento/logs/docker-diagnostics/*.jsonl
tail -3 ~/.memento/logs/log-issue-monitor/monitor-errors.jsonl
```

Files such as `app-runtime.jsonl` in the hundreds of MB match this failure mode.

### Immediate recovery (no code deploy)

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  stop log-issue-monitor

mv ~/.memento/logs/diagnostics/app-runtime.jsonl \
   ~/.memento/logs/diagnostics/app-runtime.jsonl.bak.$(date +%Y%m%d)
touch ~/.memento/logs/diagnostics/app-runtime.jsonl

for f in docker-inspect docker-stats docker-log-size; do
  p=~/.memento/logs/docker-diagnostics/${f}.jsonl
  if [ -f "$p" ] && [ "$(wc -c < "$p")" -gt 50000000 ]; then
    mv "$p" "${p}.bak.$(date +%Y%m%d)"
    touch "$p"
  fi
done

docker compose \
  -f docker-compose.yml \
  -f docker-compose.diagnostics.yml \
  -f docker-compose.issue-monitor.yml \
  start log-issue-monitor
```

Confirm that `monitor-errors.jsonl` stops accumulating `Invalid string length`.

### Long-term fixes

- [#422](https://github.com/jee1/memento/issues/422) — app diagnostics JSONL rotation
- [#423](https://github.com/jee1/memento/issues/423) — Docker diagnostics JSONL rotation
- [#424](https://github.com/jee1/memento/issues/424) — monitor JSONL incremental read (cursor)
- [#425](https://github.com/jee1/memento/issues/425) — streaming read and size guard
