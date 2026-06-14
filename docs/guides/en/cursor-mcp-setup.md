# Cursor MCP Setup Guide

This guide explains how to connect Memento MCP Server in Cursor. Memento primarily connects via the **stdio MCP** approach, where Cursor spawns a `node` process pointing at the server entry point. If you run Memento in Docker, you can also connect via HTTP URL.

## Before You Start: Build the Project

The Memento server entry point is `packages/memento-server/dist/server/index.js`. This file is not committed to Git, so you must build the project before using the local path method.

```bash
npm install
npm run build
```

A successful build produces `packages/memento-server/dist/server/index.js`. Confirm the path in your Cursor MCP configuration matches this file.

## Method 1: Use a Local Path (Recommended)

This method uses the build output from your locally cloned repository. It is the most reliable approach because it avoids network and npm cache issues.

Add the following to your Cursor settings file or `.cursor/mcp.json`.

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

Replace the paths with your actual project location. On Windows, backslashes must be escaped as `\\`.

If you prefer to keep the configuration inside the project, place `.cursor/mcp.json` in the project root and set `cwd` to make relative paths work.

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

## Method 2: Run Directly with npx

Use `npx` to run the published package without a separate installation step. This is convenient but can fail due to npm cache issues; switch to Method 1 if you run into problems.

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "DB_PATH": "/home/username/memento/data/memory.db"
      }
    }
  }
}
```

Use an absolute path for `DB_PATH`. A relative path can cause the database to be created in an unexpected location depending on the working directory when npx runs.

The `-y` flag auto-accepts the installation prompt; `@latest` always uses the newest published version. To pin a specific version, write `memento-mcp-server@1.0.0`. The package will be downloaded on the first run, so an internet connection is required.

## Method 3: Global Installation

```bash
npm install -g memento-mcp-server
```

After global installation, reference the binary by name in the `command` field.

```json
{
  "mcpServers": {
    "memento": {
      "command": "memento-mcp-server",
      "env": {
        "DB_PATH": "/home/username/memento/data/memory.db"
      }
    }
  }
}
```

## Method 4: Docker (Production / Server Deployment)

When Memento runs as a Docker container, it exposes an HTTP/SSE server. Connect using `url` instead of `command`.

First verify the container is running and responsive.

```bash
docker ps | grep memento
curl http://localhost:9001/health
```

Then add the URL entry to `.cursor/mcp.json` or your global Cursor settings.

```json
{
  "mcpServers": {
    "memento": {
      "url": "http://localhost:9001/mcp"
    }
  }
}
```

If you changed the port, replace `9001` with the value of your `MCP_SERVER_PORT` setting.

Manage the container lifecycle with Docker Compose.

```bash
# Start
docker compose up -d

# Tail logs
docker compose logs -f

# Stop
docker compose down
```

The container must be running before you restart Cursor or reconnect the MCP server. If the container is stopped, the MCP tools will be unavailable.

## Troubleshooting

### "Cannot find module '.../dist/server/index.js'"

The build output is missing or stale. Run the following from the project root, then restart Cursor.

```bash
npm install
npm run build
```

You can confirm the file exists with:

```bash
# Linux/macOS
ls -la packages/memento-server/dist/server/index.js

# Windows
dir packages\memento-server\dist\server\index.js
```

### "Cannot destructure property 'package' of 'node.target' as it is null"

This npm internal error can occur when running `npx -y memento-mcp-server@latest`. Clear the npm cache and retry.

```bash
npm cache clean --force
node --version  # Must be 20.0.0 or higher
npx -y memento-mcp-server@latest
```

If the issue persists, switch to Method 1 (local path).

### Direct Execution Test

To verify the server itself works independently of Cursor configuration, run the entry point directly.

```bash
node packages/memento-server/dist/server/index.js
```

If the process starts without error, the MCP server is functional.

### Check Node.js Version

```bash
node --version  # Should be 20.0.0 or higher
```

## Environment Variable Reference

Add environment variables to the `env` section of your configuration to enable optional features.

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["/home/username/git/memento/packages/memento-server/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_PATH": "/home/username/git/memento/data/memory.db",
        "OPENAI_API_KEY": "your-key-here",
        "GEMINI_API_KEY": "your-key-here",
        "EMBEDDING_PROVIDER": "minilm",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

Key environment variables:

- **DB_PATH**: Path to the SQLite database file. Absolute paths are strongly recommended. Defaults to `~/.memento/memory.db`.
- **NODE_ENV**: Runtime mode (`development` or `production`).
- **OPENAI_API_KEY**: Required when using OpenAI embeddings.
- **GEMINI_API_KEY**: Required when using Gemini embeddings.
- **EMBEDDING_PROVIDER**: Embedding provider to use (`tfidf`, `lightweight`, `minilm`, `openai`, `gemini`). Defaults to `minilm`.
- **LOG_LEVEL**: Logging verbosity (`debug`, `info`, `warn`, `error`).

## Running from Source (Development)

If you want to run the TypeScript source directly without building first, use `tsx`.

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

## Quick Setup Summary

1. Clone the repository and run `npm install && npm run build`.
2. Add the Method 1 JSON snippet to `.cursor/mcp.json`, updating the paths for your system.
3. Restart Cursor or reconnect the MCP server.
4. Verify that Memento tools (`remember`, `recall`, etc.) appear in the tool list.
