# API Reference Documentation

## Overview

Memento talks to AI agents through the **Model Context Protocol (MCP)**. Agents read and write memory via **Tools** such as `remember` and `recall`, and can pull single memories or cached search results through **Resources**. This document is the full contract reference in one place.

If you are integrating for the first time, start the server using the [User Manual](../guides/en/user-manual.md) and [Cursor MCP Setup](../guides/en/cursor-mcp-setup.md), then use this page for **call shapes and parameters**. HTTP admin routes (`/admin/*`, `/tools/*`) use a different browser-session and API-key boundary—see [Security](../reference/en/security.md).

## 🔄 Lightweight Hybrid Embedding

When cloud APIs are unavailable or fail, Memento can fall back to **TF-IDF lightweight embeddings** without changing your call sites. The `EmbeddingService` interface stays the same. Lightweight mode uses 512-dimensional vectors, Korean/English stopword handling, and cosine similarity; OpenAI failures trigger a transparent fallback. It is fast and light on memory but closer to keyword search than deep semantic matching.

### Performance Monitoring Tools

#### get_performance_metrics

Retrieves system performance metrics.

**Parameters:**
```typescript
{
  timeRange?: '1h' | '24h' | '7d' | '30d';  // Time range
  includeDetails?: boolean;                  // Include detailed information
}
```

**Response:**
```typescript
{
  success: boolean;
  result: {
    database: {
      totalMemories: number;
      memoryByType: Record<string, number>;
      averageMemorySize: number;
      databaseSize: number;
      queryPerformance: {
        averageQueryTime: number;
        slowQueries: Array<{ query: string; time: number; count: number }>;
      };
    };
    search: {
      totalSearches: number;
      averageSearchTime: number;
      cacheHitRate: number;
      embeddingSearchRate: number;
    };
    memory: {
      usage: number;
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    system: {
      uptime: number;
      cpuUsage: number;
      loadAverage: number[];
    };
  };
}
```

#### get_cache_stats

Retrieves cache system statistics.

**Parameters:**
```typescript
{
  cacheType?: 'search' | 'embedding' | 'all';  // Cache type
}
```

**Response:**
```typescript
{
  success: boolean;
  result: {
    hits: number;
    misses: number;
    totalRequests: number;
    hitRate: number;
    size: number;
    memoryUsage: number;
  };
}
```

#### clear_cache

Initializes cache.

**Parameters:**
```typescript
{
  cacheType?: 'search' | 'embedding' | 'all';  // Cache type
  pattern?: string;                             // Pattern to remove (regex)
}
```

**Response:**
```typescript
{
  success: boolean;
  result: {
    clearedCount: number;                       // Number of removed items
    remainingCount: number;                     // Number of remaining items
  };
}
```

#### optimize_database

Optimizes database performance.

**Parameters:**
```typescript
{
  actions?: ('analyze' | 'index' | 'vacuum' | 'all')[];  // Actions to perform
  autoCreateIndexes?: boolean;                           // Auto create indexes
}
```

**Response:**
```typescript
{
  success: boolean;
  result: {
    analyzedQueries: number;
    createdIndexes: number;
    optimizedTables: number;
    recommendations: Array<{
      type: 'index' | 'query' | 'table';
      priority: 'high' | 'medium' | 'low';
      description: string;
      estimatedImprovement: string;
    }>;
  };
}
```

## MCP Tools (Core 22)

