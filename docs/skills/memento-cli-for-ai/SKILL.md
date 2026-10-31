---
name: memento-cli
description: >
  Use when the agent runs Memento through the shell (`memento recall`, `memento remember`,
  `memory_injection`) instead of MCP tools — terminal-only agents, Codex CLI, scripts, or
  when MCP is unavailable. Triggers include "memento CLI", "recall/remember from terminal",
  "기억 조회/저장 CLI", "Memento shell workflow".
---

# Memento CLI workflow

This skill implements the same before/after memory loop as [AGENTS.md](../../../AGENTS.md) and
[agent-workflow.md](../../../docs/agents/agent-workflow.md), but through the **`memento` CLI**
(thin HTTP client). Full command reference: [memento-cli-for-ai.md](../../../docs/guides/ko/memento-cli-for-ai.md).

MCP hosts should prefer the **`memento-memory-loop`** skill (`plugins/memento/skills/memento-memory-loop/`)
when MCP tools are connected.

## Prerequisites

1. A **running Memento HTTP server** (`npm run dev` with `MEMENTO_HTTP_SIDECAR=1`, or `npm run dev:http`).
2. **`MEMENTO_API_KEY`** in the shell, matching a `secret` in the server's `MEMENTO_API_TOKENS`.
3. Port discovery via `~/.memento/server.json` (or `--config-dir`).

Tool subcommands do **not** open SQLite directly. `--db-path` on `recall`/`remember` is deprecated.

Invoke from the repo or after global install:

```bash
npm exec -- memento <command> ...
# or: memento <command> ...
```

## Before the work

Prefer a **natural-language sentence** in `--query`, not keyword bags.

```bash
memento recall --query "How did we fix JWT expiry in this repo?" --type episodic --limit 5

memento memory_injection --query "deployment checklist for this project" --token_budget 1000
```

- Pass **`--type`** on `recall` when filtering (`working` | `episodic` | `semantic` | `procedural`). Server validation matches MCP.
- Diagnostic probes: `--auto-set-anchor false` on `recall` so stats and anchor slots are not polluted.

There is **no CLI subcommand for `feedback`**. Use MCP `feedback` when available; otherwise skip (ranking signal is lost).

## After the work

Pick the type by what the information *is*:

| Type | Use for |
|------|---------|
| `working` | in-flight session state (48h) |
| `episodic` | completed work, incidents, decisions |
| `semantic` | durable knowledge, user preferences |
| `procedural` | repeatable multi-step procedures |

```bash
memento remember \
  --content "Release 2.3.5 shipped; registry publish runs after GitHub Release." \
  --type episodic \
  --tags completed,release \
  --importance 0.8
```

Do not paste source into `--content`. Record paths, symbol names, signatures, and settled constants only.

Save `semantic` and `procedural` only when the problem recurs, the note is a decision reason or reusable procedure, and the next agent will search for it. Search first (`recall`). To update an existing row by id, use MCP `remember` with `memory_id` and `update_mode` (the CLI `remember` subcommand does not expose those flags yet).

## Anchors and extended tools

`set_anchor`, `get_anchor`, and most admin tools are **MCP-only** (or HTTP admin), not CLI subcommands. Use MCP with `MEMENTO_TOOLSET=full` when you need them.

## Output contract

- **Success**: JSON on **stdout**, exit code **0**. Parse stdout; do not scrape stderr.
- **Failure**: message on **stderr**, non-zero exit. If the server is down, stderr tells you to start `npm run dev` or `npm run dev:http`.

## Ops commands (no memory loop)

| Command | Role |
|---------|------|
| `doctor` | endpoint, auth, schema checks |
| `status` | recent capture/injection summary |
| `demo` | two-session injection E2E |
| `review-queue cleanup` | SQLite-only review queue (supports `--db-path`) |
| `agent ask` | one-turn Q&A over memories (uses `LLM_PROVIDER`; counts toward LLM budget) |

Run `memento --help` for the current subcommand list (verified against the installed package).
