# MCP serverUseInstructions guide

When an MCP client (for example Cursor) initializes a server, the server may include an `instructions` field in `InitializeResult`. That string is **serverUseInstructions**: a short usage guide so the AI knows how to work with the server before it reads every tool schema.

## What serverUseInstructions is

In the MCP spec, `InitializeResult.instructions` is an optional string. Clients that receive it can fold it into the system prompt or session context so the model learns server conventions up front.

The difference is practical. With `instructions`, the model starts with explicit patterns—when to recall, when to remember, which types to prefer—instead of inferring everything from tool descriptions alone. Without it, the model must guess usage from names and parameter shapes, which is slower and more error-prone.

## How Memento implements it

Memento uses the Node.js `@modelcontextprotocol/sdk` `Server` class. The constructor accepts `instructions` in its options object; the SDK attaches it to `InitializeResult` on `initialize`.

```typescript
// packages/memento-server/src/server/index.ts
new Server(serverInfo, {
  capabilities,
  instructions: MEMENTO_SERVER_INSTRUCTIONS
})
```

`MEMENTO_SERVER_INSTRUCTIONS` encodes Memento habits: recall or `memory_injection` before work, `remember` after, explicit `type` and tags, and related guidance. Cursor reads this during MCP init and treats it as serverUseInstructions.

## Applying the pattern to other MCP servers

For `@modelcontextprotocol/sdk` servers, add `instructions` to the `Server` constructor options. For other stacks, return `instructions: string` on your `initialize` response.

## How Cursor uses it

Cursor reads `instructions` from the initialize handshake and may surface it in the agent context. Some versions also persist it under `~/.cursor/projects/<project-id>/mcps/<server>/INSTRUCTIONS.md`; behavior varies by Cursor version and settings.

## References

- MCP spec: https://modelcontextprotocol.io/specification/ (`InitializeResult.instructions`)
- Server instructions overview: https://modelcontextprotocol.info/tags/server-instructions/
- Cursor MCP config: `~/.cursor/mcp.json` or project `.cursor/mcp.json` (Settings → Tools & MCP)
- Memento agent rules: [AGENTS.md](../../../AGENTS.md)