Tools exposed over MCP are what **agents call during a session**: memory, relations, and quality helpers. Operational work—anchor restore, embedding migration, episodic→semantic batch conversion, meta stats—lives on the HTTP [Administrator API](#administrator-api) only. The list below is a category index; parameters and examples follow in each subsection.

### Memory (8)
`remember`, `recall`, `feedback`, `forget`, `pin`, `unpin`, `get_memory_neighbors`, `memory_injection`

### Anchor (4)
`set_anchor`, `get_anchor`, `search_local`, `clear_anchor`

### Procedural (3)
`remember_procedure`, `procedural_diff`, `procedural_rollback`

### Relations (4)
`extract_triples`, `add_relation`, `get_relations`, `remove_relation`

### Quality & export (3)
`get_introspection_summary`, `get_telemetry_summary`, `export_memories`

**HTTP only (not MCP):** `restore_anchors`, `migrate_embeddings`, `convert_episodic_to_semantic`, `get_meta_memory_stats` — see [Administrator API](#administrator-api).

### remember

Stores a new memory. Use `type` to pick working/episodic/semantic/procedural; from v1.18+ omitting `type` is rejected. Embedding and relation extraction may run asynchronously after save.

#### Parameters

```typescript
interface RememberParams {
  content: string;                    // Content to remember (required)
  type?: 'working' | 'episodic' | 'semantic' | 'procedural';  // Memory type (default: 'episodic')
  tags?: string[];                   // Tag array (optional)
  importance?: number;               // Importance (0-1, default: 0.5)
  source?: string;                   // Source (optional)
  privacy_scope?: 'private' | 'team' | 'public';  // Privacy scope (default: 'private')
}
```

#### Response

```typescript
interface RememberResult {
  memory_id: string;                 // Unique ID of created memory
  created_at: string;               // Creation time (ISO 8601)
  type: string;                     // Memory type
  importance: number;               // Importance
}
```

#### Usage Example

```typescript
// Use the workspace package `@memento/client` (see `packages/memento-client`).
import { createMementoClient } from '@memento/client';

const client = createMementoClient();
await client.connect();

// Basic usage
const result = await client.callTool('remember', {
  content: "User asked about React Hooks and I explained the difference between useState and useEffect."
});

// Advanced usage
const result = await client.callTool('remember', {
  content: "Decided to introduce TypeScript in the project.",
  type: 'episodic',
  tags: ['typescript', 'decision', 'project'],
  importance: 0.8,
  source: 'meeting-notes',
  privacy_scope: 'team'
});
```

### recall

Runs hybrid search (FTS5 + vectors) for a natural-language `query`. Narrow layers with `type` or `memory_types`, and combine `owner_id`, `project_id`, tags, and time filters. Often paired with `memory_injection` before agent work.

#### Parameters

```typescript
interface RecallParams {
  query: string;                     // Search query (required)
  filters?: {
    type?: ('episodic' | 'semantic')[];  // Memory type filter
    tags?: string[];                 // Tag filter
    project_id?: string;             // Project ID filter
    time_from?: string;              // Start time (ISO 8601)
    time_to?: string;                // End time (ISO 8601)
  };
  limit?: number;                    // Result limit (default: 8)
}
```

#### Response

```typescript
interface RecallResult {
  items: MemoryItem[];              // List of found memories
  total_count: number;              // Total result count
  query_time: number;               // Search time (ms)
}

interface MemoryItem {
  id: string;                       // Memory ID
  content: string;                  // Memory content
  type: string;                     // Memory type
  importance: number;               // Importance
  created_at: string;               // Creation time
  last_accessed: string;            // Last access time
  pinned: boolean;                  // Pinned status
  score: number;                    // Search score
  recall_reason: string;            // Search reason
  tags?: string[];                  // Tags
}
```

#### Usage Example

```typescript
// Basic search
const result = await client.callTool('recall', {
  query: "React Hook usage"
});

// Filtered search
const result = await client.callTool('recall', {
  query: "TypeScript",
  filters: {
    type: ['episodic', 'semantic'],
    tags: ['javascript', 'programming'],
    time_from: '2024-01-01T00:00:00Z'
  },
  limit: 10
});
```

### feedback

Records whether a memory returned by `recall` was actually helpful. This feeds search ranking and quality telemetry; agents often call it asynchronously right after recall with `helpful: true|false`. You may optionally attach a `score_breakdown` snapshot and comment.

#### Parameters

```typescript
interface FeedbackParams {
  memory_id: string;                // Target memory ID (required)
  helpful: boolean;                 // true=helpful, false=not helpful (required)
  comment?: string;                 // Optional comment (max 4096 chars)
  score?: number;                   // Optional score
  score_breakdown?: object;         // recall item score_breakdown snapshot (JSON, size limit applies)
  session_id?: string;              // Session identifier (optional)
  agent_id?: string;                // Agent identifier (optional)
}
```

#### Usage Example

```typescript
await client.callTool('feedback', {
  memory_id: 'mem_abc123',
  helpful: true,
  comment: 'Matched our previous JWT expiry handling'
});
```

### get_memory_neighbors

When you already have one memory from `recall` and want more in the same vein, this tool walks vector similarity to find neighbors. Tune `similarity_threshold` to cut noise; useful for expanding context before graph hops.

#### Parameters

```typescript
interface GetMemoryNeighborsParams {
  memory_id: string;                  // Memory ID to query (required)
  limit?: number;                     // Maximum number of neighbor memories to return (default: 5, max: 50)
  similarity_threshold?: number;      // Similarity threshold (0.0 ~ 1.0, default: 0.8)
}
```

#### Response

```typescript
interface GetMemoryNeighborsResult {
  memory_id: string;                  // Queried memory ID
  neighbors: NeighborMemory[];        // List of neighbor memories
  total_count: number;                 // Number of returned neighbor memories
  query_time: number;                  // Query execution time (ms)
}

interface NeighborMemory {
  id: string;                         // Neighbor memory ID
  content: string;                    // Neighbor memory content
  type: string;                       // Neighbor memory type
  similarity: number;                 // Similarity score (0.0 ~ 1.0)
  importance?: number;                // Importance
  created_at?: string;                // Creation time
  tags?: string[];                    // Tags
}
```

#### Usage Example

```typescript
// Basic usage (retrieve 5 neighbor memories with similarity >= 0.8)
const result = await client.callTool('get_memory_neighbors', {
  memory_id: 'mem_123'
});

// Advanced usage (retrieve 10 neighbor memories with similarity >= 0.7)
const result = await client.callTool('get_memory_neighbors', {
  memory_id: 'mem_123',
  limit: 10,
  similarity_threshold: 0.7
});

// Use results
result.neighbors.forEach(neighbor => {
  console.log(`Similar memory: ${neighbor.content} (similarity: ${neighbor.similarity})`);
});
```

### pin / unpin

`pin` exempts a memory from forgetting and boosts search rank. `unpin` clears the pin. Both take a single `memory_id`.

#### pin Parameters

```typescript
interface PinParams {
  memory_id: string;                // Memory ID to pin (required)
}
```

#### unpin Parameters

```typescript
interface UnpinParams {
  memory_id: string;                // Memory ID to unpin (required)
}
```

#### Response

```typescript
interface PinResult {
  success: boolean;                 // Success status
  memory_id: string;               // Memory ID
  pinned: boolean;                 // Pinned status
}
```

#### Usage Example

```typescript
// Pin memory
const result = await client.callTool('pin', {
  memory_id: 'memory-123'
});

// Unpin memory
const result = await client.callTool('unpin', {
  memory_id: 'memory-123'
});
```

### forget

Deletes a memory. Default is soft delete (`hard: false`); `hard: true` removes data in a way that is difficult to recover.

#### Parameters

```typescript
interface ForgetParams {
  memory_id: string;                // Memory ID to delete (required)
  hard?: boolean;                   // Hard delete flag (default: false)
}
```

#### Response

```typescript
interface ForgetResult {
  success: boolean;                 // Success status
  memory_id: string;               // Deleted memory ID
  deleted_at: string;              // Deletion time
}
```

#### Usage Example

```typescript
// Soft delete (default)
const result = await client.callTool('forget', {
  memory_id: 'memory-123'
});

// Hard delete
const result = await client.callTool('forget', {
  memory_id: 'memory-123',
  hard: true
});
```

### set_anchor

Pins the "current center" memory to slot A (immediate), B (secondary), or C (extended) during long tasks. With anchors set, `search_local` can search around that point and follow the relation graph.

#### Parameters

```typescript
interface SetAnchorParams {
  memory_id: string;                // Memory ID to set as anchor (required)
  slot: 'A' | 'B' | 'C';          // Anchor slot (required)
  agent_id?: string;               // Agent ID (default: 'default')
}
```

#### Response

```typescript
interface SetAnchorResult {
  success: boolean;                 // Success status
  memory_id: string;               // Memory ID
  slot: string;                    // Anchor slot
  agent_id: string;                // Agent ID
}
```

#### Usage Example

```typescript
// Set anchor in slot A (immediate context)
const result = await client.callTool('set_anchor', {
  memory_id: 'mem_123',
  slot: 'A'
});

// Set anchor in slot B (auxiliary context)
const result = await client.callTool('set_anchor', {
  memory_id: 'mem_456',
  slot: 'B',
  agent_id: 'my-agent'
});
```

### get_anchor

Shows which memories are pinned in slots A/B/C for an agent. Omit `slot` to read all three at once.

#### Parameters

```typescript
interface GetAnchorParams {
  slot?: 'A' | 'B' | 'C';         // Slot to query (optional, returns all if not specified)
  agent_id?: string;               // Agent ID (default: 'default')
}
```

#### Response

```typescript
interface GetAnchorResult {
  agent_id: string;                // Agent ID
  slot?: string;                   // Slot (if specific slot queried)
  anchor?: {                       // Anchor info (if specific slot queried)
    memory_id: string;
    created_at: string;
    updated_at: string;
  };
  anchors?: {                      // All anchors (if no slot specified)
    A: AnchorInfo | null;
    B: AnchorInfo | null;
    C: AnchorInfo | null;
  };
}

interface AnchorInfo {
  memory_id: string;
  created_at: string;
  updated_at: string;
}
```

#### Usage Example

```typescript
// Get specific anchor
const result = await client.callTool('get_anchor', {
  slot: 'A'
});

// Get all anchors
const result = await client.callTool('get_anchor', {});
```

### search_local

Instead of global `recall`, search narrowly from a pinned anchor via hop distance and the relation graph (`use_relations`). Handy when context is long and you only need memories near the current topic.

#### Parameters

```typescript
interface SearchLocalParams {
  slot: 'A' | 'B' | 'C';          // Anchor slot to search around (required)
  query?: string;                  // Search query (optional, returns all nearby if not provided)
  hop_limit?: number;              // Maximum hop distance (1-5, default: slot-specific)
  limit?: number;                  // Maximum results (1-100, default: 10)
  min_results?: number;            // Minimum results (0-100, default: 3)
  agent_id?: string;               // Agent ID (default: 'default')
  use_relations?: boolean;         // Use relation graph (default: true)
}
```

#### Response

```typescript
interface SearchLocalResult {
  slot: string;                    // Anchor slot
  query?: string;                  // Search query
  items: MemoryItem[];            // Found memories
  total_count: number;             // Total result count
  query_time: number;              // Query execution time (ms)
}
```

#### Usage Example

```typescript
// Search around anchor A
const result = await client.callTool('search_local', {
  slot: 'A',
  query: 'React hooks',
  limit: 10
});

// Get all memories around anchor B
const result = await client.callTool('search_local', {
  slot: 'B',
  hop_limit: 2
});
```

### clear_anchor

Clears anchors when a task ends or the topic shifts. Omit `slot` to clear every slot for the given `agent_id`.

#### Parameters

```typescript
interface ClearAnchorParams {
  slot?: 'A' | 'B' | 'C';         // Slot to clear (optional, clears all if not specified)
  agent_id?: string;               // Agent ID (default: 'default')
}
```

#### Response

```typescript
interface ClearAnchorResult {
  success: boolean;                 // Success status
  agent_id: string;                // Agent ID
  slot?: string;                   // Cleared slot
  message: string;                 // Result message
}
```

#### Usage Example

```typescript
// Clear specific anchor
const result = await client.callTool('clear_anchor', {
  slot: 'A'
});

// Clear all anchors
const result = await client.callTool('clear_anchor', {});
```

### Tools available only via HTTP API (not on MCP)

The following four tools have been removed from the MCP client and are provided only via the HTTP Administrator API:

- **restore_anchors** — Restore anchors from database → `POST /admin/anchors/restore`
- **migrate_embeddings** — Migrate embeddings between providers → `POST /admin/embeddings/migrate`
- **convert_episodic_to_semantic** — Convert episodic to semantic memory → `POST /admin/memory/convert-episodic-to-semantic`
- **get_meta_memory_stats** — Get meta memory statistics (recall success rate, confidence) → `GET /admin/memory/meta-stats`

See [Administrator API](#administrator-api) for request/response details.

## Administrator API

> **Note**: The following functions have been removed from MCP client and separated into HTTP API endpoints.

### Memory Management API

#### Get Memory Neighbors
```http
GET /memories/:id/neighbors?limit=5&similarity_threshold=0.8
```
Retrieves neighbor memories similar to a specific memory.

**Query Parameters:**
- `limit` (optional): Maximum number of neighbor memories to return (default: 5, max: 50)
- `similarity_threshold` (optional): Similarity threshold (default: 0.8, range: 0.0 ~ 1.0)

**Response:**
```json
{
  "memory_id": "mem_123",
  "neighbors": [
    {
      "id": "mem_456",
      "content": "Similar memory content",
      "type": "episodic",
      "similarity": 0.85,
      "importance": 0.7,
      "created_at": "2024-01-01T00:00:00Z",
      "tags": ["tag1", "tag2"]
    }
  ],
  "total_count": 1,
  "query_time": 45,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

**Error Responses:**
- `404`: Memory not found
- `400`: Invalid parameters
- `500`: Server error

#### Memory Cleanup
```http
POST /admin/memory/cleanup
```
Cleans up memories.

**Response:**
```json
{
  "message": "Memory cleanup completed"
}
```

#### Forgetting Statistics
```http
GET /admin/stats/forgetting
```
Retrieves forgetting statistics.

**Response:**
```json
{
  "message": "Forgetting statistics retrieved"
}
```

#### Memory review candidates (MVP)

Operators and agents can inspect the **review queue** (`memory_review_candidate`) over the HTTP Admin API and call `review` or `dismiss` on a candidate. Rows are refreshed periodically by the `memory_review_candidates` batch job. All routes are mounted under **`/admin`** and require the same **browser session** authentication as other admin endpoints.

> **GitHub #244 note**: Names such as `MEMORY_REVIEW_INTERVAL_MS` or `MEMORY_REVIEW_CANDIDATE_TTL_DAYS` from the issue draft do not match or are not defined in current `main`. The paths and variables below reflect the **runtime**.

##### List candidates

```http
GET /admin/memory/review-candidates
GET /admin/memory/review-candidates?status=pending
```

**Query parameters**

- `status` (optional): `pending` \| `reviewed` \| `dismissed` \| `expired`. Omit to return all statuses.

**Response (200)**

Each element of `candidates` contains only queue metadata (`id`, `memory_id`, `status`, `priority`, `reason`, `due_at`, timestamps, `metadata_json`). **`memory_item.content` and other memory body fields are not included.** Fetch the memory body via another endpoint using `memory_id`.

```json
{
  "message": "Memory review candidates",
  "candidates": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "memory_id": "mem_abc123",
      "status": "pending",
      "priority": 0.82,
      "reason": "stale_high_importance",
      "due_at": "2026-05-16T12:00:00.000Z",
      "created_at": "2026-05-02T10:00:00.000Z",
      "updated_at": "2026-05-02T10:00:00.000Z",
      "reviewed_at": null,
      "dismissed_at": null,
      "metadata_json": "{\"score_breakdown\":{}}"
    }
  ],
  "timestamp": "2026-05-02T12:00:00.000Z"
}
```

**Errors**

- `400`: invalid `status` value
- `500`: database not connected or other server error

##### Review queue SSE (optional real-time)

```http
GET /admin/memory/review-candidates/stream
```

Same **browser session** cookie as other `/admin` routes. Returns **`text/event-stream`** with:

- `retry:` reconnection hint for the browser `EventSource` client
- `event: ready` — connection established (payload `{"ok":true}`)
- `: ping` comment frames periodically to keep the connection warm
- `event: changed` — queue may have changed; payload includes `reason` (`review`, `dismiss`, or `batch_memory_review_candidates`)

The dashboard client opens this stream after the pending list loads successfully; if `EventSource` is unavailable or the stream errors, it **falls back to the existing polling** from issue #255. **Single-process only** (no cross-replica fan-out without Redis or similar).

##### Single memory preview (Admin)

When the review queue list omits body text, fetch one `memory_item` row by `memory_id` (e.g. for the dashboard preview pane).

```http
GET /admin/memory/items/:memory_id
```

- `:memory_id` must be URL-encoded and match **`mem_` + letters, digits, or `_`**. Anything else returns **400**.
- Soft-deleted memories (`is_deleted = 1`) return **404**.

**Response (200)**

```json
{
  "message": "Memory item",
  "memory": {
    "id": "mem_abc123",
    "type": "semantic",
    "content": "…",
    "importance": 0.82,
    "privacy_scope": "private",
    "pinned": false,
    "created_at": "2026-05-02T10:00:00.000Z",
    "last_accessed": null,
    "last_accessed_at": null,
    "tags": null,
    "source": null,
    "project_id": null,
    "owner_id": null
  },
  "timestamp": "2026-05-03T12:00:00.000Z"
}
```

**Errors**

- `400`: invalid `memory_id` format
- `404`: not found or deleted
- `500`: database not connected or other server error

##### Mark reviewed

```http
POST /admin/memory/review-candidates/:id/review
Content-Type: application/json

{}
```

**Response (200)**

```json
{
  "ok": true,
  "candidate": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "memory_id": "mem_abc123",
    "status": "reviewed",
    "priority": 0.82,
    "reason": "stale_high_importance",
    "due_at": "2026-05-16T12:00:00.000Z",
    "created_at": "2026-05-02T10:00:00.000Z",
    "updated_at": "2026-05-02T12:00:00.000Z",
    "reviewed_at": "2026-05-02T12:00:00.000Z",
    "dismissed_at": null,
    "metadata_json": null
  },
  "timestamp": "2026-05-02T12:00:00.000Z"
}
```

**Errors**

- `400`: `:id` is not a UUID
- `404`: candidate missing — body includes `code`: `memory_review_candidate_not_found`
- `409`: not `pending` (e.g. double submit) — `code`: `memory_review_candidate_not_actionable`
- `500`: other server error

##### Dismiss candidate

```http
POST /admin/memory/review-candidates/:id/dismiss
Content-Type: application/json

