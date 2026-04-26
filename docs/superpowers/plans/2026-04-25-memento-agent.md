# Memento Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/memento-agent` — a new package that answers user queries by combining Memento memories with web search via an LLM, exposed as CLI / independent MCP server / HTTP endpoint.

**Architecture:** `AgentCore` holds the pure recall→search→LLM→remember loop. `LLMProvider` and `SearchProvider` interfaces isolate external dependencies. Three thin interfaces (CLI, MCP, HTTP) share the same `AgentCore` instance. The package depends only on `@memento/client` (HTTP calls), never on `@memento/core`.

**Tech Stack:** TypeScript (ESM), Node.js 20+, Vitest, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, Express 5, `axios` (via `@memento/client`)

**Spec:** `docs/superpowers/specs/2026-04-25-memento-agent-design.md`

---

## File Map

```
packages/memento-agent/
  src/
    core/
      types.ts                      # AskResult, Message, AgentConfig
      agent-core.ts                 # AgentCore class
      agent-core.spec.ts            # unit tests for AgentCore
    providers/
      llm/
        llm-provider.ts             # interface LLMProvider
        claude-provider.ts          # ClaudeProvider (@anthropic-ai/sdk)
        claude-provider.spec.ts
        noop-llm-provider.ts        # stub for tests
        llm-factory.ts              # env→provider factory
      search/
        search-provider.ts          # interface SearchProvider
        noop-search-provider.ts     # always returns []
        brave-search-provider.ts    # Brave Search API
        brave-search-provider.spec.ts
        search-factory.ts           # env→provider factory
    prompts/
      system-prompt.ts              # system prompt (TS 상수, .md 빌드 복사 문제 회피)
    interfaces/
      cli/
        index.ts                    # CLI entry (memento-agent ask)
        cli.spec.ts
      mcp/
        ask-tool.ts                 # MCP tool definition (agent_ask)
        server.ts                   # standalone MCP stdio server
        mcp.spec.ts
      http/
        ask-handler.ts              # Express 5 route handler
        router.ts                   # Express Router
        http.spec.ts                # supertest
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
```

---

## Task 1: Package Scaffold

**Files:**
- Create: `packages/memento-agent/package.json`
- Create: `packages/memento-agent/tsconfig.json`
- Create: `packages/memento-agent/tsconfig.build.json`
- Create: `packages/memento-agent/vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "memento-agent",
  "version": "0.1.0",
  "description": "Memento Agent — memory + web search + LLM",
  "type": "module",
  "private": true,
  "main": "dist/interfaces/http/router.js",
  "bin": {
    "memento-agent": "./dist/interfaces/cli/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsx watch src/interfaces/cli/index.ts",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:ci": "vitest run --reporter=basic"
  },
  "dependencies": {
    "@memento/client": "*",
    "@anthropic-ai/sdk": "^0.39.0",
    "@modelcontextprotocol/sdk": "^1.18.2",
    "express": "^5.1.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/express": "^5.0.3",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0",
    "vitest": "^1.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  },
  "optionalDependencies": {
    "playwright": "^1.40.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@memento/client',
        replacement: path.resolve(__dirname, '../memento-client/src/index.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

Expected: no errors, `node_modules` updated.

- [ ] **Step 6: Commit**

```bash
git add packages/memento-agent/
git commit -m "chore: scaffold memento-agent package"
```

---

## Task 2: Core Types & Interfaces

**Files:**
- Create: `packages/memento-agent/src/core/types.ts`
- Create: `packages/memento-agent/src/providers/llm/llm-provider.ts`
- Create: `packages/memento-agent/src/providers/search/search-provider.ts`
- Create: `packages/memento-agent/src/prompts/system-prompt.ts`

- [ ] **Step 1: Create `src/core/types.ts`**

```typescript
import type { MemorySearchResult } from '@memento/client';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface AskResult {
  answer: string;
  usedMemories: MemorySearchResult[];
  searchResults: SearchResult[];
}

