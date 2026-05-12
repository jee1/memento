# Developer Guide

## Overview

This guide explains the development environment setup, architecture understanding, and contribution methods for Memento MCP Server.

## Table of Contents

1. [Development Environment Setup](#development-environment-setup)
2. [Project Structure](#project-structure)
3. [Architecture Understanding](#architecture-understanding)
4. [Development Workflow](#development-workflow)
5. [Test Writing](#test-writing)
6. [Contribution Methods](#contribution-methods)

## Development Environment Setup

### Prerequisites

- **Node.js**: 24.0.0 or higher (package.json standard)
- **npm**: 10.0.0 or higher

### Repository Guidelines (`AGENTS.md`)

The project includes developer guidelines:

- **Project Structure**: npm workspaces monorepo — `packages/memento-core`, `packages/memento-server`, `packages/memento-client`, `apps/*`. MCP/HTTP entry points live in `packages/memento-server`; domain and infrastructure code live in `packages/memento-core`.
- **Build/Test Commands**: `npm run dev`, `npm run build`, `npm run test`, etc.
- **Coding Style**: Node.js ≥ 24, TypeScript ES modules, 2-space indentation
- **Testing Guidelines**: Vitest based with clear naming conventions:
  - Unit Tests (`.spec.ts`): Colocated under domains (e.g., `packages/memento-core/src/domains/search/algorithms/__tests__/search-engine.spec.ts`)
  - Scenario / benchmark scripts (`test-*.ts`): Under `packages/memento-core/src/test/` (e.g., `packages/memento-core/src/test/test-client.ts`) and root `tests/**` where applicable
- **Commit/PR Guidelines**: Conventional Commits, Korean context included
- **Environment/Database**: `.env` configuration, `data/` folder management
- **TypeScript**: 5.3.0 (actual implementation standard)
- **Git**: 2.30.0 or higher

### Development Tools

- **IDE**: VS Code (recommended)
- **Extensions**:
  - TypeScript and JavaScript Language Features
  - ESLint
  - Prettier
  - Vitest (actually used)
  - GitLens

### Environment Setup

#### 1. Clone Repository

```bash
git clone https://github.com/your-org/memento.git
cd memento
```

#### 2. Install Dependencies

```bash
# Install all dependencies (package.json standard)
npm install

# Actually used dependencies:
# - @modelcontextprotocol/sdk: ^1.18.2
# - better-sqlite3: ^12.4.1
# - express: ^5.1.0
# - cors: ^2.8.5
# - ws: ^8.18.3
# - zod: ^3.22.4
# - uuid: ^9.0.1
# - openai: ^4.20.1
# - @google/genai: ^1.21.0
# - sqlite-vec: ^0.1.6
# - dotenv: ^16.3.1
# - vitest: ^1.0.0 (test)
# - tsx: ^4.6.0 (development)
```

#### 3. Environment Variable Setup

```bash
# Copy environment variable file
cp env.example .env

# Edit environment variables
# Edit .env file to enter necessary settings
```

#### 4. Database Initialization

```bash
# Initialize better-sqlite3 database
npm run db:init

# Database migration
npm run db:migrate
```

#### 5. Start Development Server

```bash
# MCP server development mode (hot reload)
npm run dev

# HTTP/WebSocket server development mode
npm run dev:http

# Run tests in separate terminal
npm run test -- --watch
```

### VS Code Setup

#### .vscode/settings.json

```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "vitest.commandLine": "npm run test",
  "vitest.autoRun": "watch"
}
```

#### .vscode/launch.json

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug MCP Server",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/packages/memento-server/src/server/index.ts",
      "outFiles": ["${workspaceFolder}/packages/memento-server/dist/**/*.js"],
      "env": {
        "NODE_ENV": "development"
      },
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/vitest",
      "args": ["--run"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

## Project Structure

### Monorepo layout

The repository is an **npm workspaces** monorepo.

| Package | Role |
|--------|------|
| **packages/memento-core** | Domains (memory, search, anchor, forgetting, …), infrastructure, shared utilities. Entry points include `createMementoCore`, `createToolContext`, `getToolRegistry`. |
| **packages/memento-server** | MCP / HTTP server; consumes core and exposes tools and routes. Entry points: `index.ts`, `http-server.ts`. |
| **packages/memento-client** | Client library for connecting to the server (`@memento/client`). |
| **apps/** | Experimental apps (e.g. `experimental-example` uses `@memento/core` in-process). |

### Domain-based architecture (core)

Domain logic lives under **`packages/memento-core/src/domains/`**.

```
packages/memento-core/src/domains/
├── memory/                           # Memory domain
│   ├── services/                     # Memory services
│   ├── tools/                        # Memory MCP tools
│   └── ...
├── search/                           # Search domain
│   ├── algorithms/                   # Search algorithms
│   └── ...
├── anchor/                           # Anchor system domain
│   ├── services/                     # Anchor services
│   ├── tools/                        # Anchor MCP tools
│   └── ...
├── monitoring/                       # Monitoring domain
│   ├── services/                     # Monitoring services
│   ├── tools/                        # Monitoring MCP tools
│   └── ...
└── forgetting/                       # Forgetting domain
    ├── services/                     # Forgetting services
    └── ...
```

**Service layer responsibilities**:
- **External API integration**: OpenAI API, database access
- **Business logic**: Embedding generation, vector search, similarity scoring
- **Error handling**: API failures, retries
- **Caching**: Embedding caches, performance tuning
- **Fallback**: Lightweight hybrid embedding when remote APIs are unavailable
- **Performance**: Async paths, cache and DB tuning
- **Monitoring**: Live performance metrics

### Hybrid search (core)

Hybrid search lives under **`packages/memento-core/src/domains/search/`** (e.g. `hybrid-search-engine.ts`, `search-engine.ts`, `search-ranking.ts`).

**Hybrid search behavior**:
- **FTS5 + vector**: Text and vector search combined
- **Default blend**: Vector 60%, text 40%
- **Score normalization**: Scores mapped to a 0–1 range
- **Result fusion**: Single ranked list from both signals

### Repository tree (high level)

```
memento/
├── packages/
│   ├── memento-core/           # @memento/core — domains, infra, shared
│   │   └── src/
│   │       ├── domains/        # memory, search, anchor, forgetting, embedding, relation, …
│   │       ├── infrastructure/ # DB, cache, scheduler
│   │       ├── shared/         # types, utils, config helpers
│   │       ├── tools/          # tool registry, migrate-embeddings, …
│   │       ├── test/           # scenario / benchmark drivers (tsx)
│   │       └── bootstrap.ts, context.ts
│   ├── memento-server/         # MCP / HTTP server (uses core)
│   │   └── src/server/
│   │       ├── index.ts        # MCP stdio entry
│   │       ├── http-server.ts  # HTTP / WebSocket entry
│   │       ├── routes/         # MCP, admin, API routes
│   │       ├── middleware/     # tool-context, error-handler, …
│   │       └── servers/        # stdio, SSE implementations
│   └── memento-client/         # @memento/client
│       └── src/
├── apps/                       # Experimental apps
├── tests/                      # Root Vitest specs (integration gates, …)
├── docs/                       # Documentation
├── scripts/                    # Root scripts (auto-setup, check-migration, …)
├── package.json                # workspaces, root npm scripts
└── AGENTS.md                   # Detailed agent / developer guide
```

## Architecture Understanding

### Overall Architecture

```mermaid
graph TB
    subgraph "AI Agent Layer"
        A[Claude Desktop] --> B[MCP Client]
        C[ChatGPT] --> B
        D[Cursor] --> B
    end
    
    subgraph "MCP Protocol Layer"
        B --> E[MCP Memory Server]
    end
    
    subgraph "Memory Management Layer"
        E --> F[Memory Manager]
        E --> G[Search Engine]
        E --> H[Forgetting Policy]
    end
    
    subgraph "Storage Layer"
        F --> I[SQLite M1]
        F --> J[PostgreSQL M3+]
        G --> K[Vector Search]
        G --> L[Text Search]
    end
```

### Core Components

#### 1. MCP Server (`packages/memento-server/src/server/`)

The core server implementing the MCP protocol.

**Key Files**:
- `index.ts`: MCP stdio entry point
- `http-server.ts`: HTTP / WebSocket entry point
- `routes/`: MCP, admin, and API routes
- `middleware/`: tool-context, error-handler, etc.

**Example Code**:
```typescript
// packages/memento-server/src/server/index.ts
// Uses createMementoCore, getToolRegistry, etc. from @memento/core to wire the MCP server

const server = new Server({
  name: 'memento-memory-server',
  version: '0.1.0'
});

// Register tools
server.tool('remember', rememberTool);
server.tool('recall', recallTool);

// Start server
server.start();
```

#### 2. Search Engine (`packages/memento-core/src/domains/search/algorithms/`)

Implements algorithms used for memory search.

**Key Files** (partial list):
- `search-ranking.ts`, `search-engine.ts`, `hybrid-search-engine.ts`, `vector-search-engine.ts`
- Forgetting / spaced repetition: `packages/memento-core/src/domains/forgetting/algorithms/` (`forgetting-algorithm.ts`, `spaced-repetition-refactored.ts`, etc.)

**Example Code**:
```typescript
// packages/memento-core/src/domains/search/algorithms/search-ranking.ts
export class SearchRanking {
  calculateFinalScore(features: SearchFeatures): number {
    return this.ALPHA * features.relevance +
           this.BETA * features.recency +
           this.GAMMA * features.importance +
           this.DELTA * features.usage -
           this.EPSILON * features.duplication_penalty;
  }
}
```

#### 3. Database·Infrastructure (`packages/memento-core`)

Handles data storage and retrieval.

**Key Files**:
- `sqlite.ts`: SQLite implementation (M1)
- `postgres.ts`: PostgreSQL implementation (M3+)
- `migrations/`: Database migrations

### Data Flow

#### 1. Memory Storage Flow

```
AI Agent → MCP Client → MCP Server → Memory Manager → Database
```

#### 2. Memory Search Flow

```
AI Agent → MCP Client → MCP Server → Search Engine → Database → Ranking → Results
```

## Development Workflow

### 1. Feature Development

#### Create Branch

```bash
# Create feature branch
git checkout -b feature/new-tool

# Or bug fix branch
git checkout -b fix/memory-leak
```

#### Development Progress

```bash
# Start development server
npm run dev

# Run tests (separate terminal)
npm run test:watch

# Lint (TypeScript + static JS)
npm run lint
```

#### Commit

```bash
# Stage changes
git add .

# Commit (conventional commit format)
git commit -m "feat: add new summarize_thread tool"

# Push
git push origin feature/new-tool
```

### 2. Test Writing

#### Unit Tests

```typescript
// tests/unit/tools/remember.test.ts
import { RememberTool } from '@/server/tools/remember';
import { MockDatabase } from '@/tests/mocks/database.mock';

describe('RememberTool', () => {
  let rememberTool: RememberTool;
  let mockDatabase: MockDatabase;

  beforeEach(() => {
    mockDatabase = new MockDatabase();
    rememberTool = new RememberTool(mockDatabase);
  });

  it('should create memory with valid parameters', async () => {
    // Given
    const params = {
      content: 'Test memory',
      type: 'episodic',
      importance: 0.8
    };

    // When
    const result = await rememberTool.execute(params);

    // Then
    expect(result.memory_id).toBeDefined();
    expect(mockDatabase.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Test memory',
        type: 'episodic',
        importance: 0.8
      })
    );
  });
});
```

#### Integration Tests

```typescript
// tests/integration/mcp-server.test.ts
import { MCPClient } from '@modelcontextprotocol/sdk';
import { MCPServer } from '@/server';

describe('MCP Server Integration', () => {
  let server: MCPServer;
  let client: MCPClient;

  beforeAll(async () => {
    server = new MCPServer();
    await server.start();
    
    client = new MCPClient({
      name: 'test-client',
      version: '1.0.0'
    });
    await client.connect({
      command: 'node',
      args: ['packages/memento-server/dist/server/index.js']
    });
  });

  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  it('should handle remember and recall workflow', async () => {
    // Remember
    const rememberResult = await client.callTool('remember', {
      content: 'Integration test memory'
    });

    expect(rememberResult.memory_id).toBeDefined();

    // Recall
    const recallResult = await client.callTool('recall', {
      query: 'integration test'
    });

    expect(recallResult.items).toHaveLength(1);
    expect(recallResult.items[0].content).toContain('Integration test memory');
  });
});
```

### 3. Code Review

#### Create Pull Request

1. Create Pull Request on GitHub
2. Write change description
3. Link related issues
4. Assign reviewers

#### Review Checklist

- [ ] Does the code follow project style guidelines?
- [ ] Are tests sufficiently written?
- [ ] Is documentation updated?
- [ ] Does it affect performance?
- [ ] Are there any security vulnerabilities?

## Test Writing

### Test Strategy

#### 1. Unit Tests

- **Purpose**: Verify individual function/class behavior
- **Scope**: All public methods
- **Tool**: Vitest
- **Location**: `**/*.spec.ts` under `packages/memento-core/src/domains/**/__tests__/`, root `tests/**`, etc.

#### 2. Integration Tests

- **Purpose**: Verify component interactions
- **Scope**: MCP server, database integration
- **Tool**: Vitest
- **Location**: `tests/**`, `packages/memento-core/src/domains/**/__tests__/`, etc.

#### 3. E2E Tests

- **Purpose**: Verify complete workflows
- **Scope**: User scenarios
- **Tool**: Vitest / tsx drivers as defined in `package.json`
- **Location**: `packages/memento-core/src/test/**`, selected scripts under `packages/memento-server/src/test/**`

#### 4. Error Logging Tests

- **Purpose**: Verify error logging system normal operation
- **Scope**: ErrorLoggingService, error statistics, error resolution
- **Tool**: tsx + direct service testing
- **Location**: `packages/memento-server/src/test/test-error-logging.ts`

#### 5. Performance Alert Tests

- **Purpose**: Verify performance alert system normal operation
- **Scope**: PerformanceAlertService, real-time monitoring, alert management
- **Tool**: tsx + direct service testing
- **Location**: `packages/memento-server/src/test/test-performance-alerts.ts`

#### 6. Consolidation Score Quality Tests

- **Purpose**: Verify consolidation score integration with search ranking
- **Scope**: Search ranking algorithm, hybrid search engine, quality metrics
- **Tool**: Vitest (unit/integration) + tsx (E2E/benchmark)
- **Location**: 
  - Unit tests: `packages/memento-core/src/domains/search/algorithms/__tests__/search-ranking.spec.ts`, `packages/memento-core/src/domains/search/algorithms/__tests__/search-result-combiner-consolidation.spec.ts`
  - Integration tests: `packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine-consolidation.spec.ts`
  - E2E tests: `packages/memento-core/src/test/test-consolidation-search-quality.ts`
  - Benchmark: `packages/memento-core/src/test/consolidation-search-quality-benchmark.ts`
- **Commands**:
  - `npm run test:consolidation-quality` - E2E quality validation
  - `npm run benchmark:consolidation-quality` - Quality benchmark with baseline comparison
- **Documentation**: [Consolidation Score Testing Guide](../../_work/testing/ko/consolidation-quality-testing.md)

### Test Writing Guide

#### 1. Test Structure (AAA Pattern)

```typescript
describe('ComponentName', () => {
  describe('methodName', () => {
    it('should do something when condition', async () => {
      // Arrange (Setup)
      const input = createTestInput();
      const expected = createExpectedOutput();
      
      // Act (Execute)
      const result = await component.method(input);
      
      // Assert (Verify)
      expect(result).toEqual(expected);
    });
  });
});
```

#### 2. Mock Usage

```typescript
// Create mock object
const mockDatabase = {
  createMemory: jest.fn(),
  getMemory: jest.fn(),
  searchMemories: jest.fn()
};

// Mock setup
mockDatabase.createMemory.mockResolvedValue('memory-123');

// Mock verification
expect(mockDatabase.createMemory).toHaveBeenCalledWith(expectedParams);
```

#### 3. Test Data Management

```typescript
// tests/fixtures/memories.json
{
  "episodic": [
    {
      "id": "memory-1",
      "content": "Test episodic memory",
      "type": "episodic",
      "importance": 0.8
    }
  ],
  "semantic": [
    {
      "id": "memory-2",
      "content": "Test semantic memory",
      "type": "semantic",
      "importance": 0.9
    }
  ]
}
```

### Test Execution

```bash
# Run all tests (Vitest)
npm test

# Run specific tests
npm run test:client
npm run test:search
npm run test:embedding
npm run test:lightweight-embedding
npm run test:forgetting
npm run test:performance
npm run test:monitoring
npm run test:error-logging
npm run test:performance-alerts

# Tests with coverage
npm run test -- --coverage

# Watch mode
npm run test -- --watch
```

## Contribution Methods

### 1. Create Issues

#### Bug Report

```markdown
**Bug Description**
Brief and clear bug description

**Reproduction Steps**
1. Go to '...'
2. Click on '...'
3. Enter '...'
4. Error occurs

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happened

**Environment**
- OS: [e.g., Windows 10]
- Node.js: [e.g., 24.0.0]
- Memento: [e.g., 0.1.0]
```

#### Feature Request

```markdown
**Feature Description**
Brief and clear description of desired feature

**Use Case**
Why this feature is needed, what problem it solves

**Proposed Solution**
Specific implementation approach (if available)

**Alternatives**
Other solutions considered
```

### 2. Code Contribution

#### Step 1: Fork Repository

1. Fork repository on GitHub
2. Clone locally

```bash
git clone https://github.com/your-username/memento.git
cd memento
```

#### Step 2: Development Environment Setup

```bash
# Add upstream repository
git remote add upstream https://github.com/your-org/memento.git

# Install dependencies
npm install

# Start development server
npm run dev
```

#### Step 3: Feature Development

```bash
# Create new branch
git checkout -b feature/your-feature

# Development progress
# ... write code ...

# Write tests
npm run test

# Commit
git add .
git commit -m "feat: add your feature"
```

#### Step 4: Create Pull Request

1. Push changes
```bash
git push origin feature/your-feature
```

2. Create Pull Request on GitHub
3. Write description according to template
4. Assign reviewers

### 3. Documentation Contribution

#### Documentation Writing Guide

- **Language**: Korean (technical terms in English)
- **Format**: Markdown
- **Structure**: Clear table of contents and section separation
- **Examples**: Real, usable code examples

#### Documentation Updates

1. Modify related documentation files
2. Describe changes
3. Request review

### 4. Commit Message Rules

#### Conventional Commit Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

#### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code formatting
- `refactor`: Code refactoring
- `test`: Test addition/modification
- `chore`: Build process or auxiliary tool changes

#### Examples

```bash
feat(tools): add summarize_thread tool
fix(database): resolve memory leak in SQLite connection
docs(api): update remember tool documentation
test(integration): add MCP server integration tests
```

## Error Logging and Performance Monitoring Development Guide

### Error Logging System

#### 1. Using Error Logging Service

```typescript
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from '../services/error-logging-service.js';

// Initialize error logging service
const errorLoggingService = new ErrorLoggingService();

// Log error
try {
  // Perform risky operation
  await riskyOperation();
} catch (error) {
  errorLoggingService.logError(
    error instanceof Error ? error : new Error(String(error)),
    ErrorSeverity.HIGH,
    ErrorCategory.TOOL_EXECUTION,
    {
      operation: 'risky_operation',
      userId: 'user123',
      timestamp: new Date().toISOString()
    }
  );
}
```

#### 2. Error Statistics Query

```typescript
// Basic error statistics
const stats = await errorLoggingService.getErrorStats();

// Filtered error statistics
const highErrors = await errorLoggingService.getErrorStats({
  severity: ErrorSeverity.HIGH,
  hours: 24
});

// Query only database-related errors
const dbErrors = await errorLoggingService.getErrorStats({
  category: ErrorCategory.DATABASE,
  limit: 10
});
```

#### 3. Error Resolution Processing

```typescript
// Resolve error
const resolved = await errorLoggingService.resolveError(
  'error-123',
  'admin',
  'Database connection issue resolved'
);
```

### Performance Alert System

#### 1. Using Performance Alert Service

```typescript
import { PerformanceAlertService, AlertLevel, AlertType } from '../services/performance-alert-service.js';

// Initialize performance alert service
const alertService = new PerformanceAlertService('./logs');

// Create alert
const alert = alertService.createAlert(
  AlertLevel.WARNING,
  AlertType.RESPONSE_TIME,
  'Average response time',
  150,
  100,
  '🟡 Response time exceeded threshold',
  { component: 'search_engine', operation: 'search' }
);

// Resolve alert
const resolvedAlert = alertService.resolveAlert(
  alert.id,
  'admin',
  'Performance optimization completed'
);
```

#### 2. Real-time Monitoring Setup

```typescript
import { PerformanceMonitoringIntegration } from '../services/performance-monitoring-integration.js';

// Initialize monitoring integration service
const monitoringIntegration = new PerformanceMonitoringIntegration(
  db,
  alertService,
  {
    enableRealTimeMonitoring: true,
    monitoringInterval: 30000, // Check every 30 seconds
    alertThresholds: {
      responseTime: { warning: 100, critical: 500 },
      memoryUsage: { warning: 100, critical: 200 },
      errorRate: { warning: 5, critical: 10 },
      throughput: { warning: 10, critical: 5 }
    }
  }
);

// Start real-time monitoring
monitoringIntegration.startRealTimeMonitoring();
```

### Test Writing

#### 1. Error Logging Tests

```typescript
// packages/memento-server/src/test/test-error-logging.ts
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from './services/error-logging-service.js';

async function testErrorLogging() {
  const errorService = new ErrorLoggingService();
  
  // Test error logging
  errorService.logError(
    new Error('Test error'),
    ErrorSeverity.HIGH,
    ErrorCategory.SYSTEM,
    { test: true }
  );
  
  // Test statistics query
  const stats = errorService.getErrorStats();
  console.log('Error stats:', stats);
  
  // Test error resolution
  const errors = errorService.searchErrors({ limit: 1 });
  if (errors.length > 0) {
    const resolved = errorService.resolveError(
      errors[0].id,
      'test_user',
      'Test resolution'
    );
    console.log('Error resolved:', resolved);
  }
}
```

#### 2. Performance Alert Tests

```typescript
// packages/memento-server/src/test/test-performance-alerts.ts
import { PerformanceAlertService, AlertLevel, AlertType } from './services/performance-alert-service.js';

async function testPerformanceAlerts() {
  const alertService = new PerformanceAlertService('./logs');
  
  // Test alert creation
  const alert = alertService.createAlert(
    AlertLevel.WARNING,
    AlertType.MEMORY_USAGE,
    'Memory usage',
    150,
    100,
    '🟡 Memory usage exceeded'
  );
  
  // Query alert statistics
  const stats = alertService.getStats();
  console.log('Alert stats:', stats);
  
  // Test alert resolution
  const resolved = alertService.resolveAlert(
    alert.id,
    'test_user',
    'Test resolution'
  );
  console.log('Alert resolved:', resolved);
}
```

## Additional Resources

- [API Reference Documentation](../../api/en/api-reference.md)
- [User Manual](user-manual.md)
- [Architecture Documentation](../../architecture/en/architecture.md)
- Tests and quality gates: [AGENTS.md](../../../AGENTS.md) (`npm test`, `npm run lint`, etc.)
- [Cursor Rules](../../../.cursor/rules/)
- [GitHub Repository](https://github.com/your-org/memento)
- [Community Forum](https://github.com/your-org/memento/discussions)
