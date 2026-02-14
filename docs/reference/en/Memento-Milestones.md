# 📄 MCP Memory Server Design and Milestones Document
## 🎯 Vision

Implement an AI Agent memory assistant MCP server that mimics human memory structure (working memory, episodic memory, semantic memory).

- Personal (MVP): Single SQLite file based, lightweight local execution
- Team: Internal network only server + single API Key, SQLite + serialization queue
- Organization: Postgres + pgvector + JWT authentication, SSO/LDAP integration

## 🛠 Milestone Overview

| Stage | Target | Storage | Authentication | Security Scope | Operation Method |
|-------|--------|---------|----------------|----------------|------------------|
| M1 | Personal | SQLite Embedded | None | Local | Local execution |
| M2 | Team | SQLite Server Mode (WAL + serialization queue) | Single API Key | Internal network only | Docker single container |
| M3 | Organization Entry | Postgres + pgvector | JWT (user-specific tokens) | Internal network or VPN | Docker Compose (server+DB) |
| M4 | Organization Expansion | Postgres + HA configuration | JWT + RBAC + SSO/LDAP | Enterprise security policy compliance | Kubernetes/Cloud RDS |

## ⚙️ Stage-by-Stage Design

### 🔹 M1. Personal Use (MVP)

- **DB**: SQLite (memory.db)
- **Indexes**: FTS5, sqlite-vec (vector search)
- **MCP Tools**: remember, recall, forget, pin
- **Forgetting Policy**: TTL-based (working 48h, episodic 90d, semantic indefinite)
- **Operation**: Local execution (node memory-server.js)

### 🔹 M2. Team Collaboration (Internal Network Only Server)

- **DB**: SQLite (WAL mode)
- **Write Processing**: Server-level queuing → serialization
- **Read Processing**: Multiple concurrent reads possible
- **Authentication**: Single API Key (API_KEY=team-secret-key)
- **Security**: Internal network only (external ports blocked)
- **Operation**: Docker single container

```yaml
services:
  memory-server:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
    environment:
      - DB_PATH=/app/data/memory.db
      - API_KEY=team-secret-key
```

- **ACL**: Apply privacy_scope (private | team)

### 🔹 M3. Organization Entry (Postgres Migration)

- **DB**: Postgres 15+, pgvector extension

**Schema**:

```sql
CREATE TABLE memory_item (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  type TEXT CHECK (type IN ('working','episodic','semantic','procedural')),
  content TEXT,
  importance REAL,
  privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_accessed TIMESTAMPTZ,
  embedding vector(1536),
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX ON memory_item USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON memory_item USING GIN (content_tsv);
```

- **Authentication**: JWT-based user-specific tokens (including user_id claim)
- **Security**: Internal network or VPN restriction
- **Operation**: Docker Compose (Memory Server + Postgres)

### 🔹 M4. Organization Expansion (High Availability + Enterprise Security)

- **DB**: Postgres cluster (HA configuration, cloud RDS possible)
- **Authentication**: JWT + RBAC + SSO/LDAP integration
- **Permission Model**:
  - privacy_scope: private/team/public
  - project_id: workspace unit
  - RBAC (Role-Based Access Control) → admin/editor/viewer
- **Operation**: Kubernetes, Helm Chart deployment, monitoring (Prometheus)
- **Additional Features**: Auto archiving, backup/restore, GDPR-style deletion

## 📦 MCP Interface (Common)

### Tools

- `remember(content, type, tags?, importance?, privacy_scope?)`
- `recall(query, filters?, limit?)`
- `pin(id), unpin(id)`
- `forget(id, hard?)`
- `summarize_thread(session_id)`
- `link(src, dst, rel)`
- `export(format)`
- `feedback(memory_id, helpful?)`

### Resources

- `memory/{id}`
- `memory/search?query=...`

### Prompts

- `memory_injection(query, token_budget)` → Inject top K related memories summarized

## 🔐 Security Model Summary

- **M1**: None (local only)
- **M2**: Single API Key (team shared)
- **M3**: JWT (user-specific tokens, can integrate with organization account server)
- **M4**: JWT + RBAC + SSO/LDAP → Enterprise security policy compliance

## 📑 Migration Guide Summary

1. Extract memory_item.csv from SQLite
2. Create schema in Postgres (pgvector, tsvector)
3. CSV import → `\copy`
4. Recalculate and update embeddings
5. Replace only DB driver in MCP Memory Server

## ✅ Checklist

- [ ] Personal SQLite server completed
- [ ] Team stage Docker deployment + API Key applied
- [ ] Postgres migration documentation completed
- [ ] Organization stage JWT authentication integration
- [ ] Roadmap for SSO/LDAP integration confirmed