export interface AgentConfig {
  mementoBaseUrl: string;
  recallLimit: number;
  tokenBudget: number;
  llmTimeoutMs: number;
  searchTimeoutMs: number;
  useSearch: boolean;
}

export function loadAgentConfig(): AgentConfig {
  return {
    mementoBaseUrl: process.env.MEMENTO_BASE_URL ?? 'http://localhost:3000',
    recallLimit: parseInt(process.env.MEMENTO_AGENT_RECALL_LIMIT ?? '10', 10),
    tokenBudget: parseInt(process.env.MEMENTO_AGENT_TOKEN_BUDGET ?? '4000', 10),
    llmTimeoutMs: parseInt(process.env.MEMENTO_AGENT_LLM_TIMEOUT_MS ?? '30000', 10),
    searchTimeoutMs: parseInt(process.env.MEMENTO_AGENT_SEARCH_TIMEOUT_MS ?? '10000', 10),
    useSearch: true,
  };
}
```

- [ ] **Step 2: Create `src/providers/llm/llm-provider.ts`**

```typescript
import type { Message } from '../../core/types.js';

export interface LLMOptions {
  timeoutMs?: number;
}

export interface LLMProvider {
  complete(messages: Message[], options?: LLMOptions): Promise<string>;
}
```

- [ ] **Step 3: Create `src/providers/search/search-provider.ts`**

```typescript
import type { SearchResult } from '../../core/types.js';

export interface SearchProvider {
  search(query: string, timeoutMs?: number): Promise<SearchResult[]>;
}
```

- [ ] **Step 4: Create `src/prompts/system-prompt.ts`** (인라인 상수 — `.md` 파일 빌드 복사 문제 회피)

```typescript
export const SYSTEM_PROMPT_TEMPLATE = `당신은 Memento 기억 시스템과 연결된 개인 AI 어시스턴트입니다.

사용자의 질문에 답할 때:
1. 제공된 과거 기억(memories)을 먼저 참고하세요
2. 웹 검색 결과(search results)가 있으면 기억과 결합하세요
3. 불확실한 내용은 추측하지 말고 모른다고 답하세요
4. 어떤 기억/검색 결과를 근거로 답했는지 간략히 밝히세요

{{memories}}

{{searchResults}}`;
```

- [ ] **Step 5: Type-check**

```bash
cd packages/memento-agent && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/memento-agent/src/
git commit -m "feat(agent): add core types and provider interfaces"
```

---

## Task 3: SearchProvider Implementations (Noop + Brave)

**Files:**
- Create: `packages/memento-agent/src/providers/search/noop-search-provider.ts`
- Create: `packages/memento-agent/src/providers/search/brave-search-provider.ts`
- Create: `packages/memento-agent/src/providers/search/brave-search-provider.spec.ts`
- Create: `packages/memento-agent/src/providers/search/search-factory.ts`

- [ ] **Step 1: Write failing test for BraveSearchProvider**

```typescript
// brave-search-provider.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BraveSearchProvider } from './brave-search-provider.js';

