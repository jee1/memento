# Memento Architecture

## Why Memento

AI agents are stateless by default. When a conversation ends, everything that happened inside it disappears. Memento fills that gap. It models human memory — working memory, episodic memory, semantic memory, and procedural memory — so agents can accumulate experience across sessions.

The interface is MCP (Model Context Protocol). An agent calls tools like `remember`, `recall`, or `forget`, and Memento handles the rest.

---

## Package Structure

The root is an npm workspaces monorepo. Dependencies flow in one direction:

```
memento-core  ←  memento-server
              ←  memento-client
              ←  memento-assistant
              ←  memento-agent-integration
```

**`packages/memento-core` (`@memento/core`)**
All domain logic, database access, services, schedulers, and MCP tools live here. Every other package is a shell that consumes this library.

**`packages/memento-server`**
Exposes `@memento/core` as two server types:
- **MCP server** (`cli.ts`): the endpoint AI agents connect to. Supports stdio, SSE, and Streamable HTTP transports.
- **HTTP admin server** (`http-server.ts`): dashboard, batch manual triggers, agent session management, operational APIs.

**`packages/memento-client` (`@memento/client`)**
Client library for connecting to the server remotely.

**`packages/memento-assistant`**
Integration package for external assistants (OpenClaw/NanoClaw family).

**`packages/memento-agent-integration`**
Contract and runtime for agents that embed Memento in-process.

---

## The Journey of a Memory

Trace what happens when the `remember` tool is called:

1. **Receive**: The MCP server (stdio or HTTP) receives a JSON-RPC request and routes it through `tools.routes.ts`.
2. **Execute**: `executeTool('remember', params, context)` → `RememberTool.execute()`. Telemetry context is automatically set from `owner_id`/`agent_id`.
3. **Immediate write**: A record is inserted into `memory_item` and the **response is returned immediately**. No downstream processing is awaited.
4. **Queue job**: If the memory is episodic, `BatchScheduler.addJob()` registers a triple-extraction job in the queue.
5. **Background refinement**: A batch worker later extracts Subject–Predicate–Object triples and updates the relation graph.

This "write immediately, refine later" pattern is the heart of Memento's **async augmentation pipeline**. Agents get fast responses; enrichment converges in the background.

---

## Domain Structure

Domains under `memento-core/src/domains/` are vertically isolated. Each owns its services, repositories, and tools.

### memory

The CRUD home for memories. Tools `remember`, `recall`, `pin`, `unpin`, `forget`, and `feedback` operate here.

Four memory types, with different TTLs:

| Type | TTL | Purpose |
|------|-----|---------|
| `working` | 48 hours | Current task context, transient info |
| `episodic` | 90 days | Past conversations and events |
| `semantic` | Indefinite | Knowledge, facts, rules |
| `procedural` | Indefinite | Repeatable workflows |

As episodic memories accumulate, triple extraction and sleep consolidation distill them into semantic memories. Deletion follows a soft-delete (`is_deleted = true`) then hard-delete cycle.

### search

Hybrid search engine. FTS5 text search and vector search run in parallel; their scores are merged and ranked.

**Ranking formula** (`config/ranking-weights.toml`):
```
S = α·relevance + β·recency + γ·importance + δ·usage
  + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5)
  + θ·process_attribute_fit − ε·duplication_penalty
```
Weights: α=0.45, β=0.20, γ=0.20, δ=0.10, ζ=0.15, ζ_fb=0.05, θ=0.10, ε=0.10.

The `relevance` slot combines vector similarity (0.4), BM25 score (0.3), tag matching (0.2), and title hit (0.1). MMR (Maximal Marginal Relevance) then ensures result diversity.

### embedding

Multiple embedding providers are supported. `EmbeddingProviderFactory` selects the appropriate provider based on environment configuration:

