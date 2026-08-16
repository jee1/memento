# 🧠 Memento

<div align="center">
  <img src="static/logo.png" alt="Memento Logo" width="200" height="200">

  [🇰🇷 한국어](README.md) | [🇺🇸 English](README.en.md)

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
</div>

---

LLMs forget everything when a conversation ends. Names, decisions, the debugging context you built together last week. This isn't a technical limitation — it's the absence of **memory infrastructure**.

Memento is that infrastructure. Not a database that stores memories, but a **MCP-based memory operating system** where memories are created, classified, reinforced, and forgotten.

## Memory Is Not Simple

Decades of psychology and neuroscience have established one thing clearly: human memory is not a single thing.

**Working memory** holds what's being processed right now. It vanishes in seconds, but in those seconds it's the foundation of every decision. **Episodic memory** is the trace of experience — "that afternoon I first learned React Hooks" — memory with time and context attached. **Semantic memory** is knowledge distilled from experience: the understanding that "TypeScript generics work like this," accumulated through hundreds of debugging sessions. And **procedural memory** is the ingrained routine — Docker deployment steps, PR checklists, team coding conventions.

Most LLMs lose all four with every conversation. Memento persists all four — specify `type: working`, `episodic`, `semantic`, or `procedural` in the `remember` call and the right memory structure handles the rest.

## Living Memory

This is not a simple storage layer. Memory in Memento is alive.

Memories that matter get reinforced. Memories that grow stale get cleaned up by the forgetting algorithm. Similar memories connect to each other through vector similarity, forming a graph. Repeated procedures are version-controlled — `procedural_diff` and `procedural_rollback` let you track how a workflow evolves. Critical context gets pinned as an anchor, so the next conversation starts with that context already loaded.

The goal is not to make AI "pretend to remember." It's to make AI an **agent that creates, classifies, reinforces, and forgets** — just like memory actually works.

### 📦 Monorepo Structure

This repository is an **npm workspaces** monorepo. `@memento/core` holds domain logic, the database, and MCP tools; `memento-server` exposes them over stdio and HTTP. Use `@jee1/memento-client` for REST from your apps, `@jee1/memento-assistant` to wire external assistants, and `@memento/agent-integration` for session and provenance contracts — the latter is **internal only** and is not published to npm (it ships bundled inside the server tarball). Experiments live under `apps/`.

Three packages are published to npm: `memento-mcp-server` (the server), `@jee1/memento-client`, and `@jee1/memento-assistant`.

```bash
npm i @jee1/memento-client      # REST client
npm i @jee1/memento-assistant   # auto recall/save SDK for external assistants
```

