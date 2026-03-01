# Developer Continuity Assistant Phase 1 Runtime Wiring and Core Facade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** assistant runtime을 실제 core remember/recall 경로에 연결하고, `memento-core` package root가 assistant가 사용할 최소 공개 계약을 제공하도록 정리한다.

**Architecture:** `packages/memento-core`에 continuity Phase 1이 사용할 최소 HTTP tool facade를 추가하고, `packages/memento-assistant` runtime은 그 facade만 사용해 core `/tools/remember`, `/tools/recall`을 호출한다. assistant runtime은 `createAssistantApp()`에 실제 `remember`, `queryContinuityMemories` 구현을 주입받아 기동하고, guide/E2E 문서도 이 실행 구조에 맞춰 정렬한다.

**Tech Stack:** TypeScript, npm workspaces, Node.js built-in `fetch`, Express, Vitest, existing root `/tools/*` HTTP routes.

---

### Task 1: `memento-core` 최소 공개 facade 추가

**Files:**
- Create: `packages/memento-core/src/types.ts`
- Create: `packages/memento-core/src/http-tool-client.ts`
- Create: `packages/memento-core/src/http-tool-client.spec.ts`
- Modify: `packages/memento-core/src/index.ts`

**Step 1: Write the failing test**

`packages/memento-core/src/http-tool-client.spec.ts`를 만들고, package root facade가 assistant runtime에서 바로 쓸 수 있는 최소 계약을 먼저 고정한다.

예시:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createCoreToolHttpClient } from './http-tool-client.js';

describe('createCoreToolHttpClient', () => {
  it('POSTs remember payload to /tools/remember', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { memory_id: 'mem-1' } }),
    });

    const client = createCoreToolHttpClient({
      serverUrl: 'http://localhost:3000',
      fetchImpl: fetchMock,
    });

    const result = await client.remember({
      content: 'Session started',
      type: 'working',
      tags: ['continuity', 'task'],
    });

    expect(result).toEqual({ memory_id: 'mem-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/tools/remember',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('POSTs recall payload to /tools/recall and normalizes items', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          items: {
            items: [
              { id: 'mem-1', content: 'Decision', tags: ['continuity', 'decision'] },
            ],
          },
        },
      }),
    });

    const client = createCoreToolHttpClient({
      serverUrl: 'http://localhost:3000',
      fetchImpl: fetchMock,
    });

    const result = await client.recall({
      query: 'memento',
      filters: { tags: ['continuity'] },
      limit: 10,
    });

    expect(result.items).toEqual([
      { id: 'mem-1', content: 'Decision', tags: ['continuity', 'decision'] },
    ]);
  });
});
```

추가로 `packages/memento-core/src/index.ts`에서 아래가 package root에서 import 가능하다는 점도 고정한다.

```ts
import { createCoreToolHttpClient } from './index.js';
```

**Step 2: Run test to verify it fails**

Run:

```bash
npx vitest --run packages/memento-core/src/http-tool-client.spec.ts
```

Expected: FAIL with missing file or missing export.

**Step 3: Write minimal implementation**

`packages/memento-core/src/types.ts`에는 assistant runtime에 필요한 최소 공개 타입만 둔다.

예시:

```ts
export type CoreMemoryType = 'working' | 'episodic' | 'semantic' | 'procedural' | 'core' | 'vault';

export interface CoreRememberParams {
  content?: string;
  type?: CoreMemoryType;
  tags?: string[];
  importance?: number;
  process_id?: string;
  session_id?: string;
  source_session_id?: string;
  origin_source?: string;
}

export interface CoreRecallParams {
  query: string;
  filters?: {
    tags?: string[];
  };
  limit?: number;
  process_id?: string;
  session_id?: string;
}

export interface CoreRecallItem {
  id: string;
  content: string;
  tags?: string[];
}

export interface CoreRememberResult {
  memory_id: string;
}

export interface CoreRecallResult {
  items: CoreRecallItem[];
}
```

`packages/memento-core/src/http-tool-client.ts`에는 root core HTTP API(`/tools/remember`, `/tools/recall`)를 감싸는 얇은 wrapper를 만든다.

예시:

```ts
import type {
  CoreRememberParams,
  CoreRememberResult,
  CoreRecallParams,
  CoreRecallResult,
} from './types.js';

export interface CoreToolHttpClientOptions {
  serverUrl: string;
  fetchImpl?: typeof fetch;
}