describe('BraveSearchProvider', () => {
  it('returns empty array when API key is missing', async () => {
    const provider = new BraveSearchProvider('');
    const results = await provider.search('test query');
    expect(results).toEqual([]);
  });

  it('maps API response to SearchResult[]', async () => {
    const provider = new BraveSearchProvider('fake-key');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'Title 1', url: 'https://a.com', description: 'Desc 1' },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const results = await provider.search('test query');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: 'Title 1',
      url: 'https://a.com',
      snippet: 'Desc 1',
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/memento-agent && npx vitest run src/providers/search/brave-search-provider.spec.ts
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create `noop-search-provider.ts`**

```typescript
import type { SearchProvider } from './search-provider.js';
import type { SearchResult } from '../../core/types.js';

export class NoopSearchProvider implements SearchProvider {
  async search(_query: string): Promise<SearchResult[]> {
    return [];
  }
}
```

- [ ] **Step 4: Create `brave-search-provider.ts`**

```typescript
import type { SearchProvider } from './search-provider.js';
import type { SearchResult } from '../../core/types.js';

export class BraveSearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, timeoutMs = 10000): Promise<SearchResult[]> {
    if (!this.apiKey) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        {
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': this.apiKey,
          },
          signal: controller.signal,
        }
      );

      if (!response.ok) return [];

      const data = await response.json() as {
        web?: { results?: Array<{ title: string; url: string; description: string }> };
      };

      return (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      }));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 5: Create `search-factory.ts`**

```typescript
import type { SearchProvider } from './search-provider.js';
import { NoopSearchProvider } from './noop-search-provider.js';
import { BraveSearchProvider } from './brave-search-provider.js';

export function createSearchProvider(): SearchProvider {
  const name = process.env.MEMENTO_AGENT_SEARCH ?? 'none';
  switch (name) {
    case 'brave':
      return new BraveSearchProvider(process.env.BRAVE_API_KEY ?? '');
    case 'playwright':
      throw new Error('playwright not installed. Run: npm install playwright');
    default:
      return new NoopSearchProvider();
  }
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd packages/memento-agent && npx vitest run src/providers/search/brave-search-provider.spec.ts
```

Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/memento-agent/src/providers/search/
git commit -m "feat(agent): add NoopSearchProvider and BraveSearchProvider"
```

---

## Task 4: LLMProvider — NoopLLM + ClaudeProvider

**Files:**
- Create: `packages/memento-agent/src/providers/llm/noop-llm-provider.ts`
- Create: `packages/memento-agent/src/providers/llm/claude-provider.ts`
- Create: `packages/memento-agent/src/providers/llm/claude-provider.spec.ts`
- Create: `packages/memento-agent/src/providers/llm/llm-factory.ts`

- [ ] **Step 1: Write failing test for ClaudeProvider**

```typescript
// claude-provider.spec.ts
import { describe, it, expect, vi } from 'vitest';

// vi.hoisted()로 TDZ 문제 방지 — vi.mock 팩토리보다 먼저 실행됨
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Hello from Claude' }],
  }),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { ClaudeProvider } from './claude-provider.js';

describe('ClaudeProvider', () => {
  it('returns text from API response', async () => {
    const provider = new ClaudeProvider('fake-key');
    const result = await provider.complete([
      { role: 'user', content: 'Hello' },
    ]);
    expect(result).toBe('Hello from Claude');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/memento-agent && npx vitest run src/providers/llm/claude-provider.spec.ts
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create `noop-llm-provider.ts`**

```typescript
import type { LLMProvider, LLMOptions } from './llm-provider.js';
import type { Message } from '../../core/types.js';

export class NoopLLMProvider implements LLMProvider {
  constructor(private readonly fixedResponse = 'noop') {}

  async complete(_messages: Message[], _options?: LLMOptions): Promise<string> {
    return this.fixedResponse;
  }
}
```

- [ ] **Step 4: Create `claude-provider.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMOptions } from './llm-provider.js';
import type { Message } from '../../core/types.js';

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string, private model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey });
  }

  async complete(messages: Message[], options?: LLMOptions): Promise<string> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMessages = messages.filter((m) => m.role !== 'system');

    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 1024,
        system: systemMsg?.content,
        messages: userMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      },
      { timeout: options?.timeoutMs ?? 30000 }
    );

    const block = response.content.find((c) => c.type === 'text');
    return block?.type === 'text' ? block.text : '';
  }
}
```

- [ ] **Step 5: Create `llm-factory.ts`**

```typescript
import type { LLMProvider } from './llm-provider.js';
import { ClaudeProvider } from './claude-provider.js';