{}
```

Responses and error mapping match **Mark reviewed**; on success `status` becomes `dismissed`.

##### Bulk dismiss or expire candidates

```http
POST /admin/memory/review-candidates/bulk-dismiss
POST /admin/memory/review-candidates/bulk-expire
Content-Type: application/json
```

The request body must contain **exactly one** selector:

```json
{ "ids": ["550e8400-e29b-41d4-a716-446655440000"] }
```

```json
{ "older_than_days": 30 }
```

```json
{ "all_pending": true }
```

`ids` must be a non-empty UUID array. `older_than_days` must be an integer from 1 through 3650. Both endpoints update only rows that are currently `pending`; already processed candidates are ignored.

```json
{
  "ok": true,
  "action": "dismiss",
  "matched": 12,
  "updated": 12,
  "timestamp": "2026-06-14T12:00:00.000Z"
}
```

- `matched`: rows matching both the selector and `pending` status
- `updated`: rows actually changed by the transaction
- `400`: missing, mixed, or invalid selector
- `500`: database unavailable or update failure

##### Batch: select and upsert queue

```http
POST /admin/batch/run
Content-Type: application/json

{ "jobType": "memory_review_candidates" }
```

- The `BatchScheduler` job registered as `memory_review_candidates` runs the same logic on `MEMORY_REVIEW_CANDIDATES_INTERVAL_MS`.
- `jobType` must be one of the allowed values (e.g. `cleanup`, `monitoring`, `memory_review_candidates`); invalid values return **400**.

##### Environment variables (memory review MVP)

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_REVIEW_IMPORTANCE_THRESHOLD` | `0.7` | Minimum importance for candidacy (0–1; invalid values fall back to default) |
| `MEMORY_REVIEW_STALE_DAYS` | `14` | Minimum stale age in days (integer ≥ 1) |
| `MEMORY_REVIEW_MAX_CANDIDATES` | `50` | Max candidates from selection / upsert path (integer ≥ 1) |
| `MEMORY_REVIEW_MAX_BACKLOG` | `500` | Skip new selection when pending candidates reach this count (`0`: disabled) |
| `MEMORY_REVIEW_CANDIDATE_TTL_DAYS` | `30` | Expire pending candidates older than this many days before each batch (`0`: disabled) |
| `MEMORY_REVIEW_CANDIDATES_INTERVAL_MS` | `86400000` (24h) | Scheduler interval for `memory_review_candidates` in ms (minimum `60000`) |
| `MEMORY_REVIEW_CANDIDATE_DUE_DAYS` | `14` | Days added to “now” when the batch computes each row’s `due_at` (1–366) |


