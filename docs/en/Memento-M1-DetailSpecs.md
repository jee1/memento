# MCP Memory Server M1 Detailed Design Document

## 1. Purpose

This stage (M1) aims to implement a lightweight memory assistant MCP server that can be easily run by individual users in a local environment.
The database uses SQLite embedded DB that can be used without separate installation, and provides basic functions such as memory storage, search, deletion, and pinning through the MCP interface.

## 2. Overall Architecture

- **Client**: IDE supporting MCP (e.g., Cursor) or AI Agent
- **Server**: MCP Memory Server (Node.js/TypeScript based)
- **Storage**: SQLite database (memory.db file)

**Structure**:
```
[Client/Agent] ↔ [MCP Memory Server] ↔ [SQLite DB (memory.db)]
```

## 3. Feature Scope

### Memory Storage (remember)
- **Input**: content, type, tags, importance, privacy_scope
- **Output**: memory_id
- **Action**: Store text in DB, generate embedding and record in vector column

### Memory Search (recall)
- **Input**: query, filters(type, tags, date), limit
- **Output**: List of related memories
- **Action**: Combine FTS5 (keyword) + VSS (vector search)

### Memory Deletion (forget)
- **Soft Delete**: Automatically removed when TTL expires
- **Hard Delete**: Direct user call

### Memory Pin/Unpin (pin/unpin)
- Exclude specific memories from TTL and forgetting policies

## 4. Database Design (SQLite)

### 4.1 Main Table

```sql
CREATE TABLE memory_item (
  id TEXT PRIMARY KEY,
  type TEXT CHECK (type IN ('working','episodic','semantic','procedural')),
  content TEXT,
  importance REAL,
  privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed TIMESTAMP,
  pinned BOOLEAN DEFAULT FALSE
);
```

### 4.2 Indexes

#### FTS5 (Text Search)
```sql
CREATE VIRTUAL TABLE memory_item_fts USING fts5(content);
```

#### VSS (Vector Search, 1536-dimensional example)
```sql
CREATE VIRTUAL TABLE memory_item_vss USING vss0(embedding(1536));
```

## 5. MCP Interface (M1 Limited)

### Tools
- `remember(content, type?, tags?, importance?, privacy_scope?)`
- `recall(query, filters?, limit?)`
- `forget(id, hard?)`
- `pin(id)` / `unpin(id)`

### Resources
- `memory/{id}` (read single memory)

### Prompts
- `memory_injection(query, token_budget)`
  - Inject top 5 related memories summarized into prompt

## 6. Forgetting Policy

- **Working Memory**: Deleted after 48 hours
- **Episodic Memory**: Maintained for 90 days
- **Semantic Memory**: Indefinite
- **Pinned**: Excluded from deletion targets

Periodically run batch jobs (cron jobs) to clean up expired records.

## 7. Operation Flow

### Memory Storage
1. User calls `remember`
2. Record in DB → Update FTS5 index → Generate embedding and record in VSS table

### Memory Search
1. User calls `recall`
2. Keyword search with FTS5 → Vector search with VSS → Sum scores → Return top K results

### Forgetting/Deletion
1. Batch job deletes TTL expired items
2. Immediate removal when user calls `forget`

## 8. Operations and Deployment

- **Runtime Environment**: Node.js (v20 or higher)
- **Deployment Method**: Local execution
  ```bash
  node memory-server.js
  ```
- **DB Management**: Single memory.db file (stored in local storage)
- **Backup/Restore**: Can be handled by file copying

## 9. Limitations and Next Stage Considerations

**Limitations**: Single user only, no permission management

**Expansion Considerations**:
- Add API Key authentication in M2
- Switch to SQLite server mode
- Plan to enable team collaboration using ACL (user_id, privacy_scope)

## 10. Checklist

- [ ] SQLite DB initial schema creation completed
- [ ] MCP Tools (remember, recall, forget, pin/unpin) implementation completed
- [ ] FTS5 + VSS based search working properly
- [ ] TTL based forgetting policy batch script applied
- [ ] MCP Client integration testing completed in local environment