export function createLLMProvider(): LLMProvider {
  const name = process.env.MEMENTO_AGENT_LLM ?? 'claude';
  switch (name) {
    case 'claude':
      return new ClaudeProvider(process.env.ANTHROPIC_API_KEY ?? '');
    case 'openai':
      throw new Error('OpenAI provider not yet implemented (Phase 4)');
    case 'ollama':
      throw new Error('Ollama provider not yet implemented (Phase 4)');
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd packages/memento-agent && npx vitest run src/providers/llm/claude-provider.spec.ts
```

Expected: PASS (1 test)

- [ ] **Step 7: Commit**

```bash
git add packages/memento-agent/src/providers/llm/
git commit -m "feat(agent): add ClaudeProvider and LLM factory"
```

---

## Task 5: AgentCore

**Files:**
- Create: `packages/memento-agent/src/core/agent-core.ts`
- Create: `packages/memento-agent/src/core/agent-core.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// agent-core.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentCore } from './agent-core.js';
import { NoopLLMProvider } from '../providers/llm/noop-llm-provider.js';
import { NoopSearchProvider } from '../providers/search/noop-search-provider.js';
import type { MementoClient } from '@memento/client';

function makeMockClient(): MementoClient {
  return {
    recall: vi.fn().mockResolvedValue({ items: [], total_count: 0, query_time: 0 }),
    remember: vi.fn().mockResolvedValue({ memory_id: 'abc', created_at: '' }),
  } as unknown as MementoClient;
}

describe('AgentCore', () => {
  let client: MementoClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  it('returns an answer string', async () => {
    const core = new AgentCore(client, new NoopLLMProvider('answer text'), new NoopSearchProvider());
    const result = await core.ask('any question');
    expect(result.answer).toBe('answer text');
  });

  it('includes usedMemories from recall', async () => {
    const fakeMemory = { id: '1', content: 'past thing', type: 'episodic', score: 0.9 };
    vi.mocked(client.recall).mockResolvedValue({
      items: [fakeMemory as never],
      total_count: 1,
      query_time: 0,
    });

    const core = new AgentCore(client, new NoopLLMProvider(), new NoopSearchProvider());
    const result = await core.ask('question');
    expect(result.usedMemories).toHaveLength(1);
    expect(result.usedMemories[0].id).toBe('1');
  });

  it('saves answer as episodic memory after completing', async () => {
    const core = new AgentCore(client, new NoopLLMProvider('saved answer'), new NoopSearchProvider());
    await core.ask('question');
    expect(client.remember).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'episodic' })
    );
  });

  it('continues when search fails', async () => {
    const failSearch = { search: vi.fn().mockRejectedValue(new Error('network error')) };
    const core = new AgentCore(client, new NoopLLMProvider(), failSearch);
    const result = await core.ask('question');
    expect(result.searchResults).toEqual([]);
    expect(result.answer).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd packages/memento-agent && npx vitest run src/core/agent-core.spec.ts
```

Expected: FAIL with "Cannot find module './agent-core.js'"

- [ ] **Step 3: Create `src/core/agent-core.ts`**

```typescript
import type { MementoClient } from '@memento/client';
import type { LLMProvider } from '../providers/llm/llm-provider.js';
import type { SearchProvider } from '../providers/search/search-provider.js';
import type { AskResult, Message } from './types.js';
import { SYSTEM_PROMPT_TEMPLATE } from '../prompts/system-prompt.js';

export class AgentCore {
  constructor(
    private readonly memento: MementoClient,
    private readonly llm: LLMProvider,
    private readonly search: SearchProvider,
    private readonly config = {
      recallLimit: 10,
      llmTimeoutMs: 30000,
      searchTimeoutMs: 10000,
    }
  ) {}

  async ask(query: string, useSearch = true): Promise<AskResult> {
    // 1. Recall memories
    const recallResult = await this.memento.recall(query, undefined, this.config.recallLimit);
    const usedMemories = recallResult.items;

    // 2. Web search (best-effort)
    let searchResults: AskResult['searchResults'] = [];
    if (useSearch) {
      try {
        searchResults = await this.search.search(query, this.config.searchTimeoutMs);
      } catch {
        // silent: continue with memories only
      }
    }

    // 3. Build system prompt
    const memoriesText = usedMemories.length > 0
      ? `[MEMORIES]\n${usedMemories.map((m) => `- ${m.content}`).join('\n')}`
      : '';
    const searchText = searchResults.length > 0
      ? `[SEARCH_RESULTS]\n${searchResults.map((r) => `- ${r.title}: ${r.snippet}`).join('\n')}`
      : '';
    const systemContent = SYSTEM_PROMPT_TEMPLATE
      .replace('{{memories}}', memoriesText)
      .replace('{{searchResults}}', searchText)
      .trim();

    // 4. LLM complete
    const messages: Message[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: query },
    ];
    const answer = await this.llm.complete(messages, { timeoutMs: this.config.llmTimeoutMs });

    // 5. Save answer as episodic memory
    await this.memento.remember({ content: `Q: ${query}\nA: ${answer}`, type: 'episodic' });

    return { answer, usedMemories, searchResults };
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/memento-agent && npx vitest run src/core/agent-core.spec.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/memento-agent/src/core/
git commit -m "feat(agent): implement AgentCore with recall→search→LLM→remember loop"
```

---

## Task 6: CLI Interface

**Files:**
- Create: `packages/memento-agent/src/interfaces/cli/index.ts`
- Create: `packages/memento-agent/src/interfaces/cli/cli.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// cli.spec.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core/agent-core.js', () => ({
  AgentCore: vi.fn().mockImplementation(() => ({
    ask: vi.fn().mockResolvedValue({
      answer: 'test answer',
      usedMemories: [],
      searchResults: [],
    }),
  })),
}));

vi.mock('@memento/client', () => ({
  MementoClient: vi.fn().mockImplementation(() => ({})),
}));

describe('CLI parseArgs', () => {
  it('extracts query from argv', async () => {
    const { parseArgs } = await import('./index.js');
    const result = parseArgs(['node', 'memento-agent', 'ask', 'my question here']);
    expect(result.query).toBe('my question here');
    expect(result.useSearch).toBe(true);
  });

  it('--no-search disables search', async () => {
    const { parseArgs } = await import('./index.js');
    const result = parseArgs(['node', 'memento-agent', 'ask', '--no-search', 'my question']);
    expect(result.useSearch).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/memento-agent && npx vitest run src/interfaces/cli/cli.spec.ts
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create `src/interfaces/cli/index.ts`**

```typescript
#!/usr/bin/env node
import { MementoClient } from '@memento/client';
import { AgentCore } from '../../core/agent-core.js';
import { createLLMProvider } from '../../providers/llm/llm-factory.js';
import { createSearchProvider } from '../../providers/search/search-factory.js';
import { loadAgentConfig } from '../../core/types.js';

export function parseArgs(argv: string[]): { query: string; useSearch: boolean; json: boolean } {
  const args = argv.slice(2);
  if (args[0] === 'serve-mcp') {
    // serve-mcp: MCP 서버를 기동하고 return — process.exit 호출 금지
    // (server.ts가 장기 실행 stdio 서버이므로 프로세스를 살려두어야 함)
    import('../../interfaces/mcp/server.js').catch((e) => {
      console.error(e); process.exit(1);
    });
    return { query: '', useSearch: false, json: false }; // dummy — main()에서 serve-mcp 분기 후 return
  }
  if (args[0] !== 'ask') {
    console.error('Usage: memento-agent ask [--no-search] [--json] "<query>"\n       memento-agent serve-mcp');
    process.exit(1);
  }

  const flags = args.filter((a) => a.startsWith('--'));
  const words = args.filter((a) => !a.startsWith('--') && a !== 'ask');

  return {
    query: words.join(' '),
    useSearch: !flags.includes('--no-search'),
    json: flags.includes('--json'),
  };
}

async function main() {
  const { query, useSearch, json } = parseArgs(process.argv);

  if (!query) {
    console.error('Error: query is required');
    process.exit(1);
  }

  const config = loadAgentConfig();
  const client = new MementoClient({ serverUrl: config.mementoBaseUrl });

  try {
    await client.connect();
  } catch {
    console.error(`Error: cannot connect to Memento at ${config.mementoBaseUrl}`);
    process.exit(1);
  }

  const core = new AgentCore(client, createLLMProvider(), createSearchProvider(), {
    recallLimit: config.recallLimit,
    llmTimeoutMs: config.llmTimeoutMs,
    searchTimeoutMs: config.searchTimeoutMs,
  });

  try {
    const result = await core.ask(query, useSearch);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.answer);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/memento-agent && npx vitest run src/interfaces/cli/cli.spec.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/memento-agent/src/interfaces/cli/
git commit -m "feat(agent): add CLI interface (memento-agent ask)"
```

---

## Task 7: Standalone MCP Server

**Files:**
- Create: `packages/memento-agent/src/interfaces/mcp/ask-tool.ts`
- Create: `packages/memento-agent/src/interfaces/mcp/server.ts`
- Create: `packages/memento-agent/src/interfaces/mcp/mcp.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// mcp.spec.ts
import { describe, it, expect } from 'vitest';
import { AGENT_ASK_TOOL } from './ask-tool.js';

describe('agent_ask MCP tool definition', () => {
  it('has correct name', () => {
    expect(AGENT_ASK_TOOL.name).toBe('agent_ask');
  });

  it('requires query parameter', () => {
    const schema = AGENT_ASK_TOOL.inputSchema as { required: string[] };
    expect(schema.required).toContain('query');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/memento-agent && npx vitest run src/interfaces/mcp/mcp.spec.ts
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create `src/interfaces/mcp/ask-tool.ts`**

```typescript
export const AGENT_ASK_TOOL = {
  name: 'agent_ask',
  description: '기억과 웹 검색을 결합해 질문에 답합니다',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '질문 내용' },
      useSearch: { type: 'boolean', description: '웹 검색 사용 여부' },
    },
    required: ['query'],
  },
} as const;
```

- [ ] **Step 4: Create `src/interfaces/mcp/server.ts`**

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MementoClient } from '@memento/client';
import { AgentCore } from '../../core/agent-core.js';
import { createLLMProvider } from '../../providers/llm/llm-factory.js';
import { createSearchProvider } from '../../providers/search/search-factory.js';
import { loadAgentConfig } from '../../core/types.js';
import { AGENT_ASK_TOOL } from './ask-tool.js';

const config = loadAgentConfig();
const client = new MementoClient({ serverUrl: config.mementoBaseUrl });
const core = new AgentCore(client, createLLMProvider(), createSearchProvider(), {
  recallLimit: config.recallLimit,
  llmTimeoutMs: config.llmTimeoutMs,
  searchTimeoutMs: config.searchTimeoutMs,
});

const server = new Server(
  { name: 'memento-agent', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [AGENT_ASK_TOOL],
}));

// connect once at startup
await client.connect();

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'agent_ask') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { query, useSearch = true } = request.params.arguments as { query: string; useSearch?: boolean };

  try {
    const result = await core.ask(query, useSearch);
    return {
      content: [{ type: 'text', text: result.answer }],
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd packages/memento-agent && npx vitest run src/interfaces/mcp/mcp.spec.ts
```

Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/memento-agent/src/interfaces/mcp/
git commit -m "feat(agent): add standalone MCP server (memento-agent serve-mcp)"
```

---

## Task 8: HTTP Endpoint (Express 5)

**Files:**
- Create: `packages/memento-agent/src/interfaces/http/ask-handler.ts`
- Create: `packages/memento-agent/src/interfaces/http/router.ts`
- Create: `packages/memento-agent/src/interfaces/http/http.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// http.spec.ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../core/agent-core.js', () => ({
  AgentCore: vi.fn().mockImplementation(() => ({
    ask: vi.fn().mockResolvedValue({
      answer: 'http answer',
      usedMemories: [],
      searchResults: [],
    }),
  })),
}));

