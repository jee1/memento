# Case Directive Injection Guide

When you keep agent directives in one file, the file keeps growing. A hook that injects only the head of the file silently drops the rest, and deleting directives brings old mistakes back. Case directive injection stores each directive as a `case` memory and injects only the relevant ones for each prompt. The injected size stays fixed as directives grow.

Korean documentation: [case-directive-injection.md (KO)](../ko/case-directive-injection.md). Design background: [ADR](../../adr/2026-10-25-issue-1486-case-directive-injection.md).

## How it works

1. When the host submits a prompt, the hook runs `memento hook claude-code`, `memento hook codex`, or `memento hook cursor`.
2. The hook recalls memories tagged `case`, using the first 500 characters of the prompt (up to 15 candidates).
3. It skips cases longer than 300 characters and cases already injected in this session. It then takes the rest in rank order, up to 5 cases and 4,500 bytes of case text.
4. If a pinned directives file exists, its text goes first.
5. In `live` mode the hook returns host-shaped stdout. Claude Code and Codex use `hookSpecificOutput.additionalContext`. Cursor (`beforeSubmitPrompt`) uses `additional_context` plus `continue: true`. In `shadow` mode it returns nothing and only writes the log.
6. On Claude Code and Codex `PreCompact`, the hook resets the session's dedup record so directives lost to compaction can be injected again.

If the server is missing or recall takes longer than 1.5 seconds, the output is empty and the log gets one `fallback:true` line. The hook always exits 0 and never blocks the host. All three hosts share the same selection, dedup, and log contract; only the stdout wrapper differs.

The relevance floor is `DIRECTIVE_POLICY.minFinalScore`, initially `0.5`. Only candidates with a finite numeric `final_score` at or above this value are eligible. Missing or invalid scores are excluded. Session deduplication and the 300-character, 5-case, and 4,500-byte limits still apply.

The existing 61 shadow log lines (51 cases) contained no scores, so this initial floor could not be calibrated from their distribution. New logs include `candidates[{id, final_score}]` for all valid candidates, including those below the floor, to support later calibration.

## Requirements

- A running memento HTTP server. The hook finds the port through `server.json`. The default location is `~/.memento/server.json`. Set `MEMENTO_CONFIG_DIR` to the folder if it is elsewhere.
- An API token listed in `MEMENTO_API_TOKENS`. The hook sends `MEMENTO_API_KEY` as `Authorization: Bearer`.
- A globally installed memento CLI. Do not use `npx` in the hook: a cold start takes tens of seconds.

## 1. Store directives as cases

Store each directive as one semantic memory with the `case` tag. Split a directive longer than 300 characters into two memories.

```javascript
remember({
  type: "semantic",
  content: "Merge risk:low PRs after CI passes. Ask the user for medium/high.",
  tags: ["case"]
});
```

Keep the few rules that must always apply (under 1 KB) in a pinned file instead, for example `~/.claude/pinned-directives.md`.

## 2. Register the hook

Set the environment variables in a wrapper script and run the CLI from it. Putting the API key in the `env` block of `settings.json` exposes it to every process Claude Code starts, so read it inside the wrapper.

```bash
#!/usr/bin/env bash
# ~/.claude/hooks/memento-directives.sh  (reuse for Codex/Cursor; change HOST only)
HOST="${1:-claude-code}"   # claude-code | codex | cursor
export MEMENTO_DIRECTIVES=1
export MEMENTO_DIRECTIVES_MODE=shadow
export MEMENTO_DIRECTIVES_PINNED_FILE="$HOME/.claude/pinned-directives.md"
export MEMENTO_API_KEY="<command that reads a token listed in MEMENTO_API_TOKENS>"
exec memento hook "$HOST"
```

If the global install has no `memento` command ([#1492](https://github.com/jee1/memento/issues/1492)), replace the last line with `exec node "$(npm root -g)/memento-mcp-server/dist/cli.js" hook "$HOST"`.

**Claude Code** — register under `UserPromptSubmit` and `PreCompact` in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/memento-directives.sh claude-code", "timeout": 5 }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/memento-directives.sh claude-code", "timeout": 5 }] }
    ]
  }
}
```

**Codex** — register a `memento hook codex` wrapper under `UserPromptSubmit` and `PreCompact` in `~/.codex/hooks.json` (same file `memento connect codex` updates for lifecycle handlers).

**Cursor** — register a `memento hook cursor` wrapper under `beforeSubmitPrompt` in `~/.cursor/hooks.json`. The Cursor path injects directives only; it does not run lifecycle capture.

Claude Code and Codex hooks also run lifecycle capture, so the raw prompt is stored as an observation on the local server. To disable lifecycle capture and keep directive injection only, set `MEMENTO_CAPTURE=0` (#1494).

## 3. Review the shadow log

`shadow` does not change the agent's output. It only records what the hook would have injected. After a few days, read the log.

```bash
jq -c 'select(.inj_id) | {ts, n: (.cases | length), fallback, ids: [.cases[].id]}' \
  ~/.claude/state/directive-log/injections-*.jsonl
```

Check:

- When the agent broke a directive, was that directive in the `cases` of that prompt?
- Do unrelated cases show up often ([#1493](https://github.com/jee1/memento/issues/1493))?
- Is `fallback:true` frequent? If so, check the server and the token.

Each line has `inj_id`, `ts`, `session_id`, `cwd`, `mode`, `prompt_sha1`, `cases[{id, sha1, text}]`, `skipped`, `fallback`, and `context_text`. A reset line is `{session_id, reset: true, ts}`. New injection logs also record `cases[].final_score` and `candidates[{id, final_score}]`. Deduplication still reads older logs without score fields.

## 4. Switch to live

Set `MEMENTO_DIRECTIVES_MODE` to `live` in the wrapper. Each prompt then gets context of this shape:

```text
[inj:<first 8 chars of session>-<epoch ms>-<first 6 hex of prompt sha1>]
<pinned directives>
- <case text>
[cases-in-context: <case ids injected in this session>]
```

Use the `inj_id` to find in the log which directives were in context at that point.

## Environment variables

| Variable | Meaning |
|----------|---------|
| `MEMENTO_DIRECTIVES` | Enabled only when `1` or `true` |
| `MEMENTO_DIRECTIVES_MODE` | `shadow` (default) or `live` |
| `MEMENTO_DIRECTIVES_PINNED_FILE` | Pinned directives file prepended every time (1 KB max) |
| `MEMENTO_DIRECTIVES_LOG_DIR` | Log folder. Default `~/.claude/state/directive-log` |
| `MEMENTO_CONFIG_DIR` | Folder that holds `server.json`. Default `~/.memento` |
| `MEMENTO_API_KEY` | Server API token |

## Limits

- A memento server is required. [#1495](https://github.com/jee1/memento/issues/1495) tracks a markdown-folder backend that needs no server.
- Cursor supports `beforeSubmitPrompt` only. Dedup reset after compaction is available on the Claude Code/Codex `PreCompact` path.
