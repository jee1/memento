# Issue 233 LLM Mock Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a metadata-bearing LLM adapter contract and deterministic mock provider for the personal knowledge agent loop.

**Architecture:** The `personal-agent` domain keeps `ILLMPort` as the boundary. `PersonalKnowledgeAgentService` consumes the result object but preserves the existing `llmResponse` string field, while exposing safe provider metadata separately. The deterministic mock adapter lives under `adapters/` and has no network, file I/O, or provider SDK dependency.

**Tech Stack:** TypeScript ESM, Node.js built-in `crypto`, Vitest, npm workspaces.

---

## File Structure

- Modify: `packages/memento-core/src/domains/personal-agent/ports/llm-port.ts`
  Owns LLM message, completion result, provider metadata, and `ILLMPort`.
- Modify: `packages/memento-core/src/domains/personal-agent/types/agent-types.ts`
  Adds `llmMetadata` to `PersonalKnowledgeAgentResult`.
- Modify: `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.ts`
  Maps `LLMCompletionResult.content` and `.metadata` into the agent result.
- Modify: `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts`
  Updates mocks for the new LLM result shape and adds a real mock-adapter integration case.
- Create: `packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.ts`
  Implements deterministic, fixture-capable mock LLM adapter.
- Create: `packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.spec.ts`
  Verifies deterministic output, fixture priority, input sensitivity, and safe metadata.
- Modify: `packages/memento-core/src/domains/personal-agent/index.ts`
  Exports new LLM types and mock adapter.

---

### Task 1: Extend The LLM Contract Tests

**Files:**
- Modify: `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/types/agent-types.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/ports/llm-port.ts`

- [ ] **Step 1: Update the service test mock to expect metadata-bearing LLM results**

Replace `makeDeps()` and the first test in `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts` with:

```typescript
  function makeDeps() {
    const completeFn = vi.fn().mockResolvedValue({
      content: 'LLM 응답',
      metadata: {
        provider: 'mock',
        model: 'deterministic-mock-v1',
        requestId: 'mock-123',
      },
    });
    const buildContextFn = vi.fn().mockResolvedValue('컨텍스트 텍스트');
    const proposeCandidatesFn = vi.fn().mockResolvedValue(undefined);
    const persistFn = vi.fn().mockResolvedValue(undefined);

    const llm = { complete: completeFn } as unknown as ILLMPort;
    const context = { buildContext: buildContextFn, proposeCandidates: proposeCandidatesFn } as unknown as IContextPort;
    const persistence = { persist: persistFn } as unknown as IPersistencePort;

    return { llm, context, persistence, completeFn, buildContextFn, proposeCandidatesFn, persistFn };
  }

  it('mock dependency로 한 턴을 실행하고 llmResponse와 metadata를 반환한다', async () => {
    const { llm, context, persistence } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    const result = await svc.runOneTurn({ userMessage: '테스트 입력' });

    expect(result.llmResponse).toBe('LLM 응답');
    expect(result.llmMetadata).toEqual({
      provider: 'mock',
      model: 'deterministic-mock-v1',
      requestId: 'mock-123',
    });
    expect(result.persisted).toBe(false);
    expect(result.candidates).toEqual([]);
  });
```

- [ ] **Step 2: Update the complete-call expectation**

Keep the existing test name `llm.complete를 system+user 메시지로 호출한다`, but the expected call stays the same:

```typescript
    expect(completeFn).toHaveBeenCalledWith([
      { role: 'system', content: '컨텍스트 텍스트' },
      { role: 'user', content: '질문' },
    ]);
```

The point of this step is to confirm the input contract does not change while the return contract does.

- [ ] **Step 3: Run the service spec and confirm the planned failure**

Run:

```bash
npx vitest run packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts
```

Expected: FAIL because `PersonalKnowledgeAgentService` still treats the LLM result as a string and does not return `llmMetadata`.

- [ ] **Step 4: Extend the port and result types**

Replace `packages/memento-core/src/domains/personal-agent/ports/llm-port.ts` with:

```typescript
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProviderMetadata {
  provider: 'mock' | 'openai' | 'gemini' | 'ollama';
  model?: string;
  requestId?: string;
  finishReason?: string;
}

export interface LLMCompletionResult {
  content: string;
  metadata: LLMProviderMetadata;
}

export interface ILLMPort {
  complete(messages: LLMMessage[]): Promise<LLMCompletionResult>;
}
```

In `packages/memento-core/src/domains/personal-agent/types/agent-types.ts`, add the import and field:

```typescript
import type { LLMProviderMetadata } from '../ports/llm-port.js';

export interface KnowledgeCandidate {
  content: string;
  type: 'episodic' | 'semantic' | 'procedural';
  importance: number;
  tags: string[];
  sourceContext?: string;
}

export interface PersonalKnowledgeAgentInput {
  userMessage: string;
  sessionId?: string;
  projectId?: string;
}

export interface PersonalKnowledgeAgentResult {
  candidates: KnowledgeCandidate[];
  llmResponse: string;
  llmMetadata?: LLMProviderMetadata;
  persisted: boolean;
}
```

