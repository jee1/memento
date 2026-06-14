# Codex and Claude Code Live Smoke (2026-06-14)

## Environment

- Linux x64, Node.js v24.11.0
- Codex CLI 0.139.0
- Claude Code 2.1.153
- Isolated Memento HTTP server and disposable SQLite database

## Result

- Codex: connect preservation, backup, idempotent reconnect, and lifecycle 5/5 passed.
- Claude Code: connect preservation, backup, idempotent reconnect, and lifecycle 5/5 passed.
- Both adapters remained non-blocking for server-down, authentication-failure, and timeout scenarios.
- `doctor`, `status`, and `demo` passed against the independent live server in human and JSON modes.
- Machine-readable evidence is in `report.json`.

## Operational Detail

Codex requires the user to open `/hooks` and trust the installed Memento handlers after connection. Until that trust review is completed, Codex reports zero active hooks even when configuration is present. The operations guide now documents this diagnosis and recovery step.

## Limits

This verifies the supported local CLI combinations and failure fallback on Linux. It is not a cross-platform certification or a long-duration reliability test.
