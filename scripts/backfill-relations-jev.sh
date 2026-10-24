#!/bin/sh
set -eu
CONTAINER_UID="${MEMENTO_CONTAINER_UID:-1001}"
SERVICE="${MEMENTO_COMPOSE_SERVICE:-memento-mcp-server}"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/backfill-relations-jev.mjs"
exec docker compose run --rm --no-deps -T \
  --user "$CONTAINER_UID" \
  -v "$SCRIPT:/app/scripts/backfill-relations-jev.mjs:ro" \
  --entrypoint node \
  "$SERVICE" scripts/backfill-relations-jev.mjs "$@"
