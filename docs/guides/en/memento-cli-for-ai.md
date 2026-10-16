# Memento CLI for AI Guide

Agents interact with Memento memory through CLI subcommands as well as MCP tools.

Korean documentation: [memento-cli-for-ai.md (KO)](../ko/memento-cli-for-ai.md).

## MCP vs CLI Roles

- **MCP**: Host tools for AI agents. MCP hosts (Claude, Cursor, Codex, etc.) call tools over stdio or HTTP to maintain conversation context.
- **CLI**: A lightweight HTTP client that relays memory tool subcommands (`recall`, `remember`, `forget`, `memory_injection`) to a running Memento HTTP server. It also executes ops commands (`doctor`, `status`, `demo`, `connect`, `hook`, `agent ask`, `review-queue cleanup`).

## Workflow

The CLI workflow follows three stages:

1. **Before work**: Run `recall` or `memory_injection` to retrieve relevant context.
2. **During work**: Save key information categorized by type (`episodic`, `semantic`, `procedural`).
3. **After work**: Record completed tasks as `episodic`, reusable knowledge as `semantic`, and repeatable procedures as `procedural`.

## Server Requirement and Setup

Tool subcommands (`recall`, `remember`, `forget`, `memory_injection`) do not open the SQLite database directly. Instead, they make HTTP calls to `/tools/:toolName` on a running Memento server. When the server is not running, the CLI outputs an error message and exits with code 1:

```
Memento server is not running.
Start the server first with npm run dev or npm run dev:http.
```

The server manages the database. Passing `--db-path` or `--env-file` to tool subcommands triggers a deprecation warning.

### 1. Local MCP + CLI Setup (Recommended)

Set `MEMENTO_HTTP_SIDECAR=1` in your MCP server configuration so that the stdio MCP server and HTTP server share a single process and database connection.

The CLI automatically discovers the server port from `~/.memento/server.json` (or `MEMENTO_CONFIG_DIR/server.json`).

HTTP tool calls require Bearer authentication. Set `MEMENTO_API_KEY` in the shell running the CLI to match a token secret defined in `MEMENTO_API_TOKENS`.

MCP client configuration example (`.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest"],
      "env": {
        "MEMENTO_HTTP_SIDECAR": "1",
        "MCP_SERVER_PORT": "0",
        "MEMENTO_API_TOKENS": "[{\"id\":\"local\",\"secret\":\"my-token-secret\",\"scopes\":[\"tools:invoke\"]}]"
      }
    }
  }
}
```

Shell environment variable:

```bash
export MEMENTO_API_KEY="my-token-secret"
```

Use `MCP_SERVER_PORT=0` to avoid port collisions. The allocated port is recorded in `~/.memento/server.json`, which the CLI reads automatically.

### 2. Standalone HTTP Server

When running without an MCP host, start the HTTP server directly:

```bash
npm run dev:http
```

### Invocation Methods

```bash
# From another project directory
npm exec --package memento-mcp-server -- memento <command>

# From a repository with local dependency
npm exec -- memento <command>

# After global installation
memento <command>
```

## Command Reference

All memory tool commands require a running HTTP server.

### recall — Search Memories

Performs hybrid search (FTS5 full-text search + vector search) and returns relevant memories.

```bash
# Basic search
memento recall --query "project decisions" --limit 5

# Filter by type and tags
memento recall --query "deployment" --type procedural --tags docker --limit 10

# Call from another project
npm exec --package memento-mcp-server -- memento recall --query "JWT authentication" --type episodic --limit 5
```

On success, outputs JSON to stdout with exit code 0.

### remember — Store Memories

```bash
memento remember \
  --content "Task complete: finalized API spec" \
  --type episodic \
  --tags "completed,api"

# Specify importance
memento remember \
  --content "Adopted TypeScript decision" \
  --type semantic \
  --tags "decision,typescript" \
  --importance 0.8
```

On success, outputs JSON containing `memory_id` to stdout with exit code 0.

### forget — Delete Memories

```bash
# Soft delete
memento forget --id mem_xxxxx

# Hard delete (irreversible)
memento forget --id mem_xxxxx --hard --confirm true
```

### memory_injection — Prompt Context Injection

Summarizes relevant memories for prompt context injection.

```bash
memento memory_injection \
  --query "security policy" \
  --token_budget 1000
```

### agent ask — Personal Knowledge Agent

Answers questions using stored memories (in-process execution).

```bash
memento agent ask "Summarize the TypeScript decisions made so far"
```

Configure the LLM provider using the `LLM_PROVIDER` environment variable (`openai`, `gemini`, `ollama`, `auto`).

### review-queue cleanup — Batch Cleanup of Review Queue

Inspects and cleans up accumulated pending review candidates directly against the SQLite database without requiring a server. Defaults to dry-run; mutations require both `--execute` and `--yes`.

```bash
# Default DB (~/.memento/memory.db)
memento review-queue cleanup --older-than-days 30 --expire
memento review-queue cleanup --older-than-days 30 --expire --execute --yes

# Specify database path (supported only on this command)
memento review-queue cleanup --db-path /path/to/memory.db --older-than-days 30 --expire
```

See [Review Queue Cleanup](../../operations/en/review-queue-cleanup.md) for operational procedures and options.

## Global Options

```bash
memento --config-dir <dir>    # Configuration directory (overrides ~/.memento, server.json location)
memento --db-path <path>      # Database path for review-queue cleanup only (deprecated for other commands)
memento --env-file <file>     # (deprecated) .env file path
memento --help, -h            # Help text
```

Tool subcommands (`recall`, `remember`, `forget`, `memory_injection`) rely on the server to manage the database and ignore or warn on `--db-path` and `--env-file`.

## Output Rules

- **Success**: Outputs JSON only to stdout. Internal Memento logs (INFO, WARN, DEBUG) are suppressed in CLI mode.
- **Failure**: Outputs error messages to stderr with a non-zero exit code.
