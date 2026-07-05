#!/usr/bin/env bash
# Multi-agent orchestration launcher (#673)
# 단일 Memento HTTP writer + strict owner scope

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

export DB_PATH="${DB_PATH:-$HOME/.memento/memory.db}"
export MEMENTO_OWNER_SCOPE_MODE="${MEMENTO_OWNER_SCOPE_MODE:-strict}"
export MEMENTO_HTTP_DEFAULT_AGENT_ID="${MEMENTO_HTTP_DEFAULT_AGENT_ID:-orchestrator}"
export MEMENTO_HTTP_BIND_HOST="${MEMENTO_HTTP_BIND_HOST:-127.0.0.1}"
export MCP_SERVER_PORT="${MCP_SERVER_PORT:-9001}"
export PORT="${PORT:-$MCP_SERVER_PORT}"

echo "[orchestration] Single-writer template (#673)"
echo "  DB_PATH=$DB_PATH"
echo "  MEMENTO_OWNER_SCOPE_MODE=$MEMENTO_OWNER_SCOPE_MODE"
echo "  Writer: this process only — parallel writers are an anti-pattern."
echo "  Readers: use X-Memento-Agent-Id per agent (see docs/guides/ko/multi-agent-usage.md)"
echo "  Related: GitHub #664"

if [[ ! -f package.json ]]; then
  echo "error: memento root not found at $ROOT" >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run build -w @memento/core
npm run build -w memento-server

exec npm run dev:http -w memento-server