export function createCoreToolHttpClient(options: CoreToolHttpClientOptions) {
  const baseUrl = options.serverUrl.replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async remember(params: CoreRememberParams): Promise<CoreRememberResult> {
      const response = await fetchImpl(`${baseUrl}/tools/remember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error(`remember failed: ${response.status}`);
      const data = (await response.json()) as { result: CoreRememberResult };
      return data.result;
    },

    async recall(params: CoreRecallParams): Promise<CoreRecallResult> {
      const response = await fetchImpl(`${baseUrl}/tools/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error(`recall failed: ${response.status}`);
      const data = (await response.json()) as {
        result: { items?: { items?: CoreRecallResult['items'] } | CoreRecallResult['items'] };
      };
      const rawItems = Array.isArray(data.result.items)
        ? data.result.items
        : data.result.items?.items ?? [];
      return { items: rawItems };
    },
  };
}
```

`packages/memento-core/src/index.ts`는 최소한 아래를 재export한다.

```ts
export { createCoreToolHttpClient } from './http-tool-client.js';
export type {
  CoreRememberParams,
  CoreRecallParams,
  CoreRecallItem,
  CoreRecallResult,
  CoreRememberResult,
} from './types.js';
```

핵심 기준:

- assistant가 runtime wiring을 위해 필요한 공개 계약만 제공한다.
- `packages/memento-core` 내부에서 루트 `src/` 밖을 직접 import하지 않는다.
- built-in `fetch`를 사용해 package dependency를 불필요하게 늘리지 않는다.

**Step 4: Run test to verify it passes**

Run:

```bash
npx vitest --run packages/memento-core/src/http-tool-client.spec.ts
npm run --workspace packages/memento-core type-check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/memento-core/src/types.ts packages/memento-core/src/http-tool-client.ts packages/memento-core/src/http-tool-client.spec.ts packages/memento-core/src/index.ts
git commit -m "feat: add core continuity facade contracts"
```

---

### Task 2: assistant runtime을 core facade에 실제 연결

**Files:**
- Create: `packages/memento-assistant/src/server/runtime-core-bridge.ts`
- Create: `packages/memento-assistant/src/server/runtime-core-bridge.spec.ts`
- Modify: `packages/memento-assistant/src/server/run-assistant-server.ts`
- Modify: `packages/memento-assistant/src/server/assistant-http-server.ts`
- Modify: `packages/memento-assistant/src/server/assistant-http-server.spec.ts`

**Step 1: Write the failing tests**

assistant runtime이 실제로 core를 호출하도록, bridge layer의 동작을 먼저 고정한다.

`packages/memento-assistant/src/server/runtime-core-bridge.spec.ts` 예시:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeCoreBridge } from './runtime-core-bridge.js';

describe('createRuntimeCoreBridge', () => {
  it('delegates remember payload to core client remember()', async () => {
    const coreClient = {
      remember: vi.fn().mockResolvedValue({ memory_id: 'mem-1' }),
      recall: vi.fn(),
    };

    const bridge = createRuntimeCoreBridge(coreClient);
    const result = await bridge.remember({
      content: 'Session started',
      type: 'working',
      tags: ['continuity', 'task'],
    });

    expect(result).toEqual({ memory_id: 'mem-1' });
    expect(coreClient.remember).toHaveBeenCalledTimes(1);
  });

  it('queries core recall and maps continuity items for resume snapshot', async () => {
    const coreClient = {
      remember: vi.fn(),
      recall: vi.fn().mockResolvedValue({
        items: [
          { id: 'mem-1', content: 'Decision', tags: ['continuity', 'decision'] },
        ],
      }),
    };

    const bridge = createRuntimeCoreBridge(coreClient);
    const items = await bridge.queryContinuityMemories({
      project: 'memento',
      processId: 'cursor',
      sessionId: 'sess-1',
      branch: 'feature/resume',
    });

    expect(coreClient.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'memento',
        filters: { tags: ['continuity'] },
      })
    );
    expect(items).toEqual([
      { id: 'mem-1', content: 'Decision', tags: ['continuity', 'decision'] },
    ]);
  });
});
```

`packages/memento-assistant/src/server/assistant-http-server.spec.ts`에는 runtime dependencies가 없을 때 실패하는 경로와, wired bridge를 넣었을 때 성공하는 경로를 명시적으로 분리한다.

핵심 고정 포인트:

