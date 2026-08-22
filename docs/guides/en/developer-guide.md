# Developer Guide

Memento is an intelligent memory management MCP server for AI agents. This guide walks a new contributor through setting up a development environment, understanding the codebase, and contributing effectively.

## Prerequisites

Memento requires Node.js 24.0.0 or higher and npm 10.0.0 or higher. These version requirements exist because the project uses TypeScript ES modules and modern runtime features that do not work on older versions. VS Code is recommended as the editor, and it works best with the ESLint, Prettier, Vitest, and GitLens extensions installed.

## Environment Setup

Clone the repository and run `npm install` from the root. npm workspaces will install all package dependencies in a single pass. Then prepare the environment variable file.

```bash
git clone https://github.com/your-org/memento.git
cd memento
npm install
cp env.example .env
```

Open `.env`, fill in the required values, and initialize the database.

```bash
npm run db:init      # create SQLite schema
npm run db:migrate   # run pending migrations
```

Start the development server. Use `npm run dev` to bring up the MCP stdio server, or `npm run dev:http` to also run the HTTP management server. Both commands watch for source changes and restart automatically.

## Project Structure

The repository is an npm workspaces monorepo. The core layout is as follows.

```
memento/
├── packages/
│   ├── memento-core/       # @memento/core — domains, infrastructure, shared
│   ├── memento-server/     # MCP/HTTP server entry points
│   └── memento-client/     # @jee1/memento-client — HTTP client library
├── apps/
│   └── experimental-example/
├── tests/                  # root integration tests
├── scripts/                # build and migration utilities
├── config/                 # runtime configuration (ranking weights, etc.)
├── env.example             # canonical environment variable reference
└── AGENTS.md               # detailed developer and operations guide
```

The three packages have clearly separated responsibilities. `memento-core` holds all domain logic and infrastructure; `memento-server` consumes it and exposes the MCP protocol and HTTP endpoints; `memento-client` is a library for external processes that need to connect to the server.

## Architecture Principles

Memento follows the "Functional Core, Structured Shell" principle. Domain logic is implemented as pure functions and services inside `memento-core`, and the server layer assembles and exposes them. Dependencies always flow from shared → domains → infrastructure, and reverse dependencies must not be introduced.

### Domain Structure

`packages/memento-core/src/domains/` contains feature-separated domains. Each domain has sub-directories such as `services/`, `tools/`, and `algorithms/`.

| Domain | Responsibility |
|--------|----------------|
| memory/ | store (remember), retrieve (recall), pin, forget, procedural memory |
| search/ | hybrid search (FTS5 + vector) |
| embedding/ | multiple embedding providers (tfidf, minilm, openai, gemini) |
| forgetting/ | TTL policy + spaced repetition |
| anchor/ | A/B/C slot anchor-based context search |
| relation/ | relation extraction (LLM + rule-based) + triple extraction |
| consolidation/ | sleep consolidation (episodic → semantic distillation) |
| telemetry/ | telemetry collection |
| monitoring/ | performance monitoring and quality assurance |
| personal-agent/ | personal knowledge agent CLI |
| agent-integration/ | agent session management, provenance |

### Search Ranking

The final score for recall and hybrid search is computed with the following formula.

```
S = α·relevance + β·recency + γ·importance + δ·usage
    + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5) − ε·duplication_penalty
```

Default weights (α=0.45, β=0.20, γ=0.20, δ=0.10, and so on) are stored in `config/ranking-weights.toml` and can be adjusted through the benchmark-based tuning process described in the search quality tuning guide.

## Build System

Builds must run in core → server → client order. Running `npm run build` from the root guarantees this order automatically. Use the `-w` flag to build individual packages.

```bash
npm run build                    # full build (recommended)
npm run build -w @memento/core   # core only
npm run type-check               # type check without building
npm run lint                     # ESLint check
```

### The no-console Rule

Because the MCP server must emit only JSON-RPC messages to stdout during stdio transport, the project sets the `no-console` ESLint rule to the error level across the entire codebase. All logging must go through the centralized logger at `packages/memento-core/src/shared/utils/logger.ts`. This logger automatically masks PII and, in an MCP context, sends log entries as `notifications/message` frames.

```typescript
// Direct console.log/error use is prohibited.
// Use the logger instead:
import { logger } from '../shared/utils/logger.js';

logger.info('operation complete', { duration: queryTime, resultCount: results.length });
logger.error('operation failed', { error: error.message, operation: 'search' });
```

Exceptions apply only to `packages/memento-server/src/server/index.ts` (MCP protocol compliance), test files (`**/*.spec.ts`), and scripts (`scripts/**`).

## Testing

Tests are Vitest-based and follow the `**/*.spec.ts` pattern. Unit tests are colocated inside each domain under `__tests__/` subdirectories. Scenario and benchmark scripts (`test-*.ts`) live in `packages/memento-core/src/test/` and are run with tsx.

```bash
npm test                     # run all tests (Vitest)
npm run test:ci:core         # core search and memory tests
npm run test -- --coverage   # with coverage
npm run test -- --watch      # watch mode
```

Write tests using the AAA (Arrange-Act-Assert) pattern. Replace external dependencies with mock objects, and keep test fixtures in `tests/fixtures/`.

## Development Workflow

All new features must be developed on a separate branch. Commit messages follow the Conventional Commits format.

```bash
git checkout -b feature/your-feature

# develop
npm run dev

# verify
npm test
npm run lint
npm run type-check

# commit
git commit -m "feat(tools): add new tool"
git push origin feature/your-feature
```

### Commit Types

| Type | Purpose |
|------|---------|
| feat | new feature |
| fix | bug fix |
| docs | documentation change |
| refactor | refactoring |
| test | add or modify tests |
| chore | build or tooling change |

## HTTP Security Checklist

When deploying the HTTP server where it is reachable from outside localhost, verify the following.

| Item | Environment Variable | Description |
|------|---------------------|-------------|
| API authentication | `ADMIN_API_KEY` | Required in production. Used to authenticate `/admin` and `/api` endpoints. |
| Bind address | `MEMENTO_HTTP_BIND_HOST` | Defaults to `127.0.0.1`. If set to a non-loopback address without a key, the server refuses to start. |
| CORS | `CORS_ALLOWED_ORIGINS` | Comma-separated. Empty means cross-origin requests are blocked. |
| Keyless start (not recommended) | `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN` | For local development only. Never use in production. |

See `env.example` and `AGENTS.md` for full details.

## Additional Resources

- `AGENTS.md` — master project guide (architecture, commands, operations)
- `docs/guides/en/migration-system-guide.md` — migration system
- `docs/guides/ko/sdd-workflow.md` — SPECIFY → PLAN → implement workflow
- `docs/guides/ko/environment-variable-governance.md` — environment variable governance
