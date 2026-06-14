#!/usr/bin/env bash
# Prod-only slop-detector gate scan for monorepo packages (#504).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CONFIG="${SLOP_CONFIG:-.slopconfig.yaml}"
if ! command -v slop-detector >/dev/null 2>&1; then
  echo "slop-detector not found. Install: pip install 'ai-slop-detector==3.8.5'" >&2
  exit 1
fi
for pkg in memento-core memento-server memento-client; do
  echo "=== packages/$pkg/src ==="
  slop-detector --project "packages/$pkg/src" --js --gate --config "$CONFIG"
done
