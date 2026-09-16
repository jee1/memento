# 🧠 Memento

<div align="center">
  <img src="static/logo.png" alt="Memento Logo" width="200" height="200">

  [🇰🇷 한국어](README.md) | [🇺🇸 English](README.en.md)

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
</div>

---

LLMs forget everything when a conversation ends — names, decisions, last week's debugging context. That isn't a model limit; it's the absence of **memory infrastructure**.

Memento is that infrastructure. Not a dump of notes, but an **MCP-based memory operating system** where memories are created, classified, reinforced, and forgotten.

Working, episodic, semantic, and procedural memory map to `remember`'s `type`. Useful memories get stronger; stale ones are cleaned up. Similar memories link through vectors; anchors restore critical context in the next session.

Monorepo layout, packages, and build commands live in [AGENTS.md](AGENTS.md).

## Quick start

This project uses **npm** only (`pnpm` / `yarn` are not supported).

Pick **one default path** for your role. Docker, source builds, multi-agent HTTP, and the one-click script are in [INSTALL.en.md](INSTALL.en.md).

### Claude Code → plugin

```
/plugin marketplace add jee1/memento
/plugin install memento@memento
```

The memory DB lives at `${CLAUDE_PLUGIN_DATA}/memory.db` so it survives plugin updates. Confirm the `memento` MCP server is connected in the `/plugin` panel.

### Cursor and other MCP hosts → npx + mcp.json

```bash
npx memento-mcp-server@latest
```

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db"
      }
    }
  }
}
```

Config locations: Cursor uses `.cursor/mcp.json` or `~/.cursor/mcp.json`; Claude Desktop and Claude Code — see [INSTALL.en.md](INSTALL.en.md) and the [Cursor MCP setup guide](docs/guides/en/cursor-mcp-setup.md).

For frequent use, prefer `npm i -g memento-mcp-server`. Official MCP registry name: `io.github.jee1/memento-mcp-server` (`server.json`).

### Ops / self-hosting → INSTALL.en.md

Docker, source builds, HTTP MCP for multi-agent setups, and environment overlays: [INSTALL.en.md](INSTALL.en.md).

## Default tools

22 tools are registered, but `tools/list` advertises only **`recall` · `remember` · `memory_injection` · `feedback`** by default (v1.18+). The other 18 stay registered and callable; they are only withheld from the listing. Set `MEMENTO_TOOLSET=full` to list all of them.

## Usage example

```typescript
await client.callTool({
  name: "remember",
  arguments: {
    content: "I learned about React Hooks. useState manages state; useEffect handles side effects.",
    type: "episodic",
    tags: ["react", "hooks", "javascript"],
    importance: 0.8
  }
});

const results = await client.callTool({
  name: "recall",
  arguments: {
    query: "How do I use React Hooks?",
    limit: 5
  }
});
```

More connection paths (MCP SDK, `@jee1/memento-client`, external-assistant SDK): [docs/README.md](docs/README.md) and [docs/integrations/](docs/integrations/README.md).

## What you get

- **Four memory types**: `working` · `episodic` · `semantic` · `procedural`
- **Hybrid search**: FTS5 + vectors, tag filters
- **Living memory**: reinforcement, forgetting, neighbors, anchors
- **Procedural versions**: `procedural_diff` / `procedural_rollback`
- **Graph and dashboard**: after the HTTP server starts, `/dashboard` is the preferred entry point for the full admin flow; opening `/graph` directly now offers the same `/auth/session` re-auth path for session recovery.

Forgetting TTLs, embeddings, and security settings are not restated as numbers here. [env.example](env.example) is the source of truth.

## HTTP security (admin server)

The **HTTP server splits browser-session and header-based trust**. `/auth/session` starts the cookie-backed browser flow; `/admin` and `/api` require a browser session; `/api/v1/quality`, `/api/v1/maintenance`, `/tools`, and `/mcp` require `Authorization: Bearer` or `X-API-Key`. See [docs/reference/en/security.md](docs/reference/en/security.md).

**HTTP-only (not MCP)**: `restore_anchors`, `migrate_embeddings`, `convert_episodic_to_semantic`, `get_meta_memory_stats` — see [HTTP Management API](docs/api/en/api-reference.md).

### MCP Tools (Core 22)

> **Important**: MCP exposes 22 registered tools; `tools/list` lists four by default (`MEMENTO_TOOLSET=full` for all). Operational admin endpoints stay on the HTTP API.

## Docs

- Docs portal: [docs/README.md](docs/README.md)
- Install: [INSTALL.en.md](INSTALL.en.md) · [INSTALL.md](INSTALL.md)
- Contributors and agents: [AGENTS.md](AGENTS.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
- API: [docs/api/en/api-reference.md](docs/api/en/api-reference.md)
- Security: [docs/reference/en/security.md](docs/reference/en/security.md)

## Roadmap (short)

- **M1 personal (current)**: local SQLite, MCP + HTTP admin API. **Authentication**: Split browser-session and header-based trust model (`/auth/session` cookie flow, `/admin`·`/api` require browser session, `/tools`·`/mcp` require Bearer/API-Key).
- **M2 team (planned)**: shared backend, API keys, Docker
- **M3 org (planned)**: PostgreSQL + pgvector, JWT

## Contributing · license · support

See [CONTRIBUTING.md](CONTRIBUTING.md). License: [MIT](LICENSE).

- Issues: [GitHub Issues](https://github.com/jee1/memento/issues)
- Docs: [docs/README.md](docs/README.md)
