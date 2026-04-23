# Architectural Refactoring: Compliance Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor domain repositories to remove infrastructure dependencies (SQLite) and align with "Functional Core, Structured Shell" principles.

**Architecture:** 
1. Define interfaces in `domains/memory/repositories/`.
2. Move SQLite implementations to `infrastructure/database/repositories/`.
3. Update domain services to depend on interfaces (DIP).
4. Maintain backward compatibility via `@deprecated` re-exports.

**Tech Stack:** TypeScript, better-sqlite3, Vitest

---

### Task 1: Knowledge Vault Repository Refactoring

**Files:**
- Create: `packages/memento-core/src/domains/memory/repositories/knowledge-vault-repository.interface.ts`
- Create: `packages/memento-core/src/infrastructure/database/repositories/knowledge-vault-repository-sqlite.impl.ts`
- Modify: `packages/memento-core/src/domains/memory/services/knowledge-vault-service.ts`
- Modify: `packages/memento-core/src/domains/memory/repositories/knowledge-vault-repository.ts`

- [ ] **Step 1: Create KnowledgeVaultRepository interface**
Define the interface and associated types in the domain layer.

```typescript
export interface KnowledgeVaultRecord {
  vault_id: string;
  agent_id: string;
  key: string;
  value: string;
  immutable: boolean;
  version: number;
  previous_version_id?: string | null;
  admin_override: boolean;
  deleted_at?: string | null;
  origin_source?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeVaultInput {
  vault_id: string;
  agent_id?: string;
  key: string;
  value: string;
  immutable?: boolean;
  version?: number;
  previous_version_id?: string | null;
  admin_override?: boolean;
  deleted_at?: string | null;
  origin_source?: string | null;
}

export interface UpdateKnowledgeVaultInput {
  value?: string;
  immutable?: boolean;
  admin_override?: boolean;
  origin_source?: string | null;
}

export interface KnowledgeVaultRepository {
  create(input: CreateKnowledgeVaultInput): Promise<KnowledgeVaultRecord>;
  findById(vault_id: string): Promise<KnowledgeVaultRecord | null>;
  findActiveByKey(agent_id: string, key: string): Promise<KnowledgeVaultRecord | null>;
  findByKeyAndVersion(agent_id: string, key: string, version: number): Promise<KnowledgeVaultRecord | null>;
  findAllVersionsByKey(agent_id: string, key: string): Promise<KnowledgeVaultRecord[]>;
  findActiveByAgentId(agent_id: string): Promise<KnowledgeVaultRecord[]>;
  findByAgentId(agent_id: string): Promise<KnowledgeVaultRecord[]>;
  update(vault_id: string, input: UpdateKnowledgeVaultInput): Promise<KnowledgeVaultRecord | null>;
  delete(vault_id: string): Promise<boolean>;
  deleteActiveByKey(agent_id: string, key: string): Promise<boolean>;
  hardDelete(vault_id: string): Promise<boolean>;
  findAll(): Promise<KnowledgeVaultRecord[]>;
  findAllActive(): Promise<KnowledgeVaultRecord[]>;
  count(agent_id?: string, activeOnly?: boolean): Promise<number>;
  getNextVersion(agent_id: string, key: string): Promise<number>;
}
```

- [ ] **Step 2: Create SQLite implementation in infrastructure**
Move existing logic to `infrastructure/database/repositories/knowledge-vault-repository-sqlite.impl.ts`. Use specific types instead of `any[]`.

```typescript
import type Database from 'better-sqlite3';
import type { 
  KnowledgeVaultRepository, 
  KnowledgeVaultRecord, 
  CreateKnowledgeVaultInput, 
  UpdateKnowledgeVaultInput 
} from '../../../domains/memory/repositories/knowledge-vault-repository.interface.js';

export class KnowledgeVaultRepositorySqlite implements KnowledgeVaultRepository {
  constructor(private readonly db: Database.Database) {}
  // ... (Implement all methods from interface using original logic)
}
```

- [ ] **Step 3: Update KnowledgeVaultService to use the interface**
Change constructor parameter type from `KnowledgeVaultRepository` (class) to `KnowledgeVaultRepository` (interface).

- [ ] **Step 4: Update original repository file for backward compatibility**
Mark as `@deprecated` and re-export from the interface.

- [ ] **Step 5: Run tests and type check**
Run: `npm run type-check && npm test packages/memento-core/src/domains/memory/services/__tests__/knowledge-vault-service.spec.ts`

- [ ] **Step 6: Commit Phase 1**
```bash
git add .
git commit -m "refactor(core): decouple KnowledgeVaultRepository from SQLite"
```

### Task 2: Feedback Repository Refactoring

**Files:**
- Create: `packages/memento-core/src/domains/memory/repositories/feedback-repository.interface.ts`
- Create: `packages/memento-core/src/infrastructure/database/repositories/feedback-repository-sqlite.impl.ts`
- Modify: `packages/memento-core/src/domains/memory/repositories/feedback-repository.ts`

- [ ] **Step 1: Extract FeedbackRepository interface**
- [ ] **Step 2: Move implementation to infrastructure/database/repositories/**
- [ ] **Step 3: Update original repository with @deprecated re-exports**
- [ ] **Step 4: Run tests**
Run: `npm test packages/memento-core/src/domains/memory/repositories/__tests__/feedback-repository.spec.ts`
- [ ] **Step 5: Commit Phase 2**

### Task 3: KgTriple Repository Refactoring

**Files:**
- Create: `packages/memento-core/src/domains/memory/repositories/kg-triple-repository.interface.ts`
- Create: `packages/memento-core/src/infrastructure/database/repositories/kg-triple-repository-sqlite.impl.ts`
- Modify: `packages/memento-core/src/domains/memory/repositories/kg-triple-repository.ts`

- [ ] **Step 1: Extract KgTripleRepository interface**
- [ ] **Step 2: Move implementation to infrastructure/database/repositories/**
- [ ] **Step 3: Update original repository with @deprecated re-exports**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit Phase 3**

### Task 4: Process Attribute Repository Refactoring

**Files:**
- Create: `packages/memento-core/src/domains/memory/repositories/process-attribute-repository.interface.ts`
- Create: `packages/memento-core/src/infrastructure/database/repositories/process-attribute-repository-sqlite.impl.ts`
- Modify: `packages/memento-core/src/domains/memory/repositories/process-attribute-repository.ts`

- [ ] **Step 1: Extract ProcessAttributeRepository interface**
- [ ] **Step 2: Move implementation to infrastructure/database/repositories/**
- [ ] **Step 3: Update original repository with @deprecated re-exports**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit Phase 4**

### Task 5: Final Verification & Cleanup

- [ ] **Step 1: Final build and type check**
Run: `npm run build && npm run type-check`
- [ ] **Step 2: Full test suite run**
Run: `npm test`
- [ ] **Step 3: Final commit**
