# Memento Goals

## 1. Goal Summary

**Goal**: Provide storage+search+summary+forgetting mechanisms modeled after human memory systems (working memory, episodic memory, semantic memory, procedural memory) so that agents don't lose conversation/task context.

**Non-goals**: Large-scale RAG platforms, general-purpose data lakes. Initially focus on personal/workspace-level long-term memory and conversation-session transitions.

### Rationale for Human Memory Model

- **Episodic/Semantic Separation**: Tulving lineage – episodic is events, semantic is knowledge. The two systems are interdependent. [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2657600/) +1

- **Working Memory**: Central executive, phonological loop, visuospatial memory components manage "currently processing information". [Simply Psychology](https://www.simplypsychology.org/working-memory.html) +1

- **Forgetting/Spaced Repetition**: Ebbinghaus curve and "periodic reminders" are advantageous for long-term retention. [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2657600/) +1

### MCP Application Rationale

MCP exposes Tools/Resources/Prompts as standards and can be easily connected from clients (Claude, ChatGPT, Cursor, etc.). [WorkOS](https://workos.com/) +3, [Model Context Protocol](https://modelcontextprotocol.io/) +3

## 2. System Overview (Components)

### Memory MCP Server

- **Protocol**: MCP (spec 2025-03-26)
- **Interface**: tools (memory write/search/pin/delete, etc.), resources (read-only views), prompts (context injection templates). [Model Context Protocol](https://modelcontextprotocol.io/) +1

### Storage

- **Primary**: PostgreSQL + pgvector (managing vectors/metadata/transactions together). [GitHub](https://github.com/pgvector/pgvector) +1
- **Alternative**: SQLite+FTS5 (+lancedb) for embedded, or Qdrant/Milvus for separation

### Embedding & Summary

Text embedding models (sentence embeddings), "information compression summarizer (map-reduce)" pipeline.

### Scheduler/Worker

"Sleep consolidation" batch (nighttime clustering, summarization, rule extraction), "forgetting/review" batch (re-exposure, deletion candidate selection).

## 3. Data Model (Corresponding to Human Memory)

### Core Tables

#### memory_item
- `id`, `type`(working|episodic|semantic|procedural), `title`, `content`, `source`(chat|tool|file|url), `agent_id`, `user_id`, `project_id`
- `created_at`, `last_accessed_at`, `importance`(0~1), `pinned`(bool), `privacy_scope`(private|team|public), `origin_trace`(json)

#### memory_embedding
- `memory_id` FK, `embedding` vector, `dim`

#### memory_tag (N:N)
- Tags (e.g., tech:mariadb, pref:coffee, task:ads-settlement)

#### memory_link
- Relationships between memories (cause_of, derived_from, duplicates, contradicts) – semantic connection network

#### feedback_event
- `memory_id`, `event`(used|edited|neglected|helpful|not_helpful), `score`, `ts`

### Working Memory Buffer

#### wm_buffer
- `session_id`, `items`(json), `token_budget`, `expires_at`

When session ends/token limit exceeded, transition to **episodic** snapshot.

## 4. Search, Ranking, Forgetting (Including Formulas)

### 4.1 Search Score

Final score S:

```
S = α * relevance + β * recency + γ * importance + δ * usage - ε * duplication_penalty
```

- **relevance**: Cosine similarity (embedding) + keyword TF-IDF correction
- **recency**: `exp(-λ * age_days)` (applying Ebbinghaus-type forgetting function; λ is domain-specific tuning) [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2657600/) +1
- **importance**: Explicit/inferred ("user preferences, rules, long-term goals" get higher weights)
- **usage**: Log scale of query/citation/reuse frequency
- **duplication_penalty**: Deduction for similar items within clusters

### 4.2 Forgetting/Spaced Repetition

- **Soft deletion candidate queue**: Items with low S and old `last_accessed_at` among non-pinned/non-policy items
- **Retention policy**: Tag/scope-specific TTL (e.g., wm: 48h, episodic: 90d, semantic: indefinite)
- **Spaced repetition**: High-importance items generate review events (card-form reminders) for re-exposure

### 4.3 Semantic Integration ("Sleep Consolidation")

Cluster recent episodic → conflict/consistency check → generate semantic in rule/fact form

Implement "fast episodic → slow semantic integration" using CLS hypothesis (hippocampus-neocortex complementary learning) as motif. [PubMed](https://pubmed.ncbi.nlm.nih.gov/) +1

## 5. MCP Interface Design (Tools/Resources/Prompts)

### 5.1 tools (Summarized Signatures)

#### remember
- **Input**: `content`, `type?`, `tags?`, `importance?`, `source?`, `privacy_scope?`
- **Output**: `memory_id`

#### recall
- **Input**: `query`, `filters?`(type/tags/time/project/agent), `limit?`
- **Output**: `items[]`(snippet, score, recall_reason)

#### pin / unpin

#### forget
- Hard/soft deletion options, GDPR-style "right to erasure" support

#### summarize_thread
- Current session log → wm_buffer summary → episodic storage

#### link
- Create relationships between memories (cause, derivation, duplication, contradiction)

#### export
- NDJSON/Markdown/CSV export

#### feedback
- Collect usability/accuracy feedback (helpful, not_helpful, attach correct answers)

**MCP Spec Rationale**: Standardize tools/resources/prompts so clients can automatically discover, call, and configure. [Model Context Protocol](https://modelcontextprotocol.io/) +1

### 5.2 resources

- `memory/{id}`: Read-only single view
- `memory/search?query=...`: Recent search result cache resource (useful for client-side preview)

### 5.3 prompts

#### memory_injection
- **Description**: "Before this turn's response, inject 'top 5 related memory summaries' as context"
- **Parameters**: `query`, `token_budget`

Easy for agents to use with MCP Prompts functionality. [Model Context Protocol](https://modelcontextprotocol.io/)

## 6. Agent Execution Flow

1. **WM Loading**: Organize current user message + previous n-turn summary in `wm_buffer`
2. **Query Construction**: `query = user_msg + task + wm_summary`
3. **recall call**:
   - Filter: `project_id`, `tags`, `type in {semantic, episodic}`
   - 1st ANN (vector) → 2nd rerank (BM25/keyword + rule match)
   - Deduplication & compression: map-reduce summary, record conflicts as `link(contradicts)`
4. **Prompt Injection**: Inject top K items with `prompts.memory_injection`
5. **After Response Generation**:
   - Record new facts/preferences/decisions with `remember`
   - Reflect `feedback(helpful)` signals
6. **Batch Work (Night)**: Clustering, summary integration, forgetting/reminder scheduling

## 7. Minimum Viable Product (MVP) Spec

- Memory write/read/search/pin/delete tools
- Initially support only episodic/semantic types (working memory as session cache)
- **Score**: `S = 0.5*relevance + 0.2*recency + 0.2*importance + 0.1*usage`
- **Retention**: episodic 90d, semantic indefinite, wm 48h
- **Storage**: Postgres+pgvector, ivfflat index, cosine distance. [GitHub](https://github.com/pgvector/pgvector) +1
- MCP `prompts.memory_injection` 1 type

## 8. Example: TypeScript MCP Server Skeleton

```typescript
// package: mcp-memory-server
import { Server } from "@modelcontextprotocol/sdk/server";
import { z } from "zod";
import { recall, remember, pin, unpin, forget, summarizeThread, link, exportMem, feedback } from "./tools";

const server = new Server({ name: "mcp-memory", version: "0.1.0" });

// Tools
server.tool("remember", {
  schema: z.object({
    content: z.string(),
    type: z.enum(["episodic","semantic"]).default("episodic"),
    tags: z.array(z.string()).optional(),
    importance: z.number().min(0).max(1).default(0.5),
    source: z.string().optional(),
    privacy_scope: z.enum(["private","team","public"]).default("private")
  }),
  handler: remember
});

server.tool("recall", {
  schema: z.object({
    query: z.string(),
    filters: z.object({
      type: z.array(z.enum(["episodic","semantic"])).optional(),
      tags: z.array(z.string()).optional(),
      project_id: z.string().optional(),
      time_from: z.string().optional(),
      time_to: z.string().optional()
    }).optional(),
    limit: z.number().default(8)
  }),
  handler: recall
});

// ... register pin/unpin/forget/summarizeThread/link/export/feedback ...

// Resources
server.resource("memory/{id}", async (params) => {/* read-only view */});

// Prompts
server.prompt("memory_injection", {
  params: [{ name: "query", required: true }, { name: "token_budget", required: false }],
  getPrompt: async ({ query, token_budget = 1200 }) => {
    const items = await recall({ query, limit: 6 });
    const summary = await compress(items, token_budget);
    return [{ role: "system", content: `Related long-term memory summary:\n${summary}` }];
  }
});

server.start();
```
