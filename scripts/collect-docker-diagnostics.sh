#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${1:-memento-mcp-server}"
OUT_DIR="${2:-${HOME}/.memento/logs/docker-diagnostics}"
INTERVAL_SECONDS="${DIAGNOSTICS_INTERVAL_SECONDS:-10}"

mkdir -p "$OUT_DIR"

write_json_error() {
  local file="$1"
  local timestamp="$2"
  local message="$3"
  printf '{"timestamp":"%s","container":"%s","error":"%s"}\n' \
    "$timestamp" \
    "$CONTAINER_NAME" \
    "$message" >> "$file"
}

collect_once() {
  local timestamp
  timestamp="$(date -Iseconds)"

  if ! docker stats --no-stream --format '{{json .}}' "$CONTAINER_NAME" >> "$OUT_DIR/docker-stats.jsonl" 2>/dev/null; then
    write_json_error "$OUT_DIR/docker-stats.jsonl" "$timestamp" "docker stats failed"
  fi

  if ! docker inspect --format '{{json .}}' "$CONTAINER_NAME" >> "$OUT_DIR/docker-inspect.jsonl" 2>/dev/null; then
    write_json_error "$OUT_DIR/docker-inspect.jsonl" "$timestamp" "docker inspect failed"
  fi

  {
    printf '\n[%s] docker system df\n' "$timestamp"
    docker system df || true
  } >> "$OUT_DIR/docker-disk.log" 2>&1

  local log_path=""
  log_path="$(docker inspect --format '{{.LogPath}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [[ -n "$log_path" && -f "$log_path" ]]; then
    local log_size_bytes
    log_size_bytes="$(wc -c < "$log_path" | tr -d ' ')"
    printf '{"timestamp":"%s","container":"%s","logPath":"%s","sizeBytes":%s}\n' \
      "$timestamp" \
      "$CONTAINER_NAME" \
      "$log_path" \
      "$log_size_bytes" >> "$OUT_DIR/docker-log-size.jsonl"
  else
    write_json_error "$OUT_DIR/docker-log-size.jsonl" "$timestamp" "log path unavailable"
  fi
}

printf 'Collecting Docker diagnostics for %s every %ss into %s\n' \
  "$CONTAINER_NAME" \
  "$INTERVAL_SECONDS" \
  "$OUT_DIR" >&2

while true; do
  collect_once
  sleep "$INTERVAL_SECONDS"
done
