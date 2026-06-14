# How to Check Anchor Connections

Anchors fix a specific memory to one of three slots (A, B, C), enabling `search_local` calls to search only the neighborhood around that memory rather than the full memory space. There are four ways to inspect which memories are connected to a given anchor.

## 1. Anchor Map UI (Dashboard)

If the HTTP server is running, the dashboard provides a visual representation of anchor connections.

```
http://localhost:9001/dashboard
```

After opening the dashboard, click the "Load Map" button to render the anchor graph. Anchor nodes are color-coded by slot: Slot A appears in red, Slot B in orange, and Slot C in blue.

Clicking any node in the graph opens its details in the sidebar: Memory ID, content, hop distance from the anchor, similarity score, importance, and creation time. The left sidebar's "Anchors" section lists all currently set anchors; clicking one jumps to its node in the graph.

To search within the anchor neighborhood, enter a query, select a slot, and click "Search". Matching memories are highlighted in the graph with a pulse animation, and the view centers on the first result.

## 2. HTTP API

### Anchor Map API

To retrieve the full anchor graph — anchors, connected nodes, and link relationships — as JSON:

```bash
curl "http://localhost:9001/api/anchors/map?agent_id=default"
```

The response contains three arrays: `anchors` (the set anchors), `nodes` (all nodes in the neighborhood), and `links` (the connections between nodes).

```json
{
  "agent_id": "default",
  "anchors": [
    {
      "agent_id": "default",
      "slot": "A",
      "memory_id": "mem_xxx",
      "created_at": "2025-11-09 06:35:26"
    }
  ],
  "nodes": [
    {
      "id": "mem_xxx",
      "type": "anchor",
      "slot": "A",
      "content": "anchor memory content",
      "importance": 0.7
    },
    {
      "id": "mem_yyy",
      "type": "memory",
      "content": "connected memory content",
      "hop_distance": 1,
      "similarity": 0.85,
      "importance": 0.6
    }
  ],
  "links": [
    {
      "source": "mem_xxx",
      "target": "mem_yyy",
      "type": "hop",
      "hop_distance": 1,
      "similarity": 0.85
    }
  ]
}
```

In `nodes`, a `type` of `"anchor"` means the anchor memory itself and `"memory"` means a connected memory. In `links`, `type: "hop"` indicates a hop-distance-based connection and `type: "link"` indicates a direct connection from the `memory_link` table.

### Search Local API

To search for memories related to a query within the neighborhood of a specific anchor slot:

```bash
curl -X POST "http://localhost:9001/tools/search_local" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "default",
    "slot": "A",
    "query": "your search query",
    "hop_limit": 3,
    "limit": 10
  }'
```

Omitting `query` returns all related memories in the anchor's neighborhood without query-based filtering. When results are sparse and `query` is provided, the search automatically falls back to global search.

## 3. MCP Tools

From an MCP client, use `get_anchor` and `search_local` to inspect anchor connections directly.

`get_anchor` returns the memory_id and timestamps for the anchor set in a specific slot.

```json
{
  "name": "get_anchor",
  "arguments": {
    "agent_id": "default",
    "slot": "A"
  }
}
```

`search_local` traverses the anchor's neighborhood and returns memories within the hop distance.

```json
{
  "name": "search_local",
  "arguments": {
    "agent_id": "default",
    "slot": "A",
    "query": "your search query",
    "hop_limit": 3,
    "limit": 10
  }
}
```

The response includes each memory's ID, content, type, similarity score, hop distance, importance, and creation time.

## 4. Direct Database Queries

For debugging or data analysis, the SQLite database can be queried directly.

List all anchors for an agent:

```sql
SELECT * FROM anchor WHERE agent_id = 'default';
```

Find all memories directly connected to an anchor memory (where the anchor memory ID is `mem_xxx`):

```sql
SELECT
  ml.target_memory_id AS connected_memory_id,
  ml.similarity,
  ml.created_at AS link_created_at,
  mi.content,
  mi.type,
  mi.importance
FROM memory_link ml
JOIN memory_item mi ON mi.id = ml.target_memory_id
WHERE ml.source_memory_id = 'mem_xxx'
UNION
SELECT
  ml.source_memory_id AS connected_memory_id,
  ml.similarity,
  ml.created_at AS link_created_at,
  mi.content,
  mi.type,
  mi.importance
FROM memory_link ml
JOIN memory_item mi ON mi.id = ml.source_memory_id
WHERE ml.target_memory_id = 'mem_xxx';
```

## Understanding Hop Distance

Hop distance represents how many links separate a memory from the anchor. A hop distance of 1 means the memory is directly linked to the anchor memory; a distance of 2 means it is linked to a 1-hop memory; and so on.

Each slot has a default hop_limit and vector similarity threshold that controls how wide the neighborhood search reaches.

| Slot | hop_limit | vector_threshold | Character |
|------|-----------|-----------------|-----------|
| A | 2 | 0.7 | narrowest range, highest relevance |
| B | 3 | 0.6 | medium range |
| C | 5 | 0.5 | widest range |

When the working context is well-defined and related memories cluster around a known anchor, using Slot A or B with `search_local` is faster than a full `recall` call against the entire memory database.