vi.mock('@memento/client', () => ({
  MementoClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('POST /api/agent/ask', () => {
  it('returns 200 with answer', async () => {
    const { createAgentRouter } = await import('./router.js');
    const app = express();
    app.use(express.json());
    app.use('/api/agent', createAgentRouter());

    const res = await request(app)
      .post('/api/agent/ask')
      .send({ query: 'test question' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('http answer');
  });

  it('returns 400 when query is missing', async () => {
    const { createAgentRouter } = await import('./router.js');
    const app = express();
    app.use(express.json());
    app.use('/api/agent', createAgentRouter());

    const res = await request(app)
      .post('/api/agent/ask')
      .send({});

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/memento-agent && npx vitest run src/interfaces/http/http.spec.ts
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create `src/interfaces/http/ask-handler.ts`**

```typescript
import type { Request, Response } from 'express';
import type { AgentCore } from '../../core/agent-core.js';

export function createAskHandler(core: AgentCore) {
  return async (req: Request, res: Response): Promise<void> => {
    const { query, useSearch = true } = req.body as { query?: string; useSearch?: boolean };

    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    try {
      const result = await core.ask(query, useSearch);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('connect') || message.includes('ECONNREFUSED')) {
        res.status(503).json({ error: 'Memento server unavailable' });
      } else if (message.includes('timeout')) {
        res.status(504).json({ error: `LLM timeout: ${message}` });
      } else {
        res.status(500).json({ error: `LLM provider error: ${message}` });
      }
    }
  };
}
```

- [ ] **Step 4: Create `src/interfaces/http/router.ts`**

```typescript
import { Router } from 'express';
import { MementoClient } from '@memento/client';
import { AgentCore } from '../../core/agent-core.js';
import { createLLMProvider } from '../../providers/llm/llm-factory.js';
import { createSearchProvider } from '../../providers/search/search-factory.js';
import { loadAgentConfig } from '../../core/types.js';
import { createAskHandler } from './ask-handler.js';

export function createAgentRouter(): Router {
  const config = loadAgentConfig();
  const client = new MementoClient({ serverUrl: config.mementoBaseUrl });
  const core = new AgentCore(client, createLLMProvider(), createSearchProvider(), {
    recallLimit: config.recallLimit,
    llmTimeoutMs: config.llmTimeoutMs,
    searchTimeoutMs: config.searchTimeoutMs,
  });

  const router = Router();

  // lazy-connect: Promise 캐싱으로 경쟁 조건 방지
  let connectPromise: Promise<void> | null = null;
  router.use(async (_req, _res, next) => {
    if (!connectPromise) {
      connectPromise = client.connect();
    }
    await connectPromise;
    next();
  });

  router.post('/ask', createAskHandler(core));
  return router;
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd packages/memento-agent && npx vitest run src/interfaces/http/http.spec.ts
```

Expected: PASS (2 tests)

- [ ] **Step 6: Build and type-check**

```bash
cd packages/memento-agent && npm run build && npx tsc --noEmit
```

Expected: no errors, `dist/` generated.

- [ ] **Step 7: Commit**

```bash
git add packages/memento-agent/src/interfaces/http/
git commit -m "feat(agent): add HTTP endpoint POST /api/agent/ask"
```

---

## Task 9: Root vitest.config.ts Update + Final Check

**Files:**
- Modify: `vitest.config.ts` (root) — add memento-agent to include pattern

- [ ] **Step 1: Update root vitest.config.ts**

In `/home/jee1lee/git/memento/vitest.config.ts`, add `'packages/memento-agent/src/**/*.spec.ts'` to the `include` array:

```typescript
include: [
  'tests/**/*.{test,spec}.{js,ts}',
  'scripts/**/*.{test,spec}.{js,ts}',
  'apps/**/*.{test,spec}.{js,ts}',
  'packages/memento-core/src/**/*.{test,spec}.{js,ts}',
  'packages/memento-client/src/**/*.{test,spec}.{js,ts}',
  'packages/memento-server/src/**/*.{test,spec}.{js,ts}',
  'packages/memento-agent/src/**/*.spec.ts',   // ← add this
],
```

- [ ] **Step 2: Run all tests from root**

```bash
cd /home/jee1lee/git/memento && npm test
```

Expected: all existing tests PASS, all new memento-agent tests PASS.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: include memento-agent specs in root vitest config"
```

---

## Completion Checklist

- [ ] `packages/memento-agent` builds without errors
- [ ] All 11+ unit tests pass
- [ ] `memento-agent ask --json "test"` outputs valid JSON (requires Memento server running)
- [ ] Root `npm test` passes
