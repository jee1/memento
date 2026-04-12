# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Memento is an MCP (Model Context Protocol) server that provides persistent long-term memory for AI agents, modeling human memory structures: working (48h TTL), episodic (90d TTL), semantic (∞), and procedural (∞).

## Commands

```bash
# Setup (one-time)
npm install
npm run db:init       # Initialize SQLite schema
npm run db:migrate    # Run pending migrations

# Development
npm run dev           # MCP server (watch mode)
npm run dev:http      # HTTP server (watch mode)

# Build
npm run build         # Full build: core → server → client

# Quality gates (all must pass before commit)
npm run lint
npm run type-check
npm test

# Single test file
npx vitest run packages/memento-core/src/domains/search/algorithms/vector-search-engine.spec.ts

# Scenario tests
npm run test:search
npm run test:forgetting
npm run test:performance

# Database
npm run db:migrate -w @memento/core
npm run db:check-migration
```

## Architecture

### Monorepo (npm workspaces — use npm, not pnpm/yarn)

```
packages/
├── memento-core (@memento/core)   — all domain logic, DB, services (library)
├── memento-server                 — MCP stdio + HTTP server (consumes core)
└── memento-client (@memento/client) — client library for connecting to server
apps/
└── experimental-example           — in-process usage demo
```

### Package Internals (memento-core)

```
src/domains/
├── memory/      — remember, recall, pin/unpin, forget
├── search/      — hybrid search (FTS5 + vector), ranking
├── embedding/   — multi-provider: TF-IDF → MiniLM → OpenAI → Gemini (fallback)
├── forgetting/  — TTL policies, soft/hard delete
├── anchor/      — context anchors (slots A/B/C) for scoped search
├── relation/    — memory link extraction and visualization
├── monitoring/  — perf stats, error logging, alerts
└── procedural/  — procedural memory with versioning

src/infrastructure/
├── database/    — SQLite init/migrate, better-sqlite3, FTS5 + sqlite-vec
└── ...          — caching (LRU+TTL), batch scheduler, logger

src/shared/      — shared interfaces and types across domains
```

### Key Entry Points

| File | Purpose |
|------|---------|
| `packages/memento-core/src/index.ts` | Library exports: `createMementoCore`, `createToolContext`, `getToolRegistry`, `closeDatabase` |
| `packages/memento-core/src/bootstrap.ts` | Service initialization (wires all services with DB singleton) |
| `packages/memento-server/src/server/index.ts` | MCP stdio server |
| `packages/memento-server/src/server/http-server.ts` | HTTP + admin API |
| `packages/memento-server/src/cli.ts` | CLI entry point |

### MCP Tools vs HTTP Admin API

**MCP tools (17, exposed to AI agents):** `remember`, `recall`, `feedback`, `forget`, `pin`, `unpin`, `memory_injection`, `get_memory_neighbors`, `set_anchor`, `get_anchor`, `search_local`, `clear_anchor`, `procedural_diff`, `procedural_rollback`, `remember_procedure`, `get_introspection_summary`, `get_telemetry_summary`

**HTTP-only admin endpoints** (never exposed via MCP): `/admin/memory/cleanup`, `/admin/stats/*`, `/admin/embeddings/migrate`, `/admin/anchors/restore`, `/admin/database/optimize`, `/admin/errors/*`

### Search Ranking Formula

기본 가중치는 `config/ranking-weights.toml`과 동일하게 둔다.

```
S = α·relevance + β·recency + γ·importance + δ·usage + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5) − ε·duplication_penalty
    (α=0.45,   β=0.20,    γ=0.20,       δ=0.10,   ζ=0.15,  ζ_fb=0.05,                      ε=0.10)

`feedback_norm` ∈ [0,1]는 net helpfulness의 시그모이드 정규화값이며, 기본·중립(0.5)이면 피드백 항이 0이 되어 랭킹을 바꾸지 않는다(FR-003).
```

## Testing

- **Unit tests** (`.spec.ts`): co-located with source files
- **E2E / scenario tests** (`test-*.ts`): `src/test/` directory
- **Integration fixtures**: root `tests/` directory
- CI skips DB/integration tests via `SKIP_DB_TESTS=true`, `SKIP_INTEGRATION_TESTS=true`

## Environment

Copy `env.example` → `.env`. Key variables:

