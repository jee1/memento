# Multi-Agent Usage Guide

## Why Agent Ownership Matters

When several AI agents share one Memento instance, they can pollute each other's memories or treat another agent's context as their own. A code-review agent, a docs agent, and a deploy agent on the same DB need separated work contexts.

Memento supports this with the `owner_id` field. Tag a memory with its owning agent when you save it, and filter to that agent when you recall.

## The owner_id Field

`owner_id` is the owner identifier on each memory item. Two states are possible.

`NULL` means no owner. Single-agent setups and older code that saved without `owner_id` land here. Legacy data is all NULL.

A string value marks a specific agent — e.g. `"agent-a"`, `"code-reviewer"`, `"user-1234"`. Choose any stable identifier you like.

## Saving Memories with an Owner (remember / remember_procedure)

Pass `owner_id` to `remember` or `remember_procedure` and that value is stored with the memory:

```json
{
  "content": "This project uses TypeScript strict mode",
  "type": "semantic",
  "owner_id": "code-reviewer"
}
```

If you omit the parameter but the MCP/HTTP layer has set `ToolContext.agentId`, that value is used automatically. If both are missing, `owner_id` is stored as NULL.

## Filtering by Owner on Recall

Pass `owner_id` to `recall` to return only that owner's memories. An array includes several owners at once:

```json
{
  "query": "TypeScript settings",
  "owner_id": "code-reviewer"
}
```

```json
{
  "query": "deployment steps",
  "owner_id": ["deploy-agent", "devops-agent"]
}
```

If you omit `owner_id`, MCP and legacy paths search across all owners. **Only HTTP `/tools/recall` and `/tools/memory_injection`** run the owner-scope middleware. With the default `MEMENTO_OWNER_SCOPE_MODE=strict`, omitting `owner_id` auto-filters by the agent ID from the request header or environment. MCP isolates only through the `owner_id` parameter.

Each result item includes `owner_id` when `include_metadata` is `true`.

## HTTP owner scope (strict / warn / off)

HTTP programmatic APIs (`/tools/*`) can apply owner scope so one agent does not leak another's memories. This middleware applies to **HTTP `/tools` only** (design: GitHub [#664](https://github.com/jee1/memento/issues/664)).

| Environment variable | Value | Behavior |
|----------------------|-------|----------|
| `MEMENTO_OWNER_SCOPE_MODE` | `strict` (default) | If `recall` / `memory_injection` omit `owner_id` and an agent ID is present (`X-Memento-Agent-Id` or `MEMENTO_HTTP_DEFAULT_AGENT_ID`), inject that value as `owner_id`. **If no identifier → 400** |
| | `warn` | If an agent ID is present, inject `owner_id` the same way as `strict`. **Only when no identifier is present**: log a warning and allow legacy (unscoped) recall |
| | `off` | No enforcement (legacy behavior) |

### Passing the agent ID

Identifiers used on HTTP `/tools`:

1. **Request header** (recommended): `X-Memento-Agent-Id: code-reviewer`
2. **Server default**: `MEMENTO_HTTP_DEFAULT_AGENT_ID=code-reviewer` (used only when the header is absent)

Values from the header or env land on `ToolContext.agentId` and, in `strict`/`warn`, are used automatically when recall omits `owner_id`.

> `X-Agent-Id` is for MCP HTTP and audit paths. For `/tools` owner scope, use `X-Memento-Agent-Id` (plus `MEMENTO_HTTP_DEFAULT_AGENT_ID`).

```bash
# Prefer a MEMENTO_API_TOKENS entry with tools:invoke scope
curl -sS -X POST http://127.0.0.1:9001/tools/recall \
  -H "Authorization: Bearer $MEMENTO_API_TOKEN" \
  -H "X-Memento-Agent-Id: code-reviewer" \
  -H "Content-Type: application/json" \
  -d '{"query":"TypeScript settings","type":"semantic"}'
```