| Provider | Notes |
|----------|-------|
| **TF-IDF** | Local, no external API. Default. |
| **MiniLM** | Lightweight local model. |
| **OpenAI** (`text-embedding-3-small`) | Requires API key, 1536 dimensions. |
| **Gemini** | Google Gemini embeddings. |

Embeddings are stored in the `memory_embedding` table and indexed by sqlite-vec for approximate nearest-neighbor (ANN) search.

### forgetting

`ForgettingPolicyService` cleans up expired memories. The forget score uses an exponential decay function over age, importance, and usage frequency. Pinned memories are excluded from deletion. `BatchScheduler` runs cleanup every 24 hours.

### anchor

Three-slot context anchors (A/B/C). Pin a memory to a slot, and `search_local` searches the relation graph around that anchor — narrowing recall to what's contextually relevant right now.

Anchors persist in the database and are automatically restored after server restart. Each agent can have an independent anchor map via `owner_id`.

### relation

Manages relationships between memories at two levels:
- **`memory_link` table**: explicit typed relationships (`cause_of`, `derived_from`, `duplicates`, `contradicts`, `version_of`).
- **Triple extraction**: `ExtractTriplesTool` extracts Subject–Predicate–Object triples from episodic memories and stores them as semantic `memory_item` records. Triggered asynchronously on save; `TripleExtractionBatchJob` handles batch processing.

`triple_extracted_status` tracks processing state and enables retry on failure.

### procedural

Versioned procedural memory. Multiple versions of the same workflow share a `version_series_id`. Use `remember_procedure` to save a new version, `procedural_diff` to compare versions, and `procedural_rollback` to revert.

### consolidation

The **Sleep Consolidation** service distills episodic memories into semantic ones. `SleepConsolidationService` runs every hour, condensing key facts from episodic records into semantic memory — named after the human mechanism by which short-term memories consolidate into long-term ones during sleep.

### monitoring

Three monitoring layers:

- **`ErrorLoggingService`**: structured error logging with LOW/MEDIUM/HIGH/CRITICAL severity and categories (DATABASE, NETWORK, VALIDATION, etc.).
- **`PerformanceAlertService`**: generates alerts when response time, memory usage, error rate, or throughput exceed thresholds. Alerts are written to JSONL files and the console.
- **`FailureDetector` + `ReflexionWorker`**: detect repeated failure patterns; `MetaMemoryIntrospectionService` identifies low-confidence memories to support self-correction.

### telemetry

Tracks tool calls and memory access patterns. `TelemetryService` isolates context per `owner_id`/`agent_id` to provide per-agent usage statistics. Queryable via the `get_telemetry_summary` tool or the HTTP admin API.

---

## MCP Tools

The 18 tools exposed to agents:

| Tool | Category | Description |
|------|----------|-------------|
| `remember` | memory | Save a memory |
| `recall` | memory | Retrieve memories via hybrid search |
| `forget` | memory | Delete a memory (soft or hard) |
| `pin` / `unpin` | memory | Pin/unpin a memory |
| `feedback` | memory | Report memory usefulness |
| `memory_injection` | memory | Generate a prompt that injects memories into context |
| `get_memory_neighbors` | memory | Explore neighboring memories |
| `set_anchor` / `get_anchor` / `clear_anchor` | anchor | Set/get/clear context anchors |
| `search_local` | anchor | Search around a context anchor |
| `remember_procedure` | procedural | Save a versioned procedural memory |
| `procedural_diff` / `procedural_rollback` | procedural | Compare versions / roll back |
| `extract_triples` | relation | Manually extract triples from an episodic memory |
| `get_introspection_summary` | meta | Summarize memory quality introspection |
| `get_telemetry_summary` | telemetry | Retrieve agent usage statistics |

---

## BatchScheduler and the Background Pipeline

`BatchScheduler` manages these recurring jobs. Each job has its own timeout and retry policy. All jobs can be triggered manually via the HTTP admin API (`/admin/batch/run`).