- wired runtime에서는 `start_session`이 400이 아니라 정상 응답을 내려야 한다.
- wired runtime에서는 `resume_session`이 빈 fallback이 아니라 bridge 결과를 사용해야 한다.

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest --run packages/memento-assistant/src/server/runtime-core-bridge.spec.ts packages/memento-assistant/src/server/assistant-http-server.spec.ts
```

Expected: FAIL with missing bridge implementation or missing runtime wiring.

**Step 3: Write minimal implementation**

`packages/memento-assistant/src/server/runtime-core-bridge.ts`에는 assistant app이 이해할 수 있는 `remember`, `queryContinuityMemories`를 core facade client 위에 만든다.

예시:

```ts
import type {
  CoreRememberParams,
  CoreRecallParams,
  CoreRecallResult,
} from 'memento-core';
import type { AssistantServerOptions } from './assistant-http-server.js';

interface CoreFacadeClient {
  remember(params: CoreRememberParams): Promise<{ memory_id: string }>;
  recall(params: CoreRecallParams): Promise<CoreRecallResult>;
}

export function createRuntimeCoreBridge(coreClient: CoreFacadeClient): AssistantServerOptions {
  return {
    remember: (payload) => coreClient.remember(payload),
    queryContinuityMemories: async (input) => {
      const result = await coreClient.recall({
        query: input.project,
        filters: { tags: ['continuity'] },
        limit: 50,
        process_id: input.processId,
        session_id: input.sessionId,
      });

      return result.items
        .filter((item) => item.tags?.includes('continuity'))
        .map((item) => ({
          id: item.id,
          content: item.content,
          tags: item.tags,
        }));
    },
  };
}
```

`packages/memento-assistant/src/server/run-assistant-server.ts`는 top-level side effect만 두지 말고, 테스트 가능한 구성 함수로 나눈다.

예시:

```ts
import { createCoreToolHttpClient } from 'memento-core';
import { createAssistantApp } from './assistant-http-server.js';
import { createRuntimeCoreBridge } from './runtime-core-bridge.js';

export interface AssistantRuntimeEnv {
  assistantPort: number;
  coreServerUrl: string;
}

export function resolveAssistantRuntimeEnv(env: NodeJS.ProcessEnv): AssistantRuntimeEnv {
  const assistantPort = Number(env.ASSISTANT_PORT ?? env.PORT ?? 8090);
  const coreServerUrl = env.MEMENTO_CORE_URL ?? 'http://localhost:3000';
  return { assistantPort, coreServerUrl };
}

export function createAssistantRuntimeApp(env: NodeJS.ProcessEnv = process.env) {
  const config = resolveAssistantRuntimeEnv(env);
  const coreClient = createCoreToolHttpClient({ serverUrl: config.coreServerUrl });
  const bridge = createRuntimeCoreBridge(coreClient);
  return {
    app: createAssistantApp(bridge),
    config,
  };
}

if (process.argv[1]?.includes('run-assistant-server')) {
  const { app, config } = createAssistantRuntimeApp();
  app.listen(config.assistantPort, () => {
    console.log(`Assistant runtime listening on http://localhost:${config.assistantPort}`);
  });
}
```

`assistant-http-server.ts`는 runtime dependencies가 없는 경우 fallback으로 빈 구현을 넣기보다, 런타임 엔트리에서 bridge를 주입받도록 사용법을 명확히 유지한다. 테스트용 fallback은 유지해도 되지만, production entry는 빈 객체로 기동하지 않게 한다.

핵심 기준:

- `npm run dev:assistant`와 `npm run start:assistant`가 실제 continuity runtime이 되어야 한다.
- runtime entry는 core server URL을 명시적으로 읽고, assistant app은 실제 remember/query 함수를 주입받아야 한다.
- assistant package는 `memento-core` package root를 통해서만 core에 접근한다.

**Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest --run packages/memento-assistant/src/server/runtime-core-bridge.spec.ts packages/memento-assistant/src/server/assistant-http-server.spec.ts
npm run --workspace packages/memento-assistant type-check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/memento-assistant/src/server/runtime-core-bridge.ts packages/memento-assistant/src/server/runtime-core-bridge.spec.ts packages/memento-assistant/src/server/run-assistant-server.ts packages/memento-assistant/src/server/assistant-http-server.ts packages/memento-assistant/src/server/assistant-http-server.spec.ts
git commit -m "feat: wire assistant runtime to core facade"
```

