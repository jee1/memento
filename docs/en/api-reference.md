# API Reference Documentation

## Overview

Memento MCP Server communicates with AI Agents through the Model Context Protocol (MCP). This document provides detailed API reference for all available Tools, Resources, and Prompts.

## 🔄 Lightweight Hybrid Embedding

### Lightweight Embedding Service

A fallback solution used when OpenAI API is not available.

**Features:**
- **TF-IDF + Keyword Matching**: Generates fixed 512-dimensional vectors
- **Multilingual Support**: Korean/English stopword removal and text preprocessing
- **Cosine Similarity**: Search through vector similarity calculations
- **Transparent Interface**: Provides same interface as existing embedding API

**Automatic Fallback:**
- Automatically switches to lightweight service when OpenAI API fails in `EmbeddingService`
- Works transparently without code changes

**Performance Characteristics:**
- **Fast Processing**: Quick response through local TF-IDF calculation
- **Memory Efficient**: Lightweight implementation without pre-trained models
- **Accuracy**: Specialized accuracy for keyword-based search

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

## MCP Tools (Core 5 Only)

> **Important**: MCP client only exposes 5 core memory management functions.  
> Management functions are separated into HTTP API endpoints.  
> See [Administrator API](#administrator-api) section for details.

### remember

Tool for storing memories.

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
// Using the actually implemented client
import { createMementoClient } from './src/client/index.js';

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

Tool for searching memories.

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

### pin / unpin

Tool for pinning or unpinning memories.

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

Tool for deleting memories.

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

## Administrator API

> **Note**: The following functions have been removed from MCP client and separated into HTTP API endpoints.

### Memory Management API

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
- `link` - Memory relationship creation (planned for future implementation)
- `export` - Memory export (planned for future implementation)
- `feedback` - Feedback provision (planned for future implementation)
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

Prompt for injecting related memories into AI Agent's context.

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

For changes during version upgrades, refer to [CHANGELOG.md](../CHANGELOG.md).