```bash
DB_PATH=./data/memory.db
EMBEDDING_PROVIDER=minilm   # tfidf | lightweight | minilm | openai | gemini
MEMENTO_HTTP_BIND_HOST=127.0.0.1   # loopback only by default
```

## Code Style

- 2-space indent, trailing commas, single quotes
- `kebab-case` filenames, `PascalCase` classes, `camelCase` functions
- Conventional commits: `feat:`, `fix:`, `chore:` — Korean context in body is fine
- Run `npm run lint -- --fix` before committing
- Never commit `data/` or `dist/` contents
- **의존성 방향**: `shared` ← `domains` ← `infrastructure` 순서를 유지한다.
  패키지 간 의존은 `@memento/core` ← `memento-server` 방향만 허용한다.
  역방향 의존(core가 server를 참조하는 등)은 금지한다.

## Memento MCP Usage (within this repo)

Before starting work: query with `recall` or `memory_injection` for relevant prior context.
After completing work: store results — `episodic` for completed tasks, `semantic` for reusable knowledge, `procedural` for repeatable workflows.

## Active Technologies
- TypeScript (Node.js ≥ 20), ES modules + better-sqlite3, vitest (002-fix-mcp-monitoring-overhead)
- SQLite (better-sqlite3) — 스키마 변경 없음 (002-fix-mcp-monitoring-overhead)
- TypeScript (Node.js ≥ 20), ES modules + better-sqlite3, zod, vitest (003-recall-sentence-query)
- N/A (DB 스키마 변경 없음) (003-recall-sentence-query)
- TypeScript (Node.js ≥ 20), ES modules + better-sqlite3, vitest, zod (기존 의존성 신규 추가 없음) (004-recall-quality-feedback-loop)
- SQLite (better-sqlite3) — `feedback_event` 확장: SQL 참고 `005`~`008`, TS 마이그레이션 `021`~`024` (004-recall-quality-feedback-loop)
- TypeScript (Node.js ≥ 20), ES modules + better-sqlite3, zod, vitest (기존 의존성, 신규 추가 없음) (005-sleep-consolidation)
- SQLite (better-sqlite3) — `memory_item.is_consolidated`: TS 마이그레이션 `025-memory-item-is-consolidated.ts` + `schema.sql` 동기화 (005-sleep-consolidation)
- SQLite (better-sqlite3) — `telemetry_events` (027), `telemetry_daily_metrics` (028) 테이블 추가 (006-observability-telemetry)
- TypeScript (Node.js ≥ 20), ES modules + better-sqlite3, @memento/core (TelemetryService, BaseTool) (007-telemetry-cli-mcp)
- 기존 SQLite — 읽기 전용 (신규 마이그레이션 없음) (007-telemetry-cli-mcp)
- TypeScript 5.x (Node.js 20+), ES modules + Express 5.x, better-sqlite3 (기존), D3.js v7 (CDN, 프론트엔드 전용) (009-memory-graph-view)
- SQLite (`memory_relation`, `kg_triple`, `memory_item` 테이블 — 읽기 전용, 스키마 변경 없음) (009-memory-graph-view)
- TypeScript 5.x (Node.js 20+), ES modules + Express 5.x, better-sqlite3, @memento/core (010-fix-docker-api-sync)
- SQLite (better-sqlite3) — 스키마 변경 없음 (읽기 전용 쿼리 추가) (010-fix-docker-api-sync)
- TypeScript 5.x, Node.js 20+, ES modules + Express 5.x, helmet.js v8+, cors, better-sqlite3 (011-docker-security-hardening)
- TypeScript 5.x, Node.js ≥ 20, ES modules + Express 5.x (기존), `umap-js` (신규 추가), D3.js v7 (CDN, 프론트엔드 전용) (014-embedding-map-dashboard)
- SQLite / better-sqlite3 — 기존 `memory_item` + `memory_embedding` 테이블 읽기 전용. 스키마 변경 없음. (014-embedding-map-dashboard)

## Recent Changes
- 005-sleep-consolidation: 에피소딕→시맨틱 오프라인 증류(`SleepConsolidationService`), `is_consolidated`+마이그레이션 `025`, 배치(`SLEEP_CONSOLIDATION_INTERVAL_MS`), `POST /admin/consolidation/run`
- 002-fix-mcp-monitoring-overhead: Added TypeScript (Node.js ≥ 20), ES modules + better-sqlite3, vitest

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
