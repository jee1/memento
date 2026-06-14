# Multi-Agent Usage Guide

## Why Agent Ownership Matters

When multiple AI agents share a single Memento instance, there is a risk that one agent's memories contaminate another's context, or that an agent retrieves memories that belong to a different workstream. For example, if a code review agent, a documentation agent, and a deployment agent all write to the same database, their working contexts should remain isolated.

Memento handles this through the `owner_id` field. When saving a memory, you can tag it with the owning agent's identifier. When retrieving memories, you can filter to return only those belonging to a specific agent.

## The owner_id Field

Every memory item has an `owner_id` field that identifies its owner. Two states are possible.

`NULL` means no owner is assigned. This applies to single-agent environments and to all memories saved without an explicit owner. All legacy data uses this state.

A string value identifies a specific agent. You can use any string that makes sense for your setup: `"agent-a"`, `"code-reviewer"`, `"user-1234"`, etc.

## Saving Memories with an Owner (remember / remember_procedure)

Pass `owner_id` as a parameter to `remember` or `remember_procedure`, and that value will be stored with the memory:

```json
{
  "content": "This project uses TypeScript strict mode",
  "type": "semantic",
  "owner_id": "code-reviewer"
}
```

If `owner_id` is not passed as a parameter, Memento checks `ToolContext.agentId`. This value can be set at the MCP or HTTP layer from session context or request headers, allowing the server infrastructure to assign ownership automatically without requiring each tool call to carry the parameter explicitly. If neither is present, `owner_id` is stored as NULL.

## Filtering by Owner on Recall

Pass `owner_id` to `recall` to retrieve only memories belonging to a specific agent. You can also pass an array to include memories from multiple agents:

```json
{
  "query": "TypeScript configuration",
  "owner_id": "code-reviewer"
}
```

```json
{
  "query": "deployment procedures",
  "owner_id": ["deploy-agent", "devops-agent"]
}
```

Omitting `owner_id` returns all memories regardless of ownership — the same behavior as before this feature existed.

When `include_metadata` is `true`, each result item includes its `owner_id` field so you can see which agent owns each memory.

## Setting context.agentId Automatically

In HTTP server and MCP client environments, agent identity can be read from session context or request headers and written to `ToolContext.agentId`. This lets the infrastructure assign ownership automatically across all tool calls in a session, without requiring each call to pass `owner_id` explicitly. The specific implementation depends on your server layer and client library setup.

## Backward Compatibility

The `owner_id` feature is fully backward compatible. All existing data retains `owner_id = NULL`. Existing code that does not pass `owner_id` continues to work exactly as before. The multi-agent isolation behavior only activates when `owner_id` values are explicitly used.