| Path | Description |
|------|-------------|
| **packages/memento-core** (`@memento/core`) | Domain, infrastructure, and shared library. Entry points: `createMementoCore`, `createToolContext`, `getToolRegistry`, `closeDatabase`. DB init and migration run from the root via `npm run db:init` / `npm run db:migrate`. |
| **packages/memento-server** | MCP/HTTP server built on core. Run via root `npm run dev`, `npm start`, `npm run dev:http`, etc. |
| **packages/memento-client** (`@jee1/memento-client`) | Client library for connecting to the server. |
| **packages/memento-assistant** (`@jee1/memento-assistant`) | SDK for external AI assistants (recall/remember). |
| **packages/memento-agent-integration** (`@memento/agent-integration`) | Agent integration contracts and adapters. Internal only (`private`), not published to npm. |
| **apps/** | Experimental apps (e.g., `experimental-example` uses `@memento/core` in-process). |

For detailed structure, build, and test commands, see [AGENTS.md](AGENTS.md).

## 🚀 Quick Start

> **📦 Package manager**: This project uses **npm**. `pnpm` and `yarn` are not supported.

### One-click Installation (Recommended)
```bash
curl -sSL https://raw.githubusercontent.com/jee1/memento/main/install.sh | bash
```

### npx Method (For Developers)
```bash
# Run immediately (without installation)
npx memento-mcp-server@latest dev

# Auto setup then run
npx memento-mcp-server@latest setup
npx memento-mcp-server@latest start
```

**Repeated use**: Running via npx each time triggers a download. For frequent use, prefer **global install** (`npm i -g memento-mcp-server`) or local install with `./node_modules/.bin/memento`. Mode breakdown: MCP server (`memento-mcp-server` / stdio), HTTP server (`memento-dev`), CLI (`memento` — recall, remember, forget, memory_injection). CLI guide: [docs/guides/ko/memento-cli-for-ai.md](docs/guides/ko/memento-cli-for-ai.md).

### Claude Code Plugin (recommended — zero config)

This repository is itself a plugin marketplace. Installing the plugin registers the MCP server and ships a skill that teaches the `recall` → `remember` loop.

```
/plugin marketplace add jee1/memento
/plugin install memento@memento
```

The memory database lives at `${CLAUDE_PLUGIN_DATA}/memory.db`, so it survives plugin updates. After installing, check the `/plugin` panel to confirm the `memento` MCP server is connected.

### Official MCP Registry

Memento is listed in the official MCP registry as `io.github.jee1/memento-mcp-server`. Registry-aware clients and marketplaces resolve it by that name.

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.jee1/memento-mcp-server"
```

The listing metadata lives in the root [`server.json`](server.json); every stable release publishes it automatically from `release.yml` after the npm publish (pre-releases are not listed).

### Docker Method (For Production)
```bash
docker-compose -f docker-compose.dev.yml up -d   # Development
docker-compose -f docker-compose.prod.yml up -d  # Production
```

### Source Code Method (For Developers)
```bash
git clone https://github.com/jee1/memento.git
cd memento
npm run quick-start
```

For detailed installation methods, see [INSTALL.en.md](INSTALL.en.md).

### HTTP MCP Server for Multi-Agent Deployments

SQLite only allows one writer at a time, even in WAL mode. Multiple AI agents calling `remember`/`forget` in separate processes will hit `SQLITE_BUSY`. The solution: **run a single MCP server process** that owns the database exclusively.

```bash
npm run dev:http                          # Development (hot reload)
npm run build && npm run start:http       # Production
```

With this setup, all agents connect to one HTTP/WebSocket interface, and the SQLite writer stays in a single process.

## 🔗 Use with External AI Assistants

Personal AI assistants like OpenClaw, NanoClaw, and ZeroClaw can use Memento as a shared long-term memory backend. Guide: [docs/integrations/](./docs/integrations/README.md)

Use the `@jee1/memento-assistant` SDK for automatic recall/remember in two lines of code — [SDK quickstart](./docs/integrations/_shared/sdk-quickstart.md)

## 🛠️ Usage

Three ways to connect to Memento:

- **mcp.json config**: Register Memento in MCP host apps like Claude Desktop, Cursor, or Claude Code — no code required
- **MCP protocol** (`@modelcontextprotocol/sdk`): Connect directly from custom agent code
- **HTTP API client** (`@jee1/memento-client`): Call Memento's REST API from TypeScript/JavaScript applications

### mcp.json Config (Claude Desktop · Cursor · Claude Code)

#### stdio mode (single agent)

After `npm run build`:

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["/path/to/memento/packages/memento-server/dist/server/index.js"],
      "env": {
        "DB_PATH": "/absolute/path/to/data/memory.db"
      }
    }
  }
}
```

#### HTTP MCP mode (shared multi-agent server)

```bash
npm run build && npm run start:http   # default port: 9001 (matches env.example and Docker)
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

> **Using npx** (without building from source):
> ```json
> {
>   "mcpServers": {
>     "memento": {
>       "command": "npx",
>       "args": ["memento-mcp-server@latest"],
>       "env": {
>         "DB_PATH": "/absolute/path/to/data/memory.db"
>       }
>     }
>   }
> }
> ```

### MCP Protocol (`@modelcontextprotocol/sdk`)

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const client = new Client({
  name: "memento-client",
  version: "0.1.0"
}, {
  capabilities: { tools: {}, resources: {}, prompts: {} }
});

// stdio connection
await client.connect({
  command: "node",
  args: ["packages/memento-server/dist/server/index.js"]
});

// HTTP MCP connection (shared multi-agent server)
await client.connect({
  transport: {
    type: "http",
    url: "http://127.0.0.1:9001/mcp"
  }
});
```

```typescript
// Store memory
await client.callTool({
  name: "remember",
  arguments: {
    content: "I learned about React Hooks. useState manages state, useEffect handles side effects.",
    type: "episodic",
    tags: ["react", "hooks", "javascript"],
    importance: 0.8
  }
});

// Search memory
const results = await client.callTool({
  name: "recall",
  arguments: {
    query: "What do I need to know about React Hooks?",
    filters: { type: ["episodic", "semantic"], tags: ["react"] },
    limit: 10
  }
});
```

### HTTP API Client (`@jee1/memento-client`)

`@jee1/memento-client` is an **HTTP REST API wrapper**, not an MCP client. Use it to call Memento's `/tools/*` endpoints directly from TypeScript/JavaScript applications.

```typescript
import { MementoClient } from "@jee1/memento-client";

const client = new MementoClient({
  serverUrl: "http://localhost:9001",
  apiKey: "your-api-key"
});

await client.connect();  // health check

const result = await client.remember({
  content: "I learned about React Hooks.",
  type: "episodic",
  tags: ["react", "hooks"],
  importance: 0.8
});

const results = await client.recall(
  "What should I know when first learning React Hooks?",
  { type: ["episodic", "semantic"], tags: ["react"] },
  10
);

await client.pin(result.memory_id);
await client.forget(result.memory_id);
```

## 🧠 Features

### Core Memory Management (MCP Client)

22 tools are registered, but `tools/list` advertises only four by default (v1.18+): `recall`, `remember`, `memory_injection`, `feedback`. Tool definitions occupy the client's context for the whole session, and Memento is a server people leave running — trimming the default listing cuts that from ~5,860 to ~2,954 estimated tokens (49.6%). The other 18 stay registered and callable; they are only withheld from the listing. Set `MEMENTO_TOOLSET=full` to advertise all of them. Operational functions (anchor restore, embedding migration, episodic→semantic conversion, meta stats) remain HTTP API only.

- **Memory storage**: `working`, `episodic`, `semantic`, `procedural` types
- **Memory search**: Hybrid search (FTS5 text + vector)
- **Memory neighbors**: Vector similarity-based automatic recommendation
- **Memory pinning**: Pin/unpin important memories
- **Memory deletion**: Soft/hard deletion
- **Anchor system**: Pin critical memories as anchors for instant context restoration in new conversations

> **Note**: Anchor recovery, embedding migration, Episodic → Semantic conversion, and meta memory statistics are exposed through the HTTP Management API, not MCP tools.

### 🔍 Hybrid Search

Text and semantic (vector) search combined. Even when you don't remember the exact keyword, similar concepts surface.

- **FTS5 text search**: SQLite Full-Text Search
- **Vector search**: sqlite-vec semantic similarity search
- **Hybrid search**: Combined scoring (Consolidation Score weighting)
- **Multi-provider support**: TF-IDF, MiniLM, OpenAI, Gemini with automatic selection
- **Auto fallback**: If a provider fails, automatically switches to the next
- **Tag-based filtering**: Metadata-based search

### 🧹 Forgetting Policy

A memory system is only useful if it also forgets. Memories that only accumulate become noise.

- **Forgetting algorithm**: Score based on recency, usage frequency, and duplication ratio
- **Spaced repetition**: Review scheduling based on importance and usage
- **TTL management**: Type-specific lifespans (working 2d, episodic 30d, semantic 180d, procedural 90d)
- **Auto cleanup**: Automated soft/hard deletion

### 📊 Performance Monitoring (HTTP Management API)

- **Security**: HTTP server splits browser-session and header-based trust. `/auth/session` starts the cookie-backed browser flow; `/admin` and `/api` require a browser session; `/api/v1/quality`, `/api/v1/maintenance`, `/tools`, and `/mcp` require `Authorization: Bearer` or `X-API-Key`. See [docs/reference/en/security.md](docs/reference/en/security.md).

- **Real-time metrics**: Database, search, memory performance monitoring
- **Real-time alerts**: Automatic performance checks every 30 seconds with threshold-based alerts
- **Error logging**: Structured error logging and statistics collection
- **Database optimization**: Automatic index recommendation and creation
- **Cache system**: LRU + TTL based caching
- **Async processing**: Worker pool based parallel processing

### 🔗 Memory Graph View (Browser)

After starting the HTTP server, visualize semantic relationships between memories as an interactive graph. `/dashboard` is the preferred entry point for the full admin flow; opening `/graph` directly now offers the same `/auth/session` re-auth path for session recovery.

```
http://localhost:9001/dashboard
http://localhost:9001/graph
```

![Memento Memory Graph View](docs/graph-screenshot.png)

## 📋 API Reference

### MCP Tools (Core 22)

> **Important**: MCP exposes 22 core memory, relation, and telemetry tools. Operational functions (anchor restore, embedding migration, episodic→semantic conversion, meta memory stats) are HTTP API only.

#### Basic Memory Management (8)
| Tool | Description | Parameters |
|------|-------------|------------|
| `remember` | Store memory | content, type, tags, importance, source, privacy_scope |
| `recall` | Search memory | query, filters, limit |
| `feedback` | helpful/not_helpful feedback on recall results | memory_id, helpful |
| `pin` | Pin memory | memory_id |
| `unpin` | Unpin memory | memory_id |
| `forget` | Delete memory | memory_id, hard |
| `get_memory_neighbors` | Find neighbor memories | memory_id, limit |
| `memory_injection` | Generate context injection prompt | query, token_budget |

#### Anchor System (4)
| Tool | Description | Parameters |
|------|-------------|------------|
| `set_anchor` | Set anchor | memory_id, slot |
| `get_anchor` | Get anchor | slot |
| `search_local` | Search around anchor | slot, query, limit |
| `clear_anchor` | Clear anchor | slot |

#### Procedural Memory (3)
| Tool | Description | Parameters |
|------|-------------|------------|
| `remember_procedure` | Store procedural memory | content, workflow_name, skill_name, steps, etc. |
| `procedural_diff` | Compare procedural memory versions | left_id, right_id |
| `procedural_rollback` | Roll back procedural memory to a previous version | current_id, target_version_id |

#### Relations & Knowledge Graph (4)
| Tool | Description | Parameters |
|------|-------------|------------|
| `extract_triples` | Extract SPO triples from text | content or messages |
| `add_relation` | Add relation between memories | source_id, target_id, relation_type |
| `get_relations` | List relations | memory_id, etc. |
| `remove_relation` | Remove relation | relation_id |

#### Quality & Export (3)
| Tool | Description | Parameters |
|------|-------------|------------|
| `get_introspection_summary` | Low-confidence / high-failure memory summary | — |
| `get_telemetry_summary` | Search and memory quality telemetry | period |
| `export_memories` | Export memories | filters, etc. |

**HTTP-only (not MCP)**: `restore_anchors`, `migrate_embeddings`, `convert_episodic_to_semantic`, `get_meta_memory_stats` — see HTTP Management API below.

### HTTP Management API

> **Important**: The following functions are not exposed via MCP and are only available through the HTTP API.

| Endpoint | Description | Method |
|----------|-------------|--------|
| `/admin/memory/cleanup` | Memory cleanup | POST |
| `/admin/memory/review-candidates` | Memory review candidate queue | GET |
| `/admin/memory/items/:memory_id` | Single memory JSON preview | GET |
| `/admin/memory/review-candidates/:id/review` | Mark review candidate as reviewed | POST |
| `/admin/memory/review-candidates/:id/dismiss` | Dismiss review candidate | POST |
| `/admin/stats/forgetting` | Forgetting statistics | GET |
| `/admin/stats/performance` | Performance statistics | GET |
| `/admin/stats/errors` | Error statistics | GET |
| `/admin/errors/resolve` | Resolve errors | POST |
| `/admin/alerts/performance` | Performance alerts | GET |
| `/admin/database/optimize` | Database optimization | POST |
| `/admin/anchors/restore` | Restore anchors | POST |
| `/admin/embeddings/migrate` | Embedding migration | POST |

**Other HTTP admin**: Batch status/run (`/admin/batch/*`, including `memory_review_candidates`), performance metrics/alerts (`/admin/performance/*`), relation extract/get/visualize (`/admin/relations/*`). See [docs/api/en/api-reference.md](docs/api/en/api-reference.md).

### Resources

| Resource | Description |
|----------|-------------|
| `memory/{id}` | Single memory detail |
| `memory/search?query=...` | Search result cache |

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Runtime environment |
| `PORT` / `MCP_SERVER_PORT` | 9001 (http-server fallback) | HTTP/MCP server port (`env.example` and Docker recommend 9001) |
| `DB_PATH` | ./data/memory.db | Database path |
| `LOG_LEVEL` | info | Log level |
| `OPENAI_API_KEY` | - | OpenAI API key (optional) |
| `GEMINI_API_KEY` | - | Gemini API key (optional) |
| `EMBEDDING_PROVIDER` | minilm | Embedding provider (tfidf, lightweight, minilm, openai, gemini) |
| `CORS_ALLOWED_ORIGINS` | (empty) | CORS allowed origins (comma-separated; empty = no cross-origin) |
| `ENABLE_PII_MASKING` | true | PII masking (see [docs/reference/en/security.md](docs/reference/en/security.md)) |
| `MEMORY_REVIEW_IMPORTANCE_THRESHOLD` | `0.7` | Memory review: minimum importance (0-1) |
| `MEMORY_REVIEW_STALE_DAYS` | `14` | Memory review: minimum stale age in days (integer ≥ 1) |
| `MEMORY_REVIEW_MAX_CANDIDATES` | `50` | Memory review: max candidates (integer ≥ 1) |
| `MEMORY_REVIEW_CANDIDATES_INTERVAL_MS` | `86400000` | `memory_review_candidates` batch interval in ms (minimum `60000`) |
| `MEMORY_REVIEW_CANDIDATE_DUE_DAYS` | `14` | Days added when the batch computes `due_at` (1–366) |

> **Note**: For TTL, LLM/Ollama, search limits, and more, see `env.example`.

### Forgetting Policy Configuration

```bash
FORGET_THRESHOLD=0.6
SOFT_DELETE_THRESHOLD=0.6
HARD_DELETE_THRESHOLD=0.8

TTL_SOFT_WORKING=2
TTL_SOFT_EPISODIC=30
TTL_SOFT_SEMANTIC=180
TTL_SOFT_PROCEDURAL=90
```

## 🧪 Testing

```bash
npm run test

npm run test:client
npm run test:search
npm run test:embedding
npm run test:lightweight-embedding
npm run test:gemini-embedding
npm run test:forgetting
npm run test:performance
npm run test:monitoring
npm run test:error-logging
npm run test:performance-alerts
npm run test:vector-search
npm run test:memory-injection
npm run test:batch-scheduler
npm run test:embedding-benchmark

npm run test -- --watch
npm run test -- --coverage
```

Retrieval quality against public datasets (LongMemEval-S, LoCoMo) runs through the same harness: acquire with `npm run quality:longmemeval:acquire` / `npm run quality:locomo:acquire`, then run `npm run quality:locomo:benchmark`. Raw datasets are never committed, and LoCoMo is **CC BY-NC 4.0 (NonCommercial)**, so its numbers cannot back commercial claims. The procedure and current results live in [benchmark-datasets.md](docs/_work/testing/ko/benchmark-datasets.md); the production search path does not yet beat a plain FTS baseline, so these figures are kept as an internal regression metric rather than published.

## 📚 Developer Guidelines

- **Project structure**: npm workspaces — `packages/memento-core`, `packages/memento-server`, `packages/memento-client`, `apps/*`. See [AGENTS.md](AGENTS.md).
- **Build/test**: `npm run dev`, `npm run build`, `npm run test`, etc.
- **Coding style**: Node.js ≥ 24, TypeScript ES modules, 2-space indentation
- **Testing**: Vitest; colocate `*.spec.ts` under each package `src/`, workspace-level specs under root `tests/`
- **Commit/PR**: Conventional Commits, Korean context included

## 📊 Performance

### Benchmarks
- **Database**: average query time 0.16–0.22ms
- **Search**: 0.78–4.24ms (improved with cache effects)
- **Memory usage**: 11–15MB heap
- **Concurrent connections**: up to 1000

### Embedding Provider Comparison

#### Free Providers (Local Processing)
- **TF-IDF**: 512 dimensions, extremely fast (0.82ms), low memory (4.48MB)
- **MiniLM**: 384 dimensions, balanced performance, multilingual

#### Paid Providers (Cloud API)
- **OpenAI**: 1536 dimensions, highest accuracy
- **Gemini**: 768 dimensions, high performance, multilingual

**Auto selection order**: explicit request → `.env` `EMBEDDING_PROVIDER` → OpenAI(1) → Gemini(2) → MiniLM(3) → TF-IDF(4). Automatic fallback on provider failure.

## 🏗️ Architecture Journey

Memento is designed to grow: from a personal local server, through team collaboration, to an organization-scale memory platform.

**M1: Personal (current)** — the form you can use today. SQLite embedded, FTS5 + sqlite-vec indexes, local execution. **Authentication**: Split browser-session and header-based trust model (`/auth/session` cookie flow, `/admin`·`/api` require browser session, `/tools`·`/mcp` require Bearer/API-Key). 22 registered MCP tools with four listed by default (`MEMENTO_TOOLSET=full` lists all), management functions separated into HTTP API.

**M2: Team (planned)** — SQLite server mode, API Key auth, Docker single container. Multiple teammates share one memory backend.

**M3: Organization (planned)** — PostgreSQL + pgvector, JWT auth, Docker Compose. Hundreds of agents share organizational memory.

## 🤝 Contributing

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Setup
```bash
git clone https://github.com/your-username/memento.git
cd memento
npm install
npm run dev
npm run test
```

## 📄 License

This project is released under the [MIT License](LICENSE). Matches `package.json` `"license": "MIT"`.

## 📞 Support

- Issue Reports: [GitHub Issues](https://github.com/jee1/memento/issues)
- Documentation: [Wiki](https://github.com/jee1/memento/wiki)
- Developer Guide: [docs/guides/en/developer-guide.md](docs/guides/en/developer-guide.md)
- API Reference: [docs/api/en/api-reference.md](docs/api/en/api-reference.md)

## 🙏 Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [OpenAI](https://openai.com/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Express](https://expressjs.com/)
- [Vitest](https://vitest.dev/)
- [TypeScript](https://www.typescriptlang.org/)