| Job | Default Interval | Role |
|-----|-----------------|------|
| `triple_extraction` | 1 hour | Extract triples from unprocessed episodic memories |
| `sleep_consolidation` | 1 hour | Distill episodic → semantic memories |
| `consolidation_score_incremental` | 1 hour | Incremental consolidation score update |
| `consolidation_score_full_sweep` | 24 hours (3 AM) | Full consolidation score recalculation |
| `quality_measurement` | 24 hours | Measure memory quality metrics |
| `forgetting_cleanup` | 24 hours | Delete TTL-expired memories |
| `memory_review_candidates` | 24 hours | Refresh spaced-repetition review queue |
| `meta_memory_introspection` | 6 hours | Identify low-confidence memories |
| `relation_validation` | 7 days (Sun 2 AM) | Validate relation graph integrity |
| `log_rotation` | 24 hours | Rotate log files |
| `telemetry_cleanup` | 24 hours | Purge old telemetry data |

Triple extraction works in two phases: `remember` registers a per-item job immediately; the hourly batch sweep catches any stragglers in batches of 10. Failed items are marked `triple_extracted_status = 'failed'` and retried in the next batch.

---

## Database

Memento currently uses **SQLite (better-sqlite3)** as its sole storage. WAL mode provides concurrent read performance. `WalCheckpointScheduler` periodically checkpoints the WAL file; `DatabaseLockMonitor` watches for lock contention.

Key tables:

| Table | Purpose |
|-------|---------|
| `memory_item` | All memories — type, content, importance, tags, embeddings metadata, triple fields, version fields |
| `memory_tag` / `memory_item_tag` | N:N tag relationship |
| `memory_link` | Explicit typed relationships between memories |
| `memory_embedding` | Vector embeddings (sqlite-vec ANN) |
| `memory_item_fts` | FTS5 full-text search index (virtual table) |
| `anchor` | Persisted context anchors (migration 004) |
| `meta_memory_stats` | Per-memory recall success/failure statistics |
| `telemetry_events` / `telemetry_daily_metrics` | Telemetry data (migration 027–028) |
| `memory_review_candidate` | Spaced-repetition review queue (migration 033) |
| `kg_triple` | Deduplicated Knowledge Graph triples extracted from episodic memories (migration 018) |

Schema changes are managed by numbered migration scripts in `packages/memento-core/src/infrastructure/database/database/migration/migrations/`. The canonical DDL source is `schema.sql`.

PostgreSQL, Redis, and Kubernetes-based multi-tenant scaling are not yet implemented. They are on the future roadmap.

---

## Service Initialization Order

When the server starts, `initializeServices(db)` initializes services in this order:

1. **Search + embedding**: `HybridSearchEngine`, `MemoryEmbeddingService`, `ForgettingPolicyService`, `DatabaseOptimizer`
2. **Monitoring**: `ErrorLoggingService`, `PerformanceAlertService`
3. **Anchor stack**: `VectorSearchEngine`, `AnchorManager`
4. **Failure detection**: `FailureDetector`, `ReflexionWorker`
5. **Monitoring schedulers**: `PerformanceMonitor`, `WalCheckpointScheduler`, `DatabaseLockMonitor`, `RuntimeDiagnosticsLogger`
6. **Meta + consolidation**: `WriteCoalescingManager`, `ConsolidationScoreService`, `MetaMemoryService`
7. **Batch pipeline**: `BatchScheduler`, `TelemetryService`, `RelationGraph`, `SleepConsolidationService`, `IntrospectionScanCache`
8. **Runtime diagnostics sampler**: bootstrap event recording

The MCP server begins accepting requests only after all services are ready.

---

Related docs:
- [Async Augmentation Pipeline](./async-augmentation-pipeline.md)
- [Database Design](./database-design.md) (stub — see [Korean version](../ko/database-design.md))
- [Database ERD](../ko/database-erd.md)