---

### Task 3: 가이드와 E2E를 실제 runtime wiring 기준으로 고정

**Files:**
- Modify: `docs/guides/ko/developer-continuity-assistant-phase1.md`
- Modify: `packages/memento-assistant/src/test/test-developer-continuity-flow.ts`
- Modify: `docs/plans/ko/2026-03-01-developer-continuity-assistant-phase1-remediation-checklist.md`

**Step 1: Write the failing documentation/test expectation**

문서와 E2E가 실제 runtime wiring을 전제하도록 기대를 먼저 고정한다.

핵심 기대:

- assistant runtime 기동 예시에 `MEMENTO_CORE_URL`이 포함되어야 한다.
- E2E 스크립트 사용 예시가 core URL과 assistant URL을 함께 설명해야 한다.
- remediation checklist의 3.4, 3.7 항목이 완료 조건을 만족했을 때만 `완료`로 바뀌어야 한다.

간단한 스펙 또는 수동 검증 체크를 문서에 반영한다.

**Step 2: Run precondition check**

Run:

```bash
sed -n '60,120p' docs/guides/ko/developer-continuity-assistant-phase1.md
```

Expected: 현재 문서에는 assistant runtime 기동 명령은 있지만 core wiring 환경 변수 설명이 부족하다.

**Step 3: Write minimal implementation**

가이드를 아래 기준으로 보강한다.

예시:

```bash
# core server
npm run dev:http

# assistant runtime
MEMENTO_CORE_URL=http://localhost:3000 npm run dev:assistant
```

E2E 스크립트 예시도 아래처럼 정리한다.

```bash
MEMENTO_CORE_URL=http://localhost:3000 \
MEMENTO_ASSISTANT_URL=http://localhost:8090 \
tsx packages/memento-assistant/src/test/test-developer-continuity-flow.ts
```

`packages/memento-assistant/src/test/test-developer-continuity-flow.ts`에는 최소한 주석/usage를 현재 runtime wiring 구조와 맞춘다.

`docs/plans/ko/2026-03-01-developer-continuity-assistant-phase1-remediation-checklist.md`는 아래 기준으로 상태를 갱신한다.

- 3.4 `core facade 공개 엔트리 정리` → 실제 facade export가 준비되면 `완료`
- 3.7 `assistant runtime 실행 엔트리포인트 추가` → 실제 core wiring까지 끝났을 때만 `완료`

**Step 4: Run final verification**

Run:

```bash
npm run type-check
npm run build
node scripts/verify-bin.js
npx vitest --run packages/memento-core/src/http-tool-client.spec.ts packages/memento-assistant/src/server/runtime-core-bridge.spec.ts packages/memento-assistant/src/server/assistant-http-server.spec.ts packages/memento-assistant/src/client/continuity-cli.spec.ts
```

로컬 수동 E2E:

```bash
npm run dev:http
MEMENTO_CORE_URL=http://localhost:3000 npm run dev:assistant
MEMENTO_ASSISTANT_URL=http://localhost:8090 tsx packages/memento-assistant/src/test/test-developer-continuity-flow.ts
```

Expected:

- type-check: PASS
- build: PASS
- verify-bin: PASS
- targeted vitest: PASS
- local E2E: start/save/end/resume가 실제로 성공

**Step 5: Commit**

```bash
git add docs/guides/ko/developer-continuity-assistant-phase1.md packages/memento-assistant/src/test/test-developer-continuity-flow.ts docs/plans/ko/2026-03-01-developer-continuity-assistant-phase1-remediation-checklist.md
git commit -m "docs: align continuity runtime wiring guide and verification"
```

---

## 범위 메모

- 이번 계획은 남은 두 finding만 닫는 후속 hardening 작업이다.
- 새 기능 추가나 UX 확장은 범위에 포함하지 않는다.
- 핵심은 `assistant runtime이 실제로 저장/조회 가능한지`와 `assistant가 core public API만 통해 동작하는지`를 코드와 문서에서 동시에 닫는 것이다.

---

## 실행 순서 요약

1. `memento-core` 최소 facade 계약 추가
2. assistant runtime을 core facade에 실제 연결
3. guide/E2E/checklist를 실제 wiring 기준으로 정렬

---

## 실행 옵션

Plan complete and saved to `docs/plans/ko/2026-03-01-developer-continuity-assistant-phase1-runtime-wiring-and-core-facade-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
