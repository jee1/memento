# User Manual

## Overview

This manual explains how to manage AI Agent memory using Memento MCP Server. It is designed for users of all levels, from beginners to advanced users.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Basic Usage](#basic-usage)
3. [Advanced Features](#advanced-features)
4. [Troubleshooting](#troubleshooting)
5. [FAQ](#faq)

## Getting Started

### Installation

#### M1 (Personal) - Local Installation

```bash
# Clone repository
git clone https://github.com/your-org/memento.git
cd memento

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env file to enter necessary settings

# Initialize database
npm run db:init

# Start server (hot reload)
npm run dev
```

#### M2 (Team) - Docker Installation

```bash
# Run with Docker Compose
docker-compose -f docker-compose.team.yml up -d

# Check server status
curl http://localhost:8080/health
```

### MCP Client Setup

#### Claude Desktop Setup

1. Open Claude Desktop configuration file:
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

2. Add MCP server:
```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["path/to/memento/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

3. Restart Claude Desktop

#### Cursor Setup

1. Add MCP server in Cursor settings
2. Enter server URL: `ws://localhost:8080/mcp`
3. Test connection

## Basic Usage

### 1. Storing Memories

You can store important information from conversations with AI Agents as memories.

#### Using the Actually Implemented Client

```typescript
import { createMementoClient } from './src/client/index.js';

const client = createMementoClient();
await client.connect();

// Basic storage
const memoryId = await client.callTool('remember', {
  content: "User asked about React Hooks and I explained the difference between useState and useEffect."
});

// Store with tags
const memoryId = await client.callTool('remember', {
  content: "Decided to introduce TypeScript in the project.",
  tags: ['typescript', 'decision', 'project'],
  importance: 0.8
});

// Specify memory type
```

@memento remember "React Hook usage" --type "semantic" --tags "react,hooks,programming"
```

### 2. Searching Memories

You can search stored memories to find related information. Memento provides basic search and hybrid search.

#### Hybrid Search (Recommended)

Using hybrid search that combines FTS5 text search and vector search provides more accurate results.

```typescript
// Basic hybrid search (vector 60%, text 40%)
const result = await client.callTool('hybrid_search', {
  query: "React Hook usage"
});

// Adjust weights (increase vector search ratio)
const result = await client.callTool('hybrid_search', {
  query: "TypeScript interface",
  vectorWeight: 0.8,  // Vector search 80%
  textWeight: 0.2     // Text search 20%
});
```

#### Basic Search

```
@memento recall "React Hook"
```

#### Advanced Search

```
@memento recall "TypeScript" --type "episodic,semantic" --tags "programming" --limit 10
```

#### Time Range Search

```
@memento recall "project decision" --from "2024-01-01" --to "2024-12-31"
```

### 3. Using Embedding Features

Memento uses OpenAI's `text-embedding-3-small` model to provide semantic similarity-based search. If OpenAI API is not available, it automatically uses the lightweight hybrid embedding service (TF-IDF + keyword matching).

#### Embedding Feature Setup

1. **Set OpenAI API Key**:
```bash
# Add to .env file (optional - uses lightweight embedding if not available)
OPENAI_API_KEY=your_openai_api_key_here
```

2. **Test Embedding Service**:
```bash
# Test embedding functionality
npm run test:embedding
```

#### Benefits of Embedding Features

- **Semantic Search**: Search based on meaning rather than keywords
- **Synonym Recognition**: Recognizes "car" and "vehicle" as the same meaning
- **Related Concept Search**: Recognizes "programming" and "coding" as related concepts
- **Automatic Embedding Generation**: Automatically generates vectors when storing memories

#### Using Embedding Search

```typescript
// Embeddings are automatically generated when storing memories
const result = await client.callTool('remember', {
  content: "Detailed explanation and usage examples of React Hooks",
  type: 'semantic',
  tags: ['react', 'hooks', 'javascript']
});

// Utilize vector search in hybrid search
const searchResult = await client.callTool('hybrid_search', {
  query: "React state management",
  vectorWeight: 0.7,  // Increase vector search ratio
  textWeight: 0.3
});
```

### 4. Managing Memories

#### Pinning Memories

You can pin important memories to protect them from automatic deletion.

```
@memento pin memory-123
```

#### Unpinning Memories

```
@memento unpin memory-123
```

#### Deleting Memories

```
@memento forget memory-123
```

#### Hard Delete

```
@memento forget memory-123 --hard
```

## Advanced Features

### 1. Using Forgetting Policy

#### What is Forgetting Policy?

Forgetting policy is a system that manages memory lifespan. It mimics human memory systems by:

- **Automatic Forgetting**: Automatically deleting old and unused memories
- **Spaced Repetition**: Periodically reviewing important memories to strengthen them
- **TTL Management**: Applying different lifespan policies by memory type

#### Applying Forgetting Policy

```typescript
// Apply basic forgetting policy
const result = await client.callTool('apply_forgetting_policy', {});

console.log('Soft deleted memories:', result.softDeleted);
console.log('Hard deleted memories:', result.hardDeleted);
console.log('Memories scheduled for review:', result.scheduledForReview);
```

#### Custom Forgetting Policy

```typescript
// Apply forgetting policy with custom settings
const result = await client.callTool('apply_forgetting_policy', {
  config: {
    forgetThreshold: 0.7,        // Forgetting threshold (0.7)
    softDeleteThreshold: 0.7,    // Soft delete threshold (0.7)
    hardDeleteThreshold: 0.9,    // Hard delete threshold (0.9)
    ttlSoft: {
      working: 3,      // Working memory 3 days
      episodic: 45,    // Episodic memory 45 days
      semantic: 200,   // Semantic memory 200 days
      procedural: 120  // Procedural memory 120 days
    }
  }
});
```

#### Spaced Repetition Scheduling

```typescript
// Create review schedule
const schedule = await client.callTool('schedule_review', {
  memory_id: 'memory-123',
  features: {
    importance: 0.8,        // Importance 80%
    usage: 0.6,            // Usability 60%
    helpful_feedback: 0.7, // Helpful feedback 70%
    bad_feedback: 0.1      // Bad feedback 10%
  }
});

console.log('Next review date:', schedule.next_review);
console.log('Recall probability:', schedule.recall_probability);
```

### 2. Using HTTP Server

#### What is HTTP Server?

HTTP server is a real-time communication server that supports WebSocket. It is designed for communication with web clients.

#### Starting HTTP Server

```bash
# Start HTTP server
npm run dev:http

# Or run directly
node dist/server/http-server.js
```

#### WebSocket Connection

```javascript
// WebSocket connection from web client
const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('WebSocket connected');
  
  // Send MCP message
  ws.send(JSON.stringify({
    method: 'tools/call',
    params: {
      name: 'remember',
      arguments: {
        content: 'Memory stored from web',
        type: 'episodic'
      }
    },
    id: 'web-1'
  }));
});

ws.on('message', (data) => {
  const response = JSON.parse(data);
  console.log('Server response:', response);
});
```

### 3. Session Summary

You can summarize conversation sessions and store them as memories.

```
@memento summarize_thread session-456 --importance 0.8
```

### 4. Creating Memory Relationships

You can set relationships between memories to get better search results.

```
@memento link memory-123 memory-456 --relation "derived_from"
```

Available relationship types:
- `cause_of`: Cause relationship
- `derived_from`: Derived relationship
- `duplicates`: Duplicate relationship
- `contradicts`: Contradiction relationship

### 5. Exporting Memories

You can export stored memories in various formats.

#### JSON Format

```
@memento export --format json --type "episodic,semantic"
```

#### CSV Format

```
@memento export --format csv --tags "programming,react"
```

#### Markdown Format

```
@memento export --format markdown --from "2024-01-01"
```

### 4. Providing Feedback

You can provide feedback on memory usefulness to improve search quality.

```
@memento feedback memory-123 --helpful true --comment "Very useful information"
```

## Memory Type Usage

### Working Memory

Temporarily stores currently processing information.

```
@memento remember "Current bug fix work in progress" --type "working"
```

- **Features**: Automatically deleted after 48 hours
- **Usage**: Maintain current work context

### Episodic Memory

Stores events and experiences.

```
@memento remember "Decisions made in today's meeting" --type "episodic" --tags "meeting,decision"
```

- **Features**: Automatically deleted after 90 days (if not pinned)
- **Usage**: Project progress, meeting content, experiences

### Semantic Memory

Stores knowledge and facts.

```
@memento remember "Basic concepts and usage of React Hooks" --type "semantic" --tags "react,hooks,knowledge"
```

- **Features**: Preserved indefinitely
- **Usage**: Technical knowledge, guidelines, rules

### Procedural Memory

Stores methods and procedures.

```
@memento remember "Docker container deployment procedure" --type "procedural" --tags "docker,deployment,procedure"
```

- **Features**: Preserved indefinitely
- **Usage**: Work procedures, setup methods, problem-solving processes

## Tag System

### Tag Naming Rules

- **Language/Technology**: `javascript`, `typescript`, `react`, `docker`
- **Category**: `programming`, `design`, `meeting`, `decision`
- **Status**: `todo`, `in-progress`, `completed`, `blocked`
- **Priority**: `critical`, `important`, `nice-to-have`

### Tag Usage Examples

```
@memento remember "Project architecture design" --tags "architecture,design,typescript,important"
```

## Search Tips

### 1. Writing Effective Search Queries

- **Use specific keywords**: "React Hook" > "programming"
- **Utilize synonyms**: Both "JavaScript" and "JS" are searchable
- **Include context**: "Project setup" > "setup"

### 2. Using Filters

- **Type filter**: Search only specific memory types
- **Tag filter**: Search only memories with related tags
- **Time filter**: Search only memories from specific periods

### 3. Interpreting Search Results

- **Score**: Higher scores indicate higher relevance
- **recall_reason**: Explanation of why it was retrieved
- **Tags**: Classification information of the memory

## Troubleshooting

### Common Issues

#### 1. Connection Error

**Symptoms**: Cannot connect to MCP server

**Solutions**:
1. Check if server is running
2. Verify port is correct (default: 8080)
3. Check firewall settings

#### 2. No Search Results

**Symptoms**: No results when searching

**Solutions**:
1. Try different keywords
2. Relax filter conditions
3. Verify memories are actually stored

#### 3. Memory Shortage

**Symptoms**: Server performance degradation, response delays

**Solutions**:
1. Clean up old memories
2. Delete unnecessary memories
3. Check server resources

### Log Checking

#### M1 (Local)

```bash
# Check server logs
npm run logs

# Check database status
npm run db:status
```

#### M2+ (Docker)

```bash
# Check container logs
docker-compose logs memento-server

# Check container status
docker-compose ps
```

### Performance Optimization

#### 1. Memory Cleanup

Regularly clean up unnecessary memories:

```bash
# Clean up old working memories
@memento forget --type "working" --older-than "2 days"

# Clean up duplicate memories
@memento cleanup --duplicates
```

#### 2. Index Optimization

```bash
# Rebuild search indexes
@memento optimize --indexes
```

## FAQ

### Q: Are memories automatically deleted?

A: Yes, memories are automatically deleted based on type:
- Working memory: After 48 hours
- Episodic memory: After 90 days (if not pinned)
- Semantic/Procedural memory: Not automatically deleted

### Q: How to preserve memories permanently?

A: Use the `pin` command to exclude memories from automatic deletion:

```
@memento pin memory-123
```

### Q: How to improve search result accuracy?

A: Try these methods:
1. Use more specific search queries
2. Add related tags
3. Provide feedback to improve learning

### Q: How to separate memories from multiple projects?

A: Use tags or project IDs:

```
@memento remember "Project A related content" --tags "project-a"
@memento recall "project-a" --tags "project-a"
```

### Q: Can I share memories with others?

A: Team sharing is available in M2+ version:

```
@memento remember "Team shared information" --privacy-scope "team"
```

### Q: How to backup?

A: Use the `export` command to backup:

```bash
# Full backup
@memento export --format json > backup.json

# Backup specific period
@memento export --format json --from "2024-01-01" > backup-2024.json
```

## Additional Resources

- [API Reference Documentation](api-reference.md)
- [Developer Guide](developer-guide.md)
- [Troubleshooting Guide](troubleshooting.md)
- [GitHub Repository](https://github.com/your-org/memento)
- [Community Forum](https://github.com/your-org/memento/discussions)
