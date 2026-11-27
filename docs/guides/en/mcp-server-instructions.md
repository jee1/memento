# MCP serverUseInstructions guide

When an MCP client (for example Cursor) initializes a server, the server may include an `instructions` field in `InitializeResult`. That string is **serverUseInstructions**: a short usage guide so the AI knows how to work with the server before it reads every tool schema.

## What serverUseInstructions is

In the MCP spec, `InitializeResult.instructions` is an optional string. Clients that receive it can fold it into the system prompt or session context so the model learns server conventions up front.

The difference is practical. With `instructions`, the model starts with explicit patterns—when to recall, when to remember, which types to prefer—instead of inferring everything from tool descriptions alone. Without it, the model must guess usage from names and parameter shapes, which is slower and more error-prone.

## How Memento implements it

The text is a single constant, `MEMENTO_SERVER_INSTRUCTIONS` in `packages/memento-server/src/server/mcp-instructions.ts`. All three connection paths send the same value.

| Path | Where it is sent |
|---|---|
| stdio | `InitializeResult` (earlier revisions), `server/discover` (2026-07-28) |
| HTTP `/mcp`, earlier revisions | `initialize` response |
| HTTP `/mcp`, 2026-07-28 | `server/discover` response |

It says to call `memory_injection` or `recall` before work, `remember` after, and `feedback` on memories you used, plus the core of the save format. A test caps it at 1,000 characters. The paste-in block in `README.en.md` must carry the same text, and a test compares them.

## Applying the pattern to other MCP servers

For `@modelcontextprotocol/sdk` servers, add `instructions` to the `Server` constructor options. For other stacks, return `instructions: string` on your `initialize` response.

## What clients do (documentation checked 2026-11-28)

The client decides whether `instructions` reaches the model. Claude Code documentation and Gemini CLI source say it does, and Codex documentation says it is read (keep the first 512 characters self-contained). Cursor documentation does not describe it. For a client that does not pass it on, paste the README block into your project instructions.

## References

- MCP spec: https://modelcontextprotocol.io/specification/ (`InitializeResult.instructions`)
- Server instructions overview: https://modelcontextprotocol.info/tags/server-instructions/
- Cursor MCP config: `~/.cursor/mcp.json` or project `.cursor/mcp.json` (Settings → Tools & MCP)
- Paste-in block: [README.en.md](../../../README.en.md)
