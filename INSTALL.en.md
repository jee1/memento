# Memento installation guide

<div align="center">
  [🇰🇷 한국어](INSTALL.md) | [🇺🇸 English](INSTALL.en.md)
</div>

Pick **one default path** for your role. Product overview: [README.en.md](README.en.md). Full docs: [docs/README.md](docs/README.md).

This project uses **npm** only.

## Default path by role

### Claude Code → plugin

```
/plugin marketplace add jee1/memento
/plugin install memento@memento
```

This registers the MCP server and ships a `recall` → `remember` skill. The memory DB lives at `${CLAUDE_PLUGIN_DATA}/memory.db` and survives plugin updates. Confirm the `memento` MCP server in the `/plugin` panel.

Four tools are advertised by default: `recall`, `remember`, `memory_injection`, and `feedback`. To list the rest, set `MEMENTO_TOOLSET=full` on the `memento` server `env` in your user or project MCP config. Edits inside the plugin's own `.mcp.json` are lost on update.

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

Config locations:

- Cursor: `.cursor/mcp.json` or `~/.cursor/mcp.json`
- Claude Desktop / Claude Code: see the [Cursor MCP setup guide](docs/guides/en/cursor-mcp-setup.md) (includes host paths)

For frequent use, prefer `npm i -g memento-mcp-server`. With `npm exec`, name the binary: `npm exec -- memento-mcp-server@latest`.

Official MCP registry name: `io.github.jee1/memento-mcp-server` (`server.json`).

### Ops / self-hosting → Docker or source

**Docker (teams / production)**

```bash
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml up -d
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml up -d
```

Use the same `-f` file with `logs -f` / `down`. Project name defaults to `memento`; override with `COMPOSE_PROJECT_NAME`.

**Source (contributors / debugging)**

```bash
git clone https://github.com/jee1/memento.git
cd memento
npm install
npm run build
npm run db:init
npm run db:migrate
npm run quick-start
```

Or run `npm run setup`, then `npm run dev` / `npm run start`.

**One-click script** (fast local bootstrap)

```bash
curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash
```

On Windows PowerShell, download the script and run `bash install.sh`.

### Multi-agent → one HTTP MCP process

SQLite needs a single writer. Run **one** MCP/HTTP server and point every agent at it.

```bash
npm run build && npm run start:http
```

```json
{
  "mcpServers": {
    "memento": {
      "type": "http",
      "url": "http://127.0.0.1:9001/mcp"
    }
  }
}
```

See **Ports** below for which number to use.

## Environment

```bash
cp env.example .env
```

OpenAI and Gemini keys are optional. [env.example](env.example) is the source of truth for variables.

## Ports

HTTP/MCP ports come in two flavors:

- **Code default**: `3000`
- **Local/Docker recommended profile** ([env.example](env.example)): `MCP_SERVER_PORT=9001` / `PORT=9001`

URLs in this guide use the **recommended `9001` profile**. If you run with code defaults, read them as `3000`. On conflict, change `PORT` / `MCP_SERVER_PORT` in `.env`.

Recommended-profile examples:

- MCP (HTTP): `http://localhost:9001/mcp`
- HTTP API: `http://localhost:9001`
- Dashboard: `http://localhost:9001/dashboard`
- Health: `http://localhost:9001/health`

stdio MCP does not use a port.

## Common commands

```bash
npm run dev
npm run start
npm run dev:http
npm run start:http
npm run test
npm run docker:dev
npm run docker:prod
```

## Troubleshooting (short)

- **`npm exec` errors**: pass the binary explicitly (`npm exec -- memento-mcp-server@latest …`) or use `npx`.
- **Node.js**: **≥ 24** per `package.json` engines.
- **SQLite / native modules**: `npm rebuild better-sqlite3 sqlite-vec`, or see [npx troubleshooting](docs/operations/en/) (and the KO guide if needed).
- **DB reset**: `npm run db:init` (delete the DB files first if required).

More ops notes: [docs/operations/](docs/operations/).

## Next steps

1. Confirm the server and MCP connection
2. [User manual](docs/guides/en/user-manual.md)
3. [API reference](docs/api/en/api-reference.md)
4. External assistants: [docs/integrations/](docs/integrations/README.md)

## Support

- Issues: [GitHub Issues](https://github.com/jee1/memento/issues)
- Docs: [docs/README.md](docs/README.md)