> A Bearer `ADMIN_API_KEY` is rejected since v2.0.0 (#1241). Use a token secret from `MEMENTO_API_TOKENS`.

### Binding an agent to a token (#1258)

The header is whatever the client sends, so one `tools:invoke` token can impersonate any agent by changing it. Set `agent_id` on the token entry to prevent that.

```bash
MEMENTO_API_TOKENS='[{"id":"codex","secret":"<hex>","scopes":["tools:invoke"],"agent_id":"codex"}]'
```

- Requests with this token always get `ToolContext.agentId = "codex"`; no header needed
- A different `X-Memento-Agent-Id` / `X-Agent-Id` is rejected with **403** (`AGENT_ID_MISMATCH`)
- An empty or non-string `agent_id` makes the whole token entry ignored
- Tokens without `agent_id` keep the header rules above

The strict recall filter and the audit log use this value. Owner boundaries apply only with this token binding (#1285): tools that take a memory id (`forget`, `pin`, `feedback`, `get_relations`, …) touch only that agent's memories, answer for another owner's memory exactly as for a missing one, and drop other owners' memories from neighbor/relation results. An `owner_id` or `agent_id` argument naming another agent is rejected. An agent set only by header or `MEMENTO_HTTP_DEFAULT_AGENT_ID` gets no such boundary, so set `agent_id` whenever you issue one token per agent.

### Legacy NULL-data opt-out

If the DB still has many `owner_id = NULL` rows and HTTP recall must keep **unscoped global search**:

- Short term: `MEMENTO_OWNER_SCOPE_MODE=warn` — when no agent ID is present, warn and keep unscoped recall (if an ID is present, injection still happens)
- Full off: `MEMENTO_OWNER_SCOPE_MODE=off`

In `strict`/`warn`, NULL-owned memories are **not** included in an agent-scoped recall. To keep sharing that data, migrate `owner_id` values or use the opt-out above.

## Setting context.agentId Automatically

HTTP `/tools` reads `X-Memento-Agent-Id` (case-insensitive) or `MEMENTO_HTTP_DEFAULT_AGENT_ID` into `ToolContext.agentId`. MCP stdio keeps whatever the client/adapter sets on `context.agentId` and does not run the owner-scope middleware (isolation is via the `owner_id` parameter only).

For how this ties into HTTP owner scope, see **HTTP owner scope** above.

## Default project (X-Memento-Project-Id, #1270)

HTTP `/mcp` and `/tools` read the `X-Memento-Project-Id` request header (max 200 characters; blank-only values are ignored) into `ToolContext.projectId`. `remember` uses it as the default `project_id` only on **new saves** when the `project_id` argument is omitted. An explicit `project_id` argument always wins. Updates via `memory_id` or `update_mode` do not apply the header (so existing rows with `project_id` NULL can still be updated). `recall` and `memory_injection` filters are unchanged — without `project_id` they still search all projects. With no header, behavior is unchanged.

Claude Code example (per-repo local scope, not committed):

```bash
claude mcp add --scope local --transport http memento http://localhost:9001/mcp \
  --header "X-API-Key: <key>" --header "X-Memento-Project-Id: memento"
```

Run `memento connect project` inside a repository to write this header to the Claude Code (local scope), Codex (`.codex/config.toml`) and Cursor (`.cursor/mcp.json`) configs at once. The project name comes from `--project-id`, then `MEMENTO_PROJECT_ID`, then the repository folder name. URL and API key are copied from each client's global memento config; a client with no global config is reported as `skipped`. Repo files hold the API key, so they are added to `.git/info/exclude` unless git already ignores them. `--dry-run` writes nothing.

```bash
cd ~/git/my-repo && memento connect project            # project_id = my-repo
memento connect project --project-id memento --dry-run
```

## Project brief (include_project_brief, #1271)

The brief is the reference document an AI reads when it picks up a project from another AI. It is not a separate table: it is a **semantic** memory with a `project_id` and the tag `project-brief` (other types are ignored even with the tag). If a project has several such rows, the one with the latest `created_at` is current.

- **Write**: `remember(type: "semantic", tags: ["project-brief"], project_id: "<project>", content: "<plan, decisions, next steps>")` — `project_id` may be omitted when the header is set
- **Update**: `remember(memory_id, update_mode: "replace", expected_version, project_id, ...)` — returns `memory_version_conflict` (409) if another AI changed it first. Updates ignore the header, so pass `project_id` explicitly
- **Inject**: `memory_injection(include_project_brief: true)` puts the full brief at the top of the result regardless of the query and adds `project_brief: { memory_id, project_id, version, included }`. The brief does not count against `token_budget`. Default (`false`) calls only add a one-line pointer when a brief exists
- The project comes from the `project_id` argument, then `X-Memento-Project-Id`. Search filters are unaffected, and calls with no known project return the same result as before. With `owner_id`, only that owner's brief is used

Injecting the full brief every turn repeats the same document each turn, so use `true` only at session start and right after compaction. Clients with hooks (Claude Code `SessionStart`, Codex `SessionStart`) ask for the `true` call from that hook; clients without hooks rely on the tool description.

## Orchestration template (#673)

Reference layout for several reader agents plus a **single writer**:

- [`apps/multi-agent-orchestration/README.md`](../../../apps/multi-agent-orchestration/README.md)
- GitHub [#673](https://github.com/jee1/memento/issues/673) — orchestration template

For owner scope and writer-isolation design, see [#664](https://github.com/jee1/memento/issues/664).

## Backward Compatibility

The `owner_id` feature is fully backward compatible for MCP and older call paths. Existing data keeps `owner_id = NULL`, and code that never passes `owner_id` keeps working as before. Multi-agent isolation activates only when `owner_id` values are used.

> **HTTP note:** The compatibility story above is for MCP / legacy paths. HTTP `/tools/recall` and `/tools/memory_injection` default to `MEMENTO_OWNER_SCOPE_MODE=strict`, so omitting `owner_id` auto-filters by agent ID (or returns 400) and NULL-owned rows may not appear in scoped results. For unscoped recall, use `warn`/`off` or the legacy NULL opt-out section above.
