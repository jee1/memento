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

> Legacy: a Bearer `ADMIN_API_KEY` may still work, but it is deprecated. New integrations should use `MEMENTO_API_TOKENS`.

### Legacy NULL-data opt-out

If the DB still has many `owner_id = NULL` rows and HTTP recall must keep **unscoped global search**:

- Short term: `MEMENTO_OWNER_SCOPE_MODE=warn` — when no agent ID is present, warn and keep unscoped recall (if an ID is present, injection still happens)
- Full off: `MEMENTO_OWNER_SCOPE_MODE=off`

In `strict`/`warn`, NULL-owned memories are **not** included in an agent-scoped recall. To keep sharing that data, migrate `owner_id` values or use the opt-out above.

## Setting context.agentId Automatically

HTTP `/tools` reads `X-Memento-Agent-Id` (case-insensitive) or `MEMENTO_HTTP_DEFAULT_AGENT_ID` into `ToolContext.agentId`. MCP stdio keeps whatever the client/adapter sets on `context.agentId` and does not run the owner-scope middleware (isolation is via the `owner_id` parameter only).

For how this ties into HTTP owner scope, see **HTTP owner scope** above.

## Orchestration template (#673)

Reference layout for several reader agents plus a **single writer**:

- [`apps/multi-agent-orchestration/README.md`](../../../apps/multi-agent-orchestration/README.md)
- GitHub [#673](https://github.com/jee1/memento/issues/673) — orchestration template

For owner scope and writer-isolation design, see [#664](https://github.com/jee1/memento/issues/664).

## Backward Compatibility

The `owner_id` feature is fully backward compatible for MCP and older call paths. Existing data keeps `owner_id = NULL`, and code that never passes `owner_id` keeps working as before. Multi-agent isolation activates only when `owner_id` values are used.

> **HTTP note:** The compatibility story above is for MCP / legacy paths. HTTP `/tools/recall` and `/tools/memory_injection` default to `MEMENTO_OWNER_SCOPE_MODE=strict`, so omitting `owner_id` auto-filters by agent ID (or returns 400) and NULL-owned rows may not appear in scoped results. For unscoped recall, use `warn`/`off` or the legacy NULL opt-out section above.
