# User Manual

Memento is an MCP (Model Context Protocol) server designed for AI agents to store and retrieve information across conversations and work sessions. An agent can save important decisions, technical knowledge, and in-progress context to Memento, then recover that continuity in later sessions using `recall` or `memory_injection`.

This manual covers everyone from first-time installers to developers integrating programmatically through the HTTP client.

## Getting Started

### Installation

Clone the repository, install dependencies, and build.

```bash
git clone https://github.com/jee1/memento.git
cd memento

npm install

# Create environment file (optional — defaults work out of the box)
cp env.example .env

# Initialize the database
npm run db:init

# Start the MCP stdio server (with hot reload)
npm run dev
```

If you prefer Docker, start the container and verify the server is healthy.

```bash
docker-compose up -d
curl http://localhost:9001/health
```

### Connecting an MCP Client

#### Claude Desktop

Open the Claude Desktop configuration file and add the Memento server entry.

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["path/to/memento/packages/memento-server/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

Restart Claude Desktop after saving the file to activate the Memento MCP tools.

#### Cursor

In Cursor, connect via the **stdio MCP** approach, pointing `command` and `args` at `packages/memento-server/dist/server/index.js`. Do not confuse this with the URL-based MCP configuration.

Run `npm install && npm run build` from the repo root to generate the build output, then configure `.cursor/mcp.json` accordingly. For full examples and troubleshooting, see the [Cursor MCP Setup Guide](./cursor-mcp-setup.md).

If you run the HTTP server separately, clients that support it can also connect via `http://127.0.0.1:<port>/mcp`. The stdio flow is the default recommendation.

## Storing Memories

The simplest way to store information is through the `remember` MCP tool, which any connected MCP client (Claude Desktop, Cursor, etc.) can call directly. When the HTTP server is also running, you can store memories programmatically using the `@memento/client` package.

The HTTP server defaults to `http://localhost:9001` (configurable via `MCP_SERVER_PORT` or `PORT`). Start it with `npm run dev:http` during development.

```typescript
import { MementoClient } from '@memento/client';

const client = new MementoClient({
  serverUrl: 'http://localhost:9001',
});

await client.connect();

// Basic storage
await client.remember({
  content: 'User asked about React Hooks; explained the difference between useState and useEffect.',
});

// With tags and importance
await client.remember({
  content: 'Decided to introduce TypeScript across the project.',
  tags: ['typescript', 'decision', 'project'],
  importance: 0.8,
});

// Specify a memory type
await client.remember({
  content: 'Summary of React Hook usage patterns',
  type: 'semantic',
  tags: ['react', 'hooks', 'programming'],
});
```

The CLI equivalent looks like this:

```bash
memento remember "React Hook usage patterns" --type semantic --tags "react,hooks,programming"
```

For full CLI documentation, see the [Memento CLI for AI Guide](./memento-cli-for-ai.md).

## Understanding Memory Types

Memento distinguishes four memory types that govern storage purpose and automatic expiry.

**Working memory** holds temporary context for the current session. It expires automatically after 48 hours, making it suitable for in-progress bug fixes, scratch notes, or ephemeral task state.

**Episodic memory** records events and experiences — meeting outcomes, task completion notes, project milestones. Memories of this type are deleted after 90 days unless pinned.

**Semantic memory** holds knowledge that should persist indefinitely: technical explanations, architectural guidelines, team conventions. It is never automatically deleted.

**Procedural memory** captures repeatable processes such as deployment steps, configuration procedures, and troubleshooting runbooks. Like semantic memory, it has no automatic expiry.

```bash
# Working memory — short-lived context
memento remember "Bug fix in progress: null check on auth middleware" --type working

# Episodic memory — record an event
memento remember "Decisions made in today's sprint planning" --type episodic --tags "meeting,decision"

# Semantic memory — accumulate knowledge
memento remember "React Hook fundamentals and usage" --type semantic --tags "react,hooks"

# Procedural memory — document a process
memento remember "Docker container deployment steps" --type procedural --tags "docker,deployment"
```

## Searching Memories

When retrieving memories, Memento runs a hybrid search that combines FTS5 full-text search with vector similarity. This means a query does not need to match the exact wording of a stored memory — semantically related content surfaces too.

```typescript
// Basic hybrid search
const result = await client.hybridSearch({
  query: 'React Hook usage',
});

// Shift weight toward vector search for meaning-driven retrieval
const tuned = await client.hybridSearch({
  query: 'TypeScript interfaces',
  vectorWeight: 0.8,
  textWeight: 0.2,
});
```

From the CLI, use the `recall` command.

```bash
# Basic search
memento recall --query "React Hook" --limit 5

# Filter by type and tags
memento recall --query "TypeScript" --type "episodic,semantic" --tags "programming" --limit 10
```

Search results include a `score` (relevance) and `recall_reason` (why the memory was returned), which helps you understand and refine retrieval behavior.

### Configuring Embeddings

Memento defaults to MiniLM embeddings, which work without an API key. For higher-quality semantic search, switch to OpenAI or Gemini embeddings via the `EMBEDDING_PROVIDER` environment variable. Supported values are `tfidf`, `lightweight`, `minilm`, `openai`, and `gemini`.

```bash
# In your .env file
EMBEDDING_PROVIDER=minilm       # Default — no API key needed
# EMBEDDING_PROVIDER=openai     # Higher quality; requires API key
OPENAI_API_KEY=your_key_here
# EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

With semantic embeddings active, a search for "car" can match memories containing "vehicle," and a search for "programming" will surface memories about "coding."

## Managing Memories

### Pinning and Unpinning

To protect a memory from TTL-based deletion, pin it with the `pin` MCP tool or `client.pin(memoryId)`. A pinned memory remains until you explicitly delete it. Use `client.unpin(memoryId)` to remove the pin and restore normal TTL behavior.

### Deleting Memories

Deletion comes in two forms. A soft delete marks the memory as deleted and may be recoverable; a hard delete removes it permanently.

```bash
# Soft delete
memento forget --id mem_xxxxx

# Hard delete — irreversible
memento forget --id mem_xxxxx --hard --confirm true
```

From the client library: `client.forget(memoryId, hard)`.

### Providing Feedback

You can signal whether a recalled memory was useful via the `feedback` MCP tool or `client.feedback(...)`. This information can help tune retrieval quality over time.

## Using Tags

Tags are the primary way to organize and filter memories. A consistent tagging convention pays off when you need to retrieve memories across a large collection.

Suggested tag categories:

- **Language/Technology**: `javascript`, `typescript`, `react`, `docker`
- **Category**: `programming`, `design`, `meeting`, `decision`
- **Status**: `todo`, `in-progress`, `completed`, `blocked`
- **Priority**: `critical`, `important`, `nice-to-have`

For multi-project setups, the simplest isolation strategy is a consistent project tag.

```bash
memento remember "Project A architecture decision" --tags "project-a,architecture,decision"
memento recall --query "architecture" --tags "project-a"
```

## Memory Relationships

You can link memories to one another using the `add_relation` MCP tool. Once memories are connected, `get_relations` lists the connections, and `get_memory_neighbors` retrieves related memories alongside a given starting memory, making it easier to navigate clusters of related knowledge.

See the [Relation Labeling Guide](./relation-labeling-guide.md) for details on relationship types and usage patterns.

## Troubleshooting

### Cannot Connect to the Server

First confirm the server is running. For stdio, test it by running `node packages/memento-server/dist/server/index.js` directly. For HTTP, check `curl http://localhost:9001/health`. The default HTTP port is 9001, configurable via `MCP_SERVER_PORT`.

If the build output is missing, run `npm run build` first. The entry point is `packages/memento-server/dist/server/index.js`.

### No Search Results

Try different keywords or relax your type/tag filters. Verify the memory was actually saved by checking `recall` with a broad query. If the embedding provider was changed between storage and search, semantic similarity scores may differ from expectations.

### Reviewing Logs

During local development, the `npm run dev` terminal shows server output. For database and migration issues, run `npm run db:check-migration`.

For Docker deployments:

```bash
docker-compose logs memento-server
docker-compose ps
```

## FAQ

**Are memories automatically deleted?**

It depends on the type. Working memory expires after 48 hours; episodic memory after 90 days. Semantic and procedural memories are never automatically deleted. Pinned memories are exempt from TTL-based deletion regardless of type.

**How do I keep a memory permanently?**

Pin it with the `pin` MCP tool or `client.pin(memoryId)`. Pinned memories are excluded from automatic expiry.

**How do I improve search accuracy?**

Use specific, contextual queries and attach meaningful tags when storing memories. Submit `feedback` signals after retrieval to help refine results. For the best semantic search quality, use MiniLM or an API-backed embedding provider rather than TF-IDF.

**Where is the database stored?**

The default location is `~/.memento/memory.db`. Override this with the `DB_PATH` environment variable or the `--db-path` flag. Absolute paths are recommended for predictable behavior across different working directories.

## Additional Resources

- [API Reference](../../api/en/api-reference.md)
- [Developer Guide](developer-guide.md)
- [Memento CLI for AI Guide](./memento-cli-for-ai.md)
- [Cursor MCP Setup Guide](./cursor-mcp-setup.md)
- [npx Troubleshooting](../../operations/en/npx-troubleshooting.md)
- [Node.js Version Compatibility](../../operations/en/troubleshooting-node-version.md)
- [GitHub Repository](https://github.com/jee1/memento)