- [ ] **Step 5: Update the service implementation**

In `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.ts`, replace the `llm.complete()` call and return with:

```typescript
    const llmResult = await this.deps.llm.complete([
      { role: 'system', content: contextText },
      { role: 'user', content: input.userMessage },
    ]);

    // #234에서 실제 후보 추출 구현
    const candidates: KnowledgeCandidate[] = [];
    await this.deps.context.proposeCandidates(candidates);

    // #235에서 승인 흐름 구현
    await this.deps.persistence.persist(candidates);

    return {
      candidates,
      llmResponse: llmResult.content,
      llmMetadata: llmResult.metadata,
      persisted: false,
    };
```

- [ ] **Step 6: Run the service spec**

Run:

```bash
npx vitest run packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/memento-core/src/domains/personal-agent/ports/llm-port.ts packages/memento-core/src/domains/personal-agent/types/agent-types.ts packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.ts packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts
git commit -m "feat(personal-agent): add llm completion metadata contract"
```

---

### Task 2: Add Failing Tests For The Deterministic Mock Adapter

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.spec.ts`

- [ ] **Step 1: Create the adapter spec**

Create `packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { DeterministicMockLlmAdapter } from './deterministic-mock-llm-adapter.js';
import type { LLMMessage } from '../ports/llm-port.js';

describe('DeterministicMockLlmAdapter', () => {
  const messages: LLMMessage[] = [
    { role: 'system', content: 'context' },
    { role: 'user', content: 'hello' },
  ];

  it('같은 입력에 같은 응답과 requestId를 반환한다', async () => {
    const adapter = new DeterministicMockLlmAdapter();

    const first = await adapter.complete(messages);
    const second = await adapter.complete(messages);

    expect(second).toEqual(first);
  });

  it('다른 입력에 다른 requestId를 반환한다', async () => {
    const adapter = new DeterministicMockLlmAdapter();

    const first = await adapter.complete(messages);
    const second = await adapter.complete([
      { role: 'system', content: 'context' },
      { role: 'user', content: 'different' },
    ]);

    expect(second.metadata.requestId).not.toBe(first.metadata.requestId);
  });

  it('fixture 응답을 기본 응답보다 우선한다', async () => {
    const adapter = new DeterministicMockLlmAdapter();
    const initial = await adapter.complete(messages);
    const fixtureAdapter = new DeterministicMockLlmAdapter({
      fixtures: {
        [initial.metadata.requestId ?? '']: 'fixture response',
      },
    });

    const result = await fixtureAdapter.complete(messages);

    expect(result.content).toBe('fixture response');
    expect(result.metadata.requestId).toBe(initial.metadata.requestId);
  });

  it('안전한 mock provider metadata만 반환한다', async () => {
    const adapter = new DeterministicMockLlmAdapter({ model: 'test-model' });

    const result = await adapter.complete(messages);

    expect(result.metadata).toEqual({
      provider: 'mock',
      model: 'test-model',
      requestId: result.metadata.requestId,
      finishReason: 'stop',
    });
    expect(Object.keys(result.metadata).sort()).toEqual([
      'finishReason',
      'model',
      'provider',
      'requestId',
    ]);
  });
});
```

- [ ] **Step 2: Run the new spec and confirm the planned failure**

Run:

```bash
npx vitest run packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.spec.ts
```

Expected: FAIL because `deterministic-mock-llm-adapter.ts` does not exist.

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.spec.ts
git commit -m "test(personal-agent): cover deterministic mock llm adapter"
```

---

### Task 3: Implement The Deterministic Mock Adapter

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.ts`
- Test: `packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.spec.ts`

- [ ] **Step 1: Implement the adapter**

Create `packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.ts`:

```typescript
import { createHash } from 'node:crypto';
import type {
  ILLMPort,
  LLMCompletionResult,
  LLMMessage,
} from '../ports/llm-port.js';

export interface DeterministicMockLlmAdapterOptions {
  model?: string;
  fixtures?: Record<string, string>;
}

export class DeterministicMockLlmAdapter implements ILLMPort {
  private readonly model: string;
  private readonly fixtures: Record<string, string>;

  constructor(options: DeterministicMockLlmAdapterOptions = {}) {
    this.model = options.model ?? 'deterministic-mock-v1';
    this.fixtures = options.fixtures ?? {};
  }

  async complete(messages: LLMMessage[]): Promise<LLMCompletionResult> {
    const requestId = this.createRequestId(messages);
    const content = this.fixtures[requestId] ?? `Mock response: ${requestId}`;

    return {
      content,
      metadata: {
        provider: 'mock',
        model: this.model,
        requestId,
        finishReason: 'stop',
      },
    };
  }

