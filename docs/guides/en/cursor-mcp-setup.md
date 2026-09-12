# Cursor MCP Setup Guide

This guide explains how to connect Memento MCP Server in Cursor. Memento usually connects over **stdio MCP**. If you run an HTTP server in Docker, you can also connect by URL.

Pick a path by role:

- **Everyday use (recommended)**: **Method 1 — npx**
- **Contributing / debugging**: **Method 2 — local build**
- **Ops / shared server**: **Method 4 — Docker (HTTP)**

See [INSTALL.en.md](../../../INSTALL.en.md) for install overview and the **Ports** section for code default vs recommended port.

**Requirement:** Node.js **≥ 24** (`package.json` engines).

By default `tools/list` advertises only **`recall` · `remember` · `memory_injection` · `feedback`**. Set `MEMENTO_TOOLSET=full` in `env` to list the rest.

## Method 1: npx (everyday use · recommended)

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db"
      }
    }
  }
}
```

Use an **absolute** `DB_PATH`. A relative path can place the database wherever npx’s working directory happens to be.

Config file: project `.cursor/mcp.json` or `~/.cursor/mcp.json`.

If npx misbehaves, clear the npm cache (`npm cache clean --force`) or switch to Method 2.

## Method 2: Local build (contributing / debugging)

The server entry point is `packages/memento-server/dist/server/index.js`. It is not in Git — build first.

```bash
npm install
npm run build
```

**Windows:**
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["C:\\Users\\username\\git\\memento\\packages\\memento-server\\dist\\server\\index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "C:\\Users\\username\\git\\memento\\data\\memory.db"
      }
    }
  }
}
```

**Linux/macOS:**
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["/home/username/git/memento/packages/memento-server/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "/home/username/git/memento/data/memory.db"
      }
    }
  }
}
```

With `.cursor/mcp.json` in the project root and `cwd` set, relative paths work too.

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["./packages/memento-server/dist/server/index.js"],
      "cwd": "/home/username/git/memento",
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "/home/username/git/memento/data/memory.db"
      }
    }
  }
}
```

## Method 3: Global install

```bash
npm install -g memento-mcp-server
```

```json
{
  "mcpServers": {
    "memento": {
      "command": "memento-mcp-server",
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db"
      }
    }
  }
}
```

## Method 4: Docker (HTTP)

When the container exposes HTTP/SSE, connect with `url` instead of `command`.

Ports:

- **Code default**: `3000`
- **Local/Docker recommended profile** (`env.example`): `9001`

Examples below use the **recommended `9001` profile**. If you run with code defaults, use `3000`.

```bash
docker ps | grep memento
curl http://localhost:9001/health
```

```json
{
  "mcpServers": {
    "memento": {
      "url": "http://localhost:9001/mcp"
    }
  }
}
```

```bash
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml up -d
docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.prod.yml up -d
# same -f file for:
# docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml logs -f
# docker compose -p "${COMPOSE_PROJECT_NAME:-memento}" -f docker/docker-compose.dev.yml down
```

Or use `npm run docker:dev` / `npm run docker:prod`. The container must be running before you reconnect Cursor.

## Troubleshooting

### "Cannot find module '.../dist/server/index.js'"

Build output is missing or stale.

```bash
npm install
npm run build
```

### "Cannot destructure property 'package' of 'node.target' as it is null"

Can happen with npx. Clear the cache and retry.

```bash
npm cache clean --force
node --version  # ≥ 24
npx -y memento-mcp-server@latest
```

If it persists, use Method 2. Details: [npx troubleshooting](../../operations/en/npx-troubleshooting.md).

### Direct execution test

```bash
node packages/memento-server/dist/server/index.js
```

## Environment variables

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db",
        "MEMENTO_TOOLSET": "full",
        "EMBEDDING_PROVIDER": "minilm",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

- **DB_PATH**: Prefer absolute paths. If unset, the server may default under `~/.memento/memory.db`.
- **MEMENTO_TOOLSET**: `core` (default listing of four) or `full` (list all registered tools).
- **OPENAI_API_KEY** / **GEMINI_API_KEY**: When using those embedding providers.
- **EMBEDDING_PROVIDER**: `tfidf`, `lightweight`, `minilm`, `openai`, `gemini` (default `minilm`).

Full list: [env.example](../../../env.example).

## Running from source (development)

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "tsx", "packages/memento-server/src/server/index.ts"],
      "cwd": "/home/username/git/memento",
      "env": {
        "NODE_ENV": "development",
        "DB_PATH": "/home/username/git/memento/data/memory.db",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

## Quick setup summary

1. Confirm Node.js ≥ 24
2. Everyday use: Method 1 (npx) in `.cursor/mcp.json`. Contributing: `npm install && npm run build`, then Method 2
3. Restart Cursor or reconnect MCP
4. Confirm the default four tools (`recall`, `remember`, `memory_injection`, `feedback`). Set `MEMENTO_TOOLSET=full` if you need the rest