The dashboard **Review Queue** tab reads polling options from an inline `window.__MEMENTO_REVIEW_QUEUE__` object injected on `GET /dashboard` (GitHub #274).

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS` | `60000` | Delay between successful background polls (ms). Invalid/absent values behave like `60000`. The server **clamps** to **10000**–**86400000** (1 day). |
| `MEMENTO_REVIEW_QUEUE_POLL_ERROR_BACKOFF_MS` | (empty) | Backoff delays after a failed poll attempt, comma-separated (e.g. `60000,120000`). When empty, failures retry on the same interval as successes. Each step is **clamped** to **10000**–**86400000**. |

**Recommendation:** keep the default 60s or increase it for quieter traffic; add gentle error backoff only if your environment sees intermittent admin errors (for example `MEMENTO_REVIEW_QUEUE_POLL_ERROR_BACKOFF_MS=60000,120000`). Do not confuse this with the batch scheduler variable `MEMORY_REVIEW_CANDIDATES_INTERVAL_MS`.


Tune **selection sensitivity** with the first three variables; tune **schedule cadence and due dates** with the last two.

### Performance Monitoring API

#### Performance Statistics
```http
GET /admin/stats/performance
```
Retrieves performance statistics.

**Response:**
```json
{
  "message": "Performance statistics retrieved"
}
```

#### Performance Alerts
```http
GET /admin/alerts/performance
```
Retrieves performance alerts.

**Response:**
```json
{
  "message": "Performance alerts retrieved"
}
```

### Error Management API

#### Error Statistics
```http
GET /admin/stats/errors
```
Retrieves error statistics.

**Response:**
```json
{
  "message": "Error statistics retrieved"
}
```

#### Error Resolution
```http
POST /admin/errors/resolve
Content-Type: application/json

{
  "errorId": "error-123",
  "resolvedBy": "admin",
  "reason": "Database connection issue resolved"
}
```
Marks error as resolved.

**Response:**
```json
{
  "message": "Error resolution completed"
}
```

### Database Management API

#### Database Optimization
```http
POST /admin/database/optimize
```
Optimizes database.

**Response:**
```json
{
  "message": "Database optimization completed"
}
```

## Removed MCP Tools

The following tools have been removed from MCP client:

- `hybrid_search` - Hybrid search (replaced by basic `recall`)
- `summarize_thread` - Session summary (planned for future implementation)
- `link` - Memory relationship creation (partially replaced by `add_relation` / `get_relations` / `remove_relation`)
- `export` - Memory export (replaced by `export_memories` MCP tool)
- `apply_forgetting_policy` - Forgetting policy application (moved to HTTP API)
- `schedule_review` - Review scheduling (moved to HTTP API)
- `get_performance_metrics` - Performance metrics retrieval (moved to HTTP API)
- `get_cache_stats` - Cache statistics retrieval (moved to HTTP API)
- `clear_cache` - Cache cleanup (moved to HTTP API)
- `optimize_database` - Database optimization (moved to HTTP API)
- `error_stats` - Error statistics retrieval (moved to HTTP API)
- `resolve_error` - Error resolution (moved to HTTP API)
- `performance_alerts` - Performance alert management (moved to HTTP API)

## MCP Resources

### memory/{id}

Resource for retrieving detailed information of a specific memory.

#### URL

```
memory/{memory_id}
```

#### Response

```typescript
interface MemoryResource {
  id: string;                       // Memory ID
  content: string;                  // Memory content
  type: string;                     // Memory type
  importance: number;               // Importance
  created_at: string;               // Creation time
  last_accessed: string;            // Last access time
  pinned: boolean;                  // Pinned status
  source?: string;                  // Source
  tags?: string[];                  // Tags
  privacy_scope: string;            // Privacy scope
  links?: {
    source_of: string[];            // Memories derived from this memory
    derived_from: string[];         // Memories this memory is derived from
    duplicates: string[];           // Duplicate memories
    contradicts: string[];          // Contradicting memories
  };
}
```

### memory/search

Resource that provides search results in cached form.

#### URL

```
memory/search?query={query}&filters={filters}&limit={limit}
```

#### Query Parameters

- `query`: Search query (required)
- `filters`: Filter in JSON format (optional)
- `limit`: Result limit (optional, default: 8)

#### Response

```typescript
interface SearchResource {
  query: string;                    // Search query
  results: MemoryItem[];            // Search results
  total_count: number;              // Total result count
  query_time: number;               // Search time
  cached_at: string;                // Cache time
  expires_at: string;               // Cache expiration time
}
```


## MCP Prompts

### memory_injection

Use before a task to gather context in one shot. The MCP **tool** `memory_injection` returns a token-budgeted summary of relevant memories; the schema below is for the same-named **prompt** (`getPrompt`) path. In practice, the tool call is more common.

#### Parameters

```typescript
interface MemoryInjectionParams {
  query: string;                    // Search query (required)
  token_budget?: number;            // Token budget (default: 1200)
  context_type?: 'conversation' | 'task' | 'general';  // Context type (default: 'general')
}
```

#### Response

```typescript
interface MemoryInjectionPrompt {
  role: 'system';
  content: string;                  // Context content to inject
  metadata: {
    memories_used: number;          // Number of memories used
    token_count: number;            // Actual token count used
    search_time: number;            // Search time
  };
}
```

#### Usage Example

```typescript
const prompt = await client.getPrompt('memory_injection', {
  query: "React development related questions",
  token_budget: 1500,
  context_type: 'conversation'
});
```

## Error Handling

### Error Codes

| Code | Description |
|------|-------------|
| `MEMORY_NOT_FOUND` | Memory not found |
| `INVALID_INPUT` | Invalid input parameters |
| `STORAGE_ERROR` | Storage error |
| `SEARCH_ERROR` | Search error |
| `AUTHENTICATION_ERROR` | Authentication error (M2+) |
| `PERMISSION_DENIED` | Permission denied (M3+) |
| `RATE_LIMIT_EXCEEDED` | Request limit exceeded |
| `INTERNAL_ERROR` | Internal server error |

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;                   // Error code
    message: string;                // Error message
    details?: any;                  // Additional details
    timestamp: string;              // Error occurrence time
  };
}
```

## Performance Considerations

### Search Performance

- **Vector Search**: Average 50-100ms
- **Keyword Search**: Average 20-50ms
- **Complex Search**: Average 100-200ms

### Memory Usage

- **Average memory size**: 1-5KB per memory
- **Embedding size**: 1536 dimensions × 4 bytes = 6KB
- **Index overhead**: About 20-30% of data

### Limitations

- **Maximum memory size**: 10MB
- **Search result limit**: 100 items
- **Concurrent connections**: 100 (M1), 1000 (M3+)
- **API request limit**: 1000/hour (M1), 10000/hour (M3+)

## Version Management

### API Version

Current API version: `v1.0.0`

### Compatibility

- **MCP Protocol**: 2025-03-26
- **TypeScript**: 5.0+
- **Node.js**: 20+

### Migration Guide

For changes during version upgrades, refer to [CHANGELOG.md](../../../CHANGELOG.md).