  private createRequestId(messages: LLMMessage[]): string {
    const stablePayload = JSON.stringify(messages.map((message) => ({
      role: message.role,
      content: message.content,
    })));
    const digest = createHash('sha256').update(stablePayload).digest('hex').slice(0, 16);

    return `mock-${digest}`;
  }
}
```

- [ ] **Step 2: Run the adapter spec**

Run:

```bash
npx vitest run packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.ts
git commit -m "feat(personal-agent): add deterministic mock llm adapter"
```

---

### Task 4: Wire Exports And Agent Loop Mock Integration

**Files:**
- Modify: `packages/memento-core/src/domains/personal-agent/index.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts`

- [ ] **Step 1: Export new public types and adapter**

Replace `packages/memento-core/src/domains/personal-agent/index.ts` with:

```typescript
export type {
  KnowledgeCandidate,
  PersonalKnowledgeAgentInput,
  PersonalKnowledgeAgentResult,
} from './types/agent-types.js';

export type {
  LLMCompletionResult,
  LLMMessage,
  LLMProviderMetadata,
  ILLMPort,
} from './ports/llm-port.js';
export type { IContextPort } from './ports/context-port.js';
export type { IPersistencePort } from './ports/persistence-port.js';

export {
  DeterministicMockLlmAdapter,
} from './adapters/deterministic-mock-llm-adapter.js';
export type {
  DeterministicMockLlmAdapterOptions,
} from './adapters/deterministic-mock-llm-adapter.js';

export {
  PersonalKnowledgeAgentService,
} from './services/personal-knowledge-agent-service.js';
export type { PersonalKnowledgeAgentDeps } from './services/personal-knowledge-agent-service.js';
```

- [ ] **Step 2: Add a real mock adapter integration test**

At the top of `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts`, add:

```typescript
import { DeterministicMockLlmAdapter } from '../adapters/deterministic-mock-llm-adapter.js';
```

Add this test before the reject propagation test:

```typescript
  it('deterministic mock adapter로 외부 API 없이 한 턴을 실행한다', async () => {
    const { context, persistence } = makeDeps();
    const llm = new DeterministicMockLlmAdapter({
      fixtures: {
        'mock-5b832cfd931a7db9': 'fixture 기반 응답',
      },
    });
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    const result = await svc.runOneTurn({ userMessage: '질문' });

    expect(result.llmResponse).toBe('fixture 기반 응답');
    expect(result.llmMetadata).toEqual({
      provider: 'mock',
      model: 'deterministic-mock-v1',
      requestId: 'mock-5b832cfd931a7db9',
      finishReason: 'stop',
    });
  });
```

- [ ] **Step 3: Run both personal-agent specs**

Run:

```bash
npx vitest run packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/memento-core/src/domains/personal-agent/index.ts packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts
git commit -m "test(personal-agent): run agent loop with mock llm adapter"
```

---

### Task 5: Final Verification And Knowledge Graph Refresh

**Files:**
- Verify only, no intended source edits.
- Generated/updated: `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.json`, and related graphify cache files if the graph rebuild changes them.

- [ ] **Step 1: Run targeted specs**

Run:

```bash
npx vitest run packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run core type-check**

Run:

```bash
npm run type-check -w @memento/core
```

Expected: PASS.

If dependency installation is still blocked by `sharp` failing to compile with missing `vips/vips8`, record the exact failure in the final handoff and do not claim local type-check passed.

- [ ] **Step 3: Run repository type-check if dependencies are available**

Run:

```bash
npm run type-check
```

Expected: PASS.

If workspace dependencies are incomplete, skip this after documenting the install failure from `npm install`.

- [ ] **Step 4: Refresh graphify**

Run:

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: command exits successfully and updates graphify outputs if the code graph changed.

- [ ] **Step 5: Review final diff**

Run:

```bash
git status --short
git diff --stat HEAD
git diff -- packages/memento-core/src/domains/personal-agent docs/superpowers/specs/2026-05-10-issue-233-llm-mock-adapter-design.md docs/superpowers/plans/2026-05-10-issue-233-llm-mock-adapter.md
```

Expected: only issue #233 files and graphify refresh outputs are changed.

- [ ] **Step 6: Commit verification artifacts if graphify changed**

If graphify outputs changed, run:

```bash
git add graphify-out packages/memento-core/graphify-out
git commit -m "chore(graphify): refresh graph after issue 233"
```

If graphify outputs did not change, do not create an empty commit.

---

## Verification Notes

The current issue worktree previously hit an `npm install` failure while building `@xenova/transformers`' nested `sharp` dependency because `vips/vips8` was missing. Implementation should still attempt the targeted Vitest and type-check commands. If they cannot run due to incomplete dependencies, the final report must say exactly which commands were blocked and include the first actionable native dependency error.
