# Recall Performance Tuning

When recall calls are slower than expected, there are three main tools available for diagnosis and improvement: the profiling environment variable, procedural version indexes, and switching to anchor-based local search.

## Enabling Profiling

To measure the processing time of individual recall calls, set `MEMENTO_RECALL_PROFILE=1` in the environment before starting the server.

```bash
MEMENTO_RECALL_PROFILE=1 npm run dev
```

When this variable is active, a successful recall call writes a `recall_profile` log message that includes a `total_ms` field representing the total processing time in milliseconds. This makes it straightforward to identify when recall is slow and correlate timing with specific query patterns or memory counts.

The variable is disabled by default. In production, enable it only for targeted profiling sessions and disable it again when done, as the additional logging adds a small overhead.

If `total_ms` is higher than expected, the next step is to determine which stage is the bottleneck: FTS5 index health, embedding computation time, or procedural version filtering.

## Procedural Version Indexes

Migration 014 added two partial indexes specifically for procedural memory version chain queries and latest-version filtering.

- `idx_memory_item_procedural_version_series` — on `(type, version_series_id)`, partial condition `type = 'procedural'`
- `idx_memory_item_procedural_version` — on `(type, version_series_id, version)`, partial condition `type = 'procedural'`

When a recall call uses the `version_filter` option to retrieve the latest version of a procedural memory, these indexes allow the query to scan only the relevant subset of rows. Without them, the database must perform a full scan of the `memory_item` table filtered by type, which degrades significantly as the total number of memories grows.

If you are running an environment where migration 014 has not yet been applied, run `npm run db:migrate` to add the indexes.

## FTS5 Full-Text Search

Recall's text-based and hybrid searches use the `memory_item_fts` FTS5 virtual table. If the FTS5 index is unavailable or in a degraded state, the search engine falls back to basic LIKE-based scanning, which is substantially slower for large memory stores. FTS5 configuration is handled in `packages/memento-core/src/domains/search/` and the DB initialization schema.

## Anchor-Based Local Search

Recall searches the entire memory space for every call. If you already know that relevant context is concentrated around a specific anchor, using the `search_local` MCP tool instead of `recall` is more efficient.

`search_local` limits its traversal to memories within a specified hop distance from a given anchor slot (A, B, or C). Because the search space is much smaller, it returns results faster than recall on large memory databases.

```json
{
  "name": "search_local",
  "arguments": {
    "agent_id": "default",
    "slot": "A",
    "query": "your query here",
    "hop_limit": 3,
    "limit": 10
  }
}
```

The default hop_limit and similarity threshold vary by slot. Slot A uses hop_limit=2 and threshold=0.7 (narrowest range), Slot B uses hop_limit=3 and threshold=0.6 (medium range), and Slot C uses hop_limit=5 and threshold=0.5 (widest range). When the working context is well-defined, choosing a slot with a smaller hop_limit produces faster and more focused results.

For full coverage of the anchor system, see the [how to check anchor connections](./how-to-check-anchor-connections.md) guide.
