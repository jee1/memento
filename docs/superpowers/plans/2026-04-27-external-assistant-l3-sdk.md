# External Assistant Integration v0.1 — Phase 2 (L3 SDK) + Phase 3 (Guide Upgrade) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memento와 외부 비서를 잇는 *옵션* SDK 패키지 `@memento/assistant` 를 신설하고(Phase 2), 안정화 후 L1 가이드들을 SDK 사용 패턴으로 업그레이드한다(Phase 3).

**Architecture:** 새 npm workspace `packages/memento-assistant`를 추가한다. SDK는 두 transport(stdio child / HTTP via `@memento/client`)를 추상화한 `Transport` 인터페이스 위에 `MementoAssistant` 클래스를 노출한다. 핵심 라이프사이클 훅은 `beforeUserTurn`(자동 recall) / `afterAssistantTurn`(자동 remember) 둘이며, **둘 다 절대 throw하지 않는다** — memento 다운 시 비서가 멈추지 않게 하는 게 가장 강한 invariant. `@memento/core` 의존 금지(=`@memento/client` + 새 코드만), LLM/에이전트 루프 미포함(= archived `memento-agent`와의 차별점).

**Tech Stack:** TypeScript / npm workspaces / `@memento/client` / `@modelcontextprotocol/sdk` (stdio client) / Vitest / TF-IDF 임베딩(통합 테스트 fixture).

**Spec:** `docs/superpowers/specs/2026-04-27-external-assistant-integration-design.md`
**Phase 1 plan (already merged):** `docs/superpowers/plans/2026-04-27-external-assistant-l1-guides.md`

---

## PR 전략

> **Phase 2 = 1 PR**, **Phase 3 = 1 별도 PR**.
>
> Phase 2가 main에 머지되어 안정화된 다음 새 브랜치에서 Phase 3을 시작한다. Phase 3은 Phase 2의 `@memento/assistant` import 가능성에 의존하므로 분리가 자연스럽다. Phase 2 PR은 본 plan Task 0~21 위에서, Phase 3 PR은 Task 22~28 위에서 만든다.

---

## ⚠️ Pre-flight: Spec Drift 보정 (반드시 모든 implementer가 인지)

Phase 1 implementer들이 spec과 실제 코드의 불일치를 다수 발견했다(port 9001/8080, `LOG_LEVEL`/`MEMENTO_LOG`, `memory.db`/`memento.db`, `/auth/session` 용도, `health-check` CLI 부재 등). Phase 2도 같은 위험을 안고 있으므로 **spec을 정정한 다음의 사실**을 진실로 사용한다.

| 항목 | spec 기재 | 실제 (검증 결과) | 본 plan에서 사용 |
|---|---|---|---|
| stdio 실행 명령 | `npx -y memento-mcp-server@latest start --stdio` | `start` 서브커맨드 **없음**. `memento-mcp-server` bin 자체가 stdio entry | `npx -y memento-mcp-server@latest` |
| `@memento/client` 메서드 | "thin wrapper" | `MementoClient.recall(query, filters?, limit?, recallExtras?)`, `MementoClient.remember(params: CreateMemoryParams): Promise<RememberResult>` (둘 다 HTTP `/tools/*` 호출) | 그대로 사용 |
| `@memento/client`가 stdio 지원? | 암시 | **HTTP 전용** | stdio transport는 `@modelcontextprotocol/sdk/client/stdio` 직접 사용 |
| `MEMENTO_LOG` env (SDK 측) | spec § 6 | 서버는 `LOG_LEVEL`. SDK는 별도 프로세스 → 별도 이름 가능 | **SDK는 `MEMENTO_ASSISTANT_LOG`**(서버와 충돌 회피, log 변수임을 명확히 함) |
| `MEMENTO_TOKEN` env | spec § 6 | (서버 측은 `ADMIN_API_KEY`/Bearer) SDK는 클라이언트 측 변수라 그대로 OK | `MEMENTO_TOKEN` |
| `crossChannelRecall='sameContext'` | v0.1에서 WARN+fallback | spec 명시 | 1회 WARN 후 `'on'` 처럼 동작, throw 안 함 |
| `kind:'commitment'` | v0.1에서 제외 | spec § 6 | `ExtractedItem` union에서 제외(TS exhaustiveness로 컴파일 차단) |
| 커버리지 ≥85% | spec § 9 | "CI 리포트만, 빌드 게이트 아님" 명시 | CI threshold 추가 **금지** |

> **Rule:** 어떤 task에서든 spec 기재와 코드 사실이 충돌하면 **코드 사실을 채택**하고, plan 자체에 보정 메모를 남긴 뒤 implementer는 그 보정을 코드에 반영한다.

---

## File Structure (확정)

새 패키지 한 개와 root 설정 변경:

```
packages/memento-assistant/                       (신설)
  package.json
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
  README.md
  src/
    index.ts                                      # 공개 API 단일 진입점
    types.ts                                      # 공유 타입 (ExtractedItem 등)
    assistant.ts                                  # MementoAssistant 클래스 + fromEnv
    transport/
      transport.ts                                # interface Transport
      mock-transport.ts                           # 테스트용 in-memory
      stdio-transport.ts                          # @modelcontextprotocol/sdk/client/stdio
      http-transport.ts                           # @memento/client 위 thin wrapper
      factory.ts                                  # env/options → Transport
      index.ts                                    # transport 서브 모듈 barrel
    scoping/
      channel-scope.ts                            # 자동 tags, crossChannelRecall 적용
      channel-scope.spec.ts
    lifecycle/
      before-user-turn.ts
      before-user-turn.spec.ts
      after-assistant-turn.ts
      after-assistant-turn.spec.ts
    policy/
      auto-recall-policy.ts                       # 'always' | 'heuristic' | 'off'
      auto-recall-policy.spec.ts
      auto-remember-policy.ts                     # 'turn' | 'decision' | 'off'
      auto-remember-policy.spec.ts
    fallback/
      circuit-breaker.ts
      circuit-breaker.spec.ts
      retry-queue.ts
      retry-queue.spec.ts
      logger.ts                                   # rate-limited WARN/INFO
  test/
    integration/
      stdio.integration.spec.ts                   # 실제 child spawn
      http.integration.spec.ts                    # 실제 HTTP fixture
    e2e/
      cross-channel-recall.e2e.spec.ts            # 시나리오 1
      channel-isolation.e2e.spec.ts               # 시나리오 2
      degraded-fallback.e2e.spec.ts               # 시나리오 3
      working-promotion.e2e.spec.ts               # 시나리오 4
      transport-switch.e2e.spec.ts                # 시나리오 5

apps/
  experimental-assistant-example/                 # 신설 (간단 echo bot)
    package.json
    src/index.ts
    README.md

# 기존 파일 수정
package.json                                       (workspaces + type-check 체이닝)
README.md / README.en.md                           (Phase 3에서 SDK 언급)
docs/integrations/_shared/system-prompt.md         (Phase 3)
docs/integrations/_shared/sdk-quickstart.md        (Phase 3, 신설)
docs/integrations/{openclaw,nanoclaw,zeroclaw}.md  (Phase 3)
docs/integrations/README.md                        (Phase 3)
```

**왜 이 구조인가:**
- `transport/`, `scoping/`, `lifecycle/`, `policy/`, `fallback/` 다섯 책임을 디렉터리로 분리 → 각 implementer가 한 영역만 보면 됨(컨텍스트 좁음 = 실수 적음).
- 테스트는 단위(`*.spec.ts`)는 src 옆, 통합/E2E는 `test/`로 분리. Vitest가 두 위치 다 알아서 수집.
- `apps/experimental-assistant-example/`은 README 예제의 *진짜 동작*을 보장.

---

## 작업 디렉터리 / 브랜치

이 plan은 `.worktrees/docs-external-assistant-l3-plan` 워크트리에서, 브랜치 `docs/external-assistant-l3-plan`에서 시작한다(이미 생성됨).

Phase 3는 Phase 2 PR 머지 후 main에서 새 워크트리/브랜치(`docs/external-assistant-l3-guide-upgrade`)를 만들어 진행한다.

---

# PHASE 2 — L3 SDK

## Task 0: 워크트리 / 브랜치 검증

**Files:** 없음 (검증만)

- [ ] **Step 1:** 현재 작업 위치가 워크트리 안인지 확인.

```bash
pwd
# expected: /home/jee1lee/git/memento/.worktrees/docs-external-assistant-l3-plan
```

- [ ] **Step 2:** 현재 브랜치 확인.

```bash
git branch --show-current
# expected: docs/external-assistant-l3-plan
git status --short
# expected: 깨끗하거나 추적되지 않은 plan 파일만
```

- [ ] **Step 3:** main 기준으로 ahead/behind 확인.

```bash
git fetch origin main
git log --oneline origin/main..HEAD
git log --oneline HEAD..origin/main
# expected: behind 0 또는 ff-fastforward 가능. behind 있으면 rebase 후 진행
```

> 검증만이고 commit 없음. 결과가 예상과 다르면 implementer는 멈추고 보고한다.

---

## Task 1: 패키지 스캐폴드 + workspace 배선

**Files:**
- Create: `packages/memento-assistant/package.json`
- Create: `packages/memento-assistant/tsconfig.json`
- Create: `packages/memento-assistant/tsconfig.build.json`
- Create: `packages/memento-assistant/vitest.config.ts`
- Create: `packages/memento-assistant/README.md` (placeholder, 1줄)
- Create: `packages/memento-assistant/src/index.ts` (빈 export)
- Modify: `package.json` (root) — `workspaces` 배열 + `type-check` 스크립트

> **참고 패턴:** `packages/memento-client/{package.json,tsconfig.json,vitest.config.ts}` 를 그대로 복사 후 이름/의존성만 교체한다.

- [ ] **Step 1: `packages/memento-client/package.json` 을 참고로 `packages/memento-assistant/package.json` 작성.**

핵심 필드:
```json
{
  "name": "@memento/assistant",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest --run",
    "test:ci": "vitest --run --reporter=basic"
  },
  "dependencies": {
    "@memento/client": "*",
    "@modelcontextprotocol/sdk": "<memento-server에서 쓰는 동일 버전>"
  },
  "devDependencies": {
    "typescript": "<root와 동일>",
    "vitest": "<root와 동일>"
  }
}
```

> 정확한 버전은 `packages/memento-server/package.json`에서 `@modelcontextprotocol/sdk`를, root `package.json`의 devDependencies에서 typescript/vitest를 그대로 가져온다.

- [ ] **Step 2: `tsconfig.json` / `tsconfig.build.json` 작성.**

`packages/memento-client/tsconfig.json`을 그대로 복사하고 `references`에 `../memento-client` 만 남긴다(`@memento/core`는 의존하지 않는다 — § "비-목표"의 invariant).

- [ ] **Step 3: `vitest.config.ts` 작성.**

`packages/memento-client/vitest.config.ts` 그대로. 단 `include`에 `test/**/*.spec.ts`도 추가한다(integration/e2e 위치).

- [ ] **Step 4: `src/index.ts` placeholder.**

```ts
// @memento/assistant - 외부 비서가 Memento를 자동 회상/저장 백엔드로 쓰게 해주는 SDK
// 자세한 내용은 README.md 참조.
export {};
```

- [ ] **Step 5: root `package.json` 수정.**

`workspaces` 배열에 `"packages/memento-assistant"` 추가(memento-client 다음 줄).

`scripts.type-check` 체인에 ` && npm run type-check -w @memento/assistant` 추가:
```json
"type-check": "npm run type-check -w @memento/core && npm run type-check -w memento-server && npm run type-check -w @memento/client && npm run type-check -w @memento/assistant && npm run type-check -w experimental-example"
```

> `build:packages`도 체인에 추가할지 검토 — SDK는 외부에서 import되므로 build:packages 끝에 ` && npm run build -w @memento/assistant` 추가하는 게 맞음.

- [ ] **Step 6: 부트스트랩 검증.**

```bash
npm install
# expected: lockfile 갱신, packages/memento-assistant 워크스페이스 인식

npm run type-check -w @memento/assistant
# expected: 통과 (코드 없으니 당연히)

npm run build -w @memento/assistant
# expected: dist/index.{js,d.ts} 생성
```

- [ ] **Step 7: Commit.**

```bash
git add packages/memento-assistant package.json package-lock.json
git commit -m "feat(assistant): scaffold @memento/assistant package + workspace wiring"
```

---

## Task 2: 공유 타입 (`types.ts`)

**Files:**
- Create: `packages/memento-assistant/src/types.ts`
- Create: `packages/memento-assistant/src/types.spec.ts`

`MementoAssistantOptions`, `Policy`, `ExtractedItem` 등 공개 타입을 한 파일에 모은다(다른 파일은 여기서만 import).

- [ ] **Step 1: 타입 사양 작성 (TDD — type-level 테스트 먼저).**

```ts
// packages/memento-assistant/src/types.spec.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { ExtractedItem, Policy, MementoAssistantOptions } from './types.js';

describe('types', () => {
  it('ExtractedItem union excludes commitment kind (v0.1)', () => {
    type Kinds = ExtractedItem['kind'];
    expectTypeOf<Kinds>().toEqualTypeOf<'fact' | 'preference' | 'event'>();
    // @ts-expect-error - commitment is not allowed in v0.1
    const _bad: ExtractedItem = { kind: 'commitment', content: 'x' };
  });

  it('Policy.crossChannelRecall accepts sameContext (handled at runtime)', () => {
    const p: Policy = { crossChannelRecall: 'sameContext' } as Policy;
    expectTypeOf(p.crossChannelRecall).toEqualTypeOf<'on' | 'off' | 'sameContext' | undefined>();
  });

  it('MementoAssistantOptions has minimal required fields', () => {
    expectTypeOf<MementoAssistantOptions>().toMatchTypeOf<{
      ownerId?: string; channel?: string; userTags?: string[]; policy?: Policy;
    }>();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인.**

```bash
npm test -w @memento/assistant -- src/types.spec.ts
# expected: FAIL, "Cannot find module './types.js'"
```

- [ ] **Step 3: `src/types.ts` 작성.**

```ts
// packages/memento-assistant/src/types.ts

export type ExtractedItem =
  | { kind: 'fact';       content: string; tags?: string[] }
  | { kind: 'preference'; content: string; tags?: string[] }
  | { kind: 'event';      content: string; at?: string; tags?: string[] };
// 'commitment' 의도적으로 제외 (spec § 6, v0.1) — kind:'event' + tags:['commitment']로 표현.

export interface Policy {
  autoRecall?: 'always' | 'heuristic' | 'off';
  autoRemember?: 'turn' | 'decision' | 'off';
  crossChannelRecall?: 'on' | 'off' | 'sameContext';
  tokenBudget?: number;
  recallLimit?: number;
  recallTimeoutMs?: number;
  degradeOnError?: boolean;
}

export interface MementoAssistantOptions {
  ownerId?: string;
  channel?: string;
  userTags?: string[];
  policy?: Policy;
  transport?: import('./transport/transport.js').Transport;  // 테스트에서 주입
}

export interface BeforeUserTurnInput {
  userMessage: string;
  conversationId: string;
}

export interface BeforeUserTurnResult {
  systemContext: string;
  references: ReadonlyArray<{ id: string; type: string; importance?: number }>;
  degraded: boolean;
}

export interface AfterAssistantTurnInput {
  userMessage: string;
  assistantReply: string;
  conversationId: string;
  extracted?: ReadonlyArray<ExtractedItem>;
}
```

- [ ] **Step 4: 테스트 통과 확인.**

```bash
npm test -w @memento/assistant -- src/types.spec.ts
# expected: PASS
```

- [ ] **Step 5: Commit.**

```bash
git add packages/memento-assistant/src/types.ts packages/memento-assistant/src/types.spec.ts
git commit -m "feat(assistant): public types (ExtractedItem, Policy, options)"
```

---

## Task 3: Transport 인터페이스 + MockTransport

**Files:**
- Create: `packages/memento-assistant/src/transport/transport.ts`
- Create: `packages/memento-assistant/src/transport/mock-transport.ts`
- Create: `packages/memento-assistant/src/transport/mock-transport.spec.ts`
- Create: `packages/memento-assistant/src/transport/index.ts` (barrel)

> Transport는 SDK 내부 추상화. recall/remember 두 메서드만 노출 — pin/forget/feedback 등은 v0.1 비-목표.

- [ ] **Step 1: 인터페이스 작성 (test 먼저).**

```ts
// packages/memento-assistant/src/transport/mock-transport.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from './mock-transport.js';

describe('MockTransport', () => {
  let t: MockTransport;
  beforeEach(() => { t = new MockTransport(); });

  it('records remember calls', async () => {
    await t.remember({ content: 'hello', type: 'working' });
    expect(t.rememberCalls).toHaveLength(1);
    expect(t.rememberCalls[0].content).toBe('hello');
  });

  it('returns recall fixtures', async () => {
    t.fixture('memory:1', { content: 'hello', type: 'semantic' });
    t.fixture('memory:2', { content: 'world', type: 'episodic' });
    const r = await t.recall('hello', { tags: [] }, 5);
    expect(r.items).toHaveLength(2);
  });

  it('throwOnNext recall makes one call reject', async () => {
    t.throwOnNextRecall(new Error('boom'));
    await expect(t.recall('x', undefined, 1)).rejects.toThrow('boom');
    // 다음 호출은 정상
    const r = await t.recall('x', undefined, 1);
    expect(r.items).toEqual([]);
  });

  it('close is idempotent', async () => {
    await t.close();
    await t.close();
    expect(t.closed).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인.**

```bash
npm test -w @memento/assistant -- src/transport/mock-transport.spec.ts
# expected: FAIL
```

- [ ] **Step 3: `transport.ts` 작성.**

```ts
// packages/memento-assistant/src/transport/transport.ts

export interface RecallParams {
  query: string;
  filters?: { tags?: string[]; ownerId?: string; type?: string[] };
  limit?: number;
}

export interface RememberParams {
  content: string;
  type: 'working' | 'episodic' | 'semantic' | 'procedural';
  tags?: string[];
  importance?: number;
  ownerId?: string;
  updateExisting?: { id: string };
}

export interface RecallResult {
  items: ReadonlyArray<{ id: string; content: string; type: string; importance?: number; score?: number }>;
}

export interface RememberResult {
  id: string;
}

export interface Transport {
  recall(query: string, filters?: RecallParams['filters'], limit?: number): Promise<RecallResult>;
  remember(params: RememberParams): Promise<RememberResult>;
  close(): Promise<void>;
}
```

- [ ] **Step 4: `mock-transport.ts` 작성.**

```ts
// packages/memento-assistant/src/transport/mock-transport.ts
import type { Transport, RecallResult, RememberParams, RememberResult } from './transport.js';

export class MockTransport implements Transport {
  rememberCalls: RememberParams[] = [];
  recallCalls: { query: string; filters?: any; limit?: number }[] = [];
  closed = false;
  private fixtures = new Map<string, { content: string; type: string; importance?: number }>();
  private nextRecallError: Error | null = null;
  private nextRememberError: Error | null = null;

  fixture(id: string, item: { content: string; type: string; importance?: number }) {
    this.fixtures.set(id, item);
  }

  throwOnNextRecall(err: Error) { this.nextRecallError = err; }
  throwOnNextRemember(err: Error) { this.nextRememberError = err; }

  async recall(query: string, filters?: any, limit?: number): Promise<RecallResult> {
    this.recallCalls.push({ query, filters, limit });
    if (this.nextRecallError) {
      const e = this.nextRecallError; this.nextRecallError = null; throw e;
    }
    const items = [...this.fixtures.entries()].map(([id, v]) => ({ id, ...v }));
    return { items: items.slice(0, limit ?? items.length) };
  }

  async remember(params: RememberParams): Promise<RememberResult> {
    this.rememberCalls.push(params);
    if (this.nextRememberError) {
      const e = this.nextRememberError; this.nextRememberError = null; throw e;
    }
    return { id: `mock:${this.rememberCalls.length}` };
  }

  async close() { this.closed = true; }
}
```

- [ ] **Step 5: `transport/index.ts` barrel.**

```ts
export type { Transport, RecallParams, RememberParams, RecallResult, RememberResult } from './transport.js';
export { MockTransport } from './mock-transport.js';
```

- [ ] **Step 6: 테스트 통과.**

```bash
npm test -w @memento/assistant -- src/transport/
# expected: 4/4 PASS
```

- [ ] **Step 7: Commit.**

```bash
git add packages/memento-assistant/src/transport/
git commit -m "feat(assistant): Transport interface + MockTransport"
```

---

## Task 4: stdio Transport

**Files:**
- Create: `packages/memento-assistant/src/transport/stdio-transport.ts`
- Create: `packages/memento-assistant/src/transport/stdio-transport.spec.ts`

> `@modelcontextprotocol/sdk/client/stdio` 의 `StdioClientTransport`를 사용해 child process를 spawn하고, MCP `tools/call` 로 `recall`/`remember` 도구를 호출한다.

> **Spec drift:** spec § 6의 기본 명령은 `npx -y memento-mcp-server@latest start --stdio` 였으나 `start` 서브커맨드는 존재하지 않는다. 본 plan의 기본 명령은 `npx -y memento-mcp-server@latest`. 가이드 문서의 기존 표기는 Phase 3에서 함께 보정한다.

- [ ] **Step 1: 테스트 (mocked spawn).**

`StdioClientTransport`를 vitest mock으로 감싸 실제 child를 띄우지 않고 RPC 흐름만 검증한다. 실제 spawn 검증은 Task 19(통합 테스트)로 미룬다.

```ts
// packages/memento-assistant/src/transport/stdio-transport.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StdioTransport } from './stdio-transport.js';

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockImplementation(async ({ name, arguments: args }: any) => {
      if (name === 'recall') return { content: [{ type: 'json', json: { items: [{ id: 'm:1', content: 'hi', type: 'semantic' }] } }] };
      if (name === 'remember') return { content: [{ type: 'json', json: { id: 'm:2' } }] };
      throw new Error(`unknown tool ${name}`);
    }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

describe('StdioTransport', () => {
  it('spawns child with default command and forwards recall', async () => {
    const t = new StdioTransport({ command: 'npx', args: ['-y', 'memento-mcp-server@latest'] });
    await t.connect();
    const r = await t.recall('hi', undefined, 1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].id).toBe('m:1');
  });

  it('forwards remember', async () => {
    const t = new StdioTransport({ command: 'npx', args: ['-y', 'memento-mcp-server@latest'] });
    await t.connect();
    const r = await t.remember({ content: 'x', type: 'working' });
    expect(r.id).toBe('m:2');
  });

  it('close is idempotent', async () => {
    const t = new StdioTransport({ command: 'x', args: [] });
    await t.connect();
    await t.close();
    await t.close();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인.** `npm test -w @memento/assistant -- src/transport/stdio-transport.spec.ts`

- [ ] **Step 3: 구현.**

```ts
// packages/memento-assistant/src/transport/stdio-transport.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport, RecallResult, RememberParams, RememberResult } from './transport.js';

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export class StdioTransport implements Transport {
  private client: Client | null = null;
  private inner: StdioClientTransport | null = null;
  private connected = false;

  constructor(private readonly opts: StdioTransportOptions) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    this.inner = new StdioClientTransport({
      command: this.opts.command,
      args: this.opts.args ?? [],
      env: { ...process.env, ...(this.opts.env ?? {}) } as Record<string, string>,
      cwd: this.opts.cwd,
    });
    this.client = new Client({ name: 'memento-assistant', version: '0.1.0' }, { capabilities: {} });
    await this.client.connect(this.inner);
    this.connected = true;
  }

  async recall(query: string, filters?: any, limit?: number): Promise<RecallResult> {
    if (!this.client) await this.connect();
    const r = await this.client!.callTool({
      name: 'recall',
      arguments: { query, ...(filters ?? {}), limit },
    });
    return parseToolJson<RecallResult>(r) ?? { items: [] };
  }

  async remember(params: RememberParams): Promise<RememberResult> {
    if (!this.client) await this.connect();
    const r = await this.client!.callTool({ name: 'remember', arguments: params });
    const out = parseToolJson<RememberResult>(r);
    if (!out) throw new Error('memento remember: empty response');
    return out;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try { await this.client?.close(); } catch { /* ignore */ }
    this.connected = false;
    this.client = null;
    this.inner = null;
  }
}

function parseToolJson<T>(resp: { content?: Array<{ type: string; json?: unknown; text?: string }> }): T | null {
  for (const part of resp.content ?? []) {
    if (part.type === 'json' && part.json !== undefined) return part.json as T;
    if (part.type === 'text' && part.text) {
      try { return JSON.parse(part.text) as T; } catch { /* continue */ }
    }
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인.**

- [ ] **Step 5: Commit.**

```bash
git add packages/memento-assistant/src/transport/stdio-transport.ts packages/memento-assistant/src/transport/stdio-transport.spec.ts
git commit -m "feat(assistant): stdio transport via @modelcontextprotocol/sdk"
```

---

## Task 5: HTTP Transport

**Files:**
- Create: `packages/memento-assistant/src/transport/http-transport.ts`
- Create: `packages/memento-assistant/src/transport/http-transport.spec.ts`

> `@memento/client` 의 `MementoClient`를 thin-wrap. 클라이언트는 이미 `recall(query, filters, limit, recallExtras)` 와 `remember(CreateMemoryParams)` 를 노출하므로 시그니처를 `Transport`로 어댑팅하면 된다.

- [ ] **Step 1: 테스트.**

```ts
// packages/memento-assistant/src/transport/http-transport.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpTransport } from './http-transport.js';

vi.mock('@memento/client', () => {
  return {
    MementoClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      recall: vi.fn().mockResolvedValue({ items: [{ id: 'h:1', content: 'a', type: 'semantic' }] }),
      remember: vi.fn().mockResolvedValue({ memory_id: 'h:2', created_at: '2026-05-01T00:00:00Z' }),
    })),
  };
});

describe('HttpTransport', () => {
  it('calls recall and adapts result shape', async () => {
    const t = new HttpTransport({ baseUrl: 'http://localhost:9001', token: 'tok' });
    await t.connect();
    const r = await t.recall('q', { tags: ['channel:tg'] }, 5);
    expect(r.items[0].id).toBe('h:1');
  });

  it('calls remember and maps memory_id → id', async () => {
    const t = new HttpTransport({ baseUrl: 'http://localhost:9001', token: 'tok' });
    const r = await t.remember({ content: 'x', type: 'working' });
    expect(r.id).toBe('h:2');
  });

  it('close calls underlying disconnect', async () => {
    const t = new HttpTransport({ baseUrl: 'http://localhost:9001', token: 'tok' });
    await t.connect();
    await t.close();
    // 중복 close 안전
    await t.close();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인.**

- [ ] **Step 3: 구현.**

```ts
// packages/memento-assistant/src/transport/http-transport.ts
import { MementoClient } from '@memento/client';
import type { Transport, RecallResult, RememberParams, RememberResult } from './transport.js';

export interface HttpTransportOptions {
  baseUrl: string;
  token?: string;
}

export class HttpTransport implements Transport {
  private client: MementoClient;
  private connected = false;

  constructor(opts: HttpTransportOptions) {
    this.client = new MementoClient({ serverUrl: opts.baseUrl, apiKey: opts.token });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
  }

  async recall(query: string, filters?: any, limit?: number): Promise<RecallResult> {
    if (!this.connected) await this.connect();
    const r = await this.client.recall(query, filters, limit);
    return { items: r.items };
  }

  async remember(params: RememberParams): Promise<RememberResult> {
    if (!this.connected) await this.connect();
    const r = await this.client.remember({
      content: params.content,
      type: params.type,
      tags: params.tags,
      importance: params.importance,
      ...(params.updateExisting ? { update_existing: { id: params.updateExisting.id } } : {}),
    } as any);
    return { id: (r as any).memory_id ?? (r as any).id };
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try { await this.client.disconnect(); } catch { /* ignore */ }
    this.connected = false;
  }
}
```

> 정확한 `CreateMemoryParams` / `RememberResult` 시그니처는 `packages/memento-client/src/types.ts`에서 확인한다. `memory_id` vs `id` 명명은 client 결과를 직접 들여다본 뒤 결정.

- [ ] **Step 4: 테스트 통과.**

- [ ] **Step 5: Commit.**

```bash
git add packages/memento-assistant/src/transport/http-transport.ts packages/memento-assistant/src/transport/http-transport.spec.ts
git commit -m "feat(assistant): http transport over @memento/client"
```

---

## Task 6: Transport Factory + 환경변수 해석

**Files:**
- Create: `packages/memento-assistant/src/transport/factory.ts`
- Create: `packages/memento-assistant/src/transport/factory.spec.ts`

`MEMENTO_TRANSPORT`, `MEMENTO_URL`, `MEMENTO_TOKEN`, `MEMENTO_STDIO_COMMAND` 를 읽어 `Transport` 인스턴스를 만든다. 명시 옵션 > 환경변수 > 기본값.

- [ ] **Step 1: 테스트.**

```ts
import { describe, it, expect } from 'vitest';
import { createTransportFromEnv } from './factory.js';
import { StdioTransport } from './stdio-transport.js';
import { HttpTransport } from './http-transport.js';

describe('createTransportFromEnv', () => {
  it('defaults to stdio with npx command', () => {
    const t = createTransportFromEnv({}, {});
    expect(t).toBeInstanceOf(StdioTransport);
  });

  it('uses http when MEMENTO_TRANSPORT=http and url present', () => {
    const t = createTransportFromEnv({}, {
      MEMENTO_TRANSPORT: 'http',
      MEMENTO_URL: 'http://localhost:9001',
      MEMENTO_TOKEN: 'tok',
    });
    expect(t).toBeInstanceOf(HttpTransport);
  });

  it('throws when http selected without url', () => {
    expect(() => createTransportFromEnv({}, { MEMENTO_TRANSPORT: 'http' }))
      .toThrow(/MEMENTO_URL/);
  });

  it('explicit transport option wins over env', () => {
    const explicit = new StdioTransport({ command: 'x', args: [] });
    const t = createTransportFromEnv({ transport: explicit }, { MEMENTO_TRANSPORT: 'http', MEMENTO_URL: 'http://x' });
    expect(t).toBe(explicit);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인.**

- [ ] **Step 3: 구현.**

```ts
// packages/memento-assistant/src/transport/factory.ts
import { StdioTransport } from './stdio-transport.js';
import { HttpTransport } from './http-transport.js';
import type { Transport } from './transport.js';

const DEFAULT_STDIO_COMMAND = 'npx';
const DEFAULT_STDIO_ARGS = ['-y', 'memento-mcp-server@latest'];

interface FactoryOptions {
  transport?: Transport;
}

export function createTransportFromEnv(opts: FactoryOptions, env: NodeJS.ProcessEnv): Transport {
  if (opts.transport) return opts.transport;

  const kind = (env.MEMENTO_TRANSPORT ?? 'stdio').toLowerCase();
  if (kind === 'http') {
    const baseUrl = env.MEMENTO_URL;
    if (!baseUrl) throw new Error('MEMENTO_URL is required when MEMENTO_TRANSPORT=http');
    return new HttpTransport({ baseUrl, token: env.MEMENTO_TOKEN });
  }
  if (kind === 'stdio') {
    const cmdLine = env.MEMENTO_STDIO_COMMAND;
    if (cmdLine && cmdLine.trim().length > 0) {
      const [command, ...args] = cmdLine.split(/\s+/);
      return new StdioTransport({ command, args });
    }
    return new StdioTransport({ command: DEFAULT_STDIO_COMMAND, args: DEFAULT_STDIO_ARGS });
  }
  throw new Error(`Unknown MEMENTO_TRANSPORT="${kind}"`);
}
```

- [ ] **Step 4: 테스트 통과 확인.**

- [ ] **Step 5: Commit.**

```bash
git add packages/memento-assistant/src/transport/factory.ts packages/memento-assistant/src/transport/factory.spec.ts
git commit -m "feat(assistant): transport factory with env resolution"
```

---

## Task 7: Channel Scoping

**Files:**
- Create: `packages/memento-assistant/src/scoping/channel-scope.ts`
- Create: `packages/memento-assistant/src/scoping/channel-scope.spec.ts`

`scopeRecall(filters, opts)` / `scopeRemember(params, opts)` 두 순수 함수. 라이프사이클 훅에서 호출.

- [ ] **Step 1: 테스트.**

```ts
import { describe, it, expect } from 'vitest';
import { scopeRecallFilters, scopeRememberTags } from './channel-scope.js';

describe('scoping', () => {
  describe('scopeRecallFilters', () => {
    it('crossChannelRecall=on: leaves tags untouched', () => {
      const out = scopeRecallFilters({ ownerId: 'u', channel: 'tg', crossChannelRecall: 'on' }, {});
      expect(out.tags).toBeUndefined();
      expect(out.ownerId).toBe('u');
    });

    it('crossChannelRecall=off: adds channel tag', () => {
      const out = scopeRecallFilters({ ownerId: 'u', channel: 'tg', crossChannelRecall: 'off' }, {});
      expect(out.tags).toEqual(['channel:tg']);
    });

    it("crossChannelRecall='sameContext' WARNs once and falls back to 'on' (no throw)", () => {
      const warnings: string[] = [];
      const out = scopeRecallFilters(
        { ownerId: 'u', channel: 'tg', crossChannelRecall: 'sameContext' },
        {},
        { warn: (m) => warnings.push(m) }
      );
      expect(out.tags).toBeUndefined();  // fell back to 'on'
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/sameContext/);

      // 같은 인스턴스에서 두 번째 호출 시 WARN 안 나와야 함 (rate-limit by call-site)
      // 이 검증은 lifecycle/before-user-turn에서 (Task 9)
    });

    it('preserves user-supplied tags', () => {
      const out = scopeRecallFilters(
        { ownerId: 'u', channel: 'tg', crossChannelRecall: 'off' },
        { tags: ['topic:food'] }
      );
      expect(out.tags).toEqual(expect.arrayContaining(['channel:tg', 'topic:food']));
    });
  });

  describe('scopeRememberTags', () => {
    it('merges userTags + channel + conversation', () => {
      const tags = scopeRememberTags(
        { channel: 'discord', userTags: ['persona:asst'] },
        { conversationId: 'c-42' }
      );
      expect(tags).toEqual(expect.arrayContaining(['channel:discord', 'conv:c-42', 'persona:asst']));
    });

    it('skips channel tag when channel is undefined', () => {
      const tags = scopeRememberTags({}, { conversationId: 'c-1' });
      expect(tags.some(t => t.startsWith('channel:'))).toBe(false);
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인.**

- [ ] **Step 3: 구현.**

```ts
// packages/memento-assistant/src/scoping/channel-scope.ts

interface ScopeOpts {
  ownerId?: string;
  channel?: string;
  userTags?: string[];
  crossChannelRecall?: 'on' | 'off' | 'sameContext';
}

interface Logger { warn(msg: string): void }
const noopLogger: Logger = { warn() {} };

export function scopeRecallFilters(
  scope: ScopeOpts,
  filters: { tags?: string[]; ownerId?: string; type?: string[] },
  logger: Logger = noopLogger,
): { tags?: string[]; ownerId?: string; type?: string[] } {
  const ownerId = filters.ownerId ?? scope.ownerId;
  let mode = scope.crossChannelRecall ?? 'on';
  if (mode === 'sameContext') {
    logger.warn("crossChannelRecall='sameContext' is reserved for v0.2; falling back to 'on' for v0.1");
    mode = 'on';
  }
  if (mode === 'on') {
    return { ...filters, ownerId };
  }
  // mode === 'off'
  const channelTag = scope.channel ? [`channel:${scope.channel}`] : [];
  const tags = Array.from(new Set([...(filters.tags ?? []), ...channelTag]));
  return { ...filters, tags, ownerId };
}

export function scopeRememberTags(
  scope: ScopeOpts,
  ctx: { conversationId?: string },
): string[] {
  const out: string[] = [...(scope.userTags ?? [])];
  if (scope.channel) out.push(`channel:${scope.channel}`);
  if (ctx.conversationId) out.push(`conv:${ctx.conversationId}`);
  return Array.from(new Set(out));
}
```

- [ ] **Step 4: 테스트 통과 + Commit.**

```bash
npm test -w @memento/assistant -- src/scoping/
git add packages/memento-assistant/src/scoping/
git commit -m "feat(assistant): channel scoping with sameContext WARN+fallback"
```

---

## Task 8: Auto-recall Policy + Auto-remember Policy

**Files:**
- Create: `packages/memento-assistant/src/policy/auto-recall-policy.ts`
- Create: `packages/memento-assistant/src/policy/auto-recall-policy.spec.ts`
- Create: `packages/memento-assistant/src/policy/auto-remember-policy.ts`
- Create: `packages/memento-assistant/src/policy/auto-remember-policy.spec.ts`

순수 함수 두 개:
- `shouldRecall(mode, msg) → boolean`
- `rememberDispatch(mode, turn, extracted?) → Array<{type, content, tags?, importance?}>` (실제 저장은 lifecycle에서)

- [ ] **Step 1: `auto-recall-policy.spec.ts`.**

```ts
import { describe, it, expect } from 'vitest';
import { shouldAutoRecall } from './auto-recall-policy.js';

describe('shouldAutoRecall', () => {
  it("'always' returns true regardless of message", () => {
    expect(shouldAutoRecall('always', 'hi')).toBe(true);
    expect(shouldAutoRecall('always', '')).toBe(true);
  });

  it("'off' returns false", () => {
    expect(shouldAutoRecall('off', 'hi?')).toBe(false);
  });

  it("'heuristic' is true for question marks", () => {
    expect(shouldAutoRecall('heuristic', 'where did we go last time?')).toBe(true);
  });

  it("'heuristic' is true for long messages", () => {
    expect(shouldAutoRecall('heuristic', 'a'.repeat(60))).toBe(true);
  });

  it("'heuristic' is false for short greetings", () => {
    expect(shouldAutoRecall('heuristic', 'hi')).toBe(false);
    expect(shouldAutoRecall('heuristic', '안녕')).toBe(false);
  });

  it("'heuristic' is true for pronoun reference", () => {
    expect(shouldAutoRecall('heuristic', 'that one was good')).toBe(true);
    expect(shouldAutoRecall('heuristic', '그거 어땠지')).toBe(true);
  });

  it('default mode is always', () => {
    expect(shouldAutoRecall(undefined, 'x')).toBe(true);
  });
});
```

- [ ] **Step 2: `auto-recall-policy.ts` 구현.**

```ts
// packages/memento-assistant/src/policy/auto-recall-policy.ts
const PRONOUN_RE = /\b(it|that|those|these|this|he|she|they|him|her|them)\b|그거|그것|저번|지난번/i;
const HEURISTIC_MIN_LEN = 50;

export function shouldAutoRecall(mode: 'always' | 'heuristic' | 'off' | undefined, msg: string): boolean {
  const m = mode ?? 'always';
  if (m === 'off') return false;
  if (m === 'always') return true;
  // heuristic
  if (msg.includes('?') || msg.includes('？')) return true;
  if (msg.length >= HEURISTIC_MIN_LEN) return true;
  if (PRONOUN_RE.test(msg)) return true;
  return false;
}
```

- [ ] **Step 3: `auto-remember-policy.spec.ts`.**

```ts
import { describe, it, expect } from 'vitest';
import { rememberDispatch } from './auto-remember-policy.js';

describe('rememberDispatch', () => {
  it("'turn' returns single working memory entry", () => {
    const out = rememberDispatch('turn', { user: 'u', assistant: 'a' });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('working');
    expect(out[0].content).toContain('u');
    expect(out[0].content).toContain('a');
  });

  it("'decision' without extracted falls back to turn-only", () => {
    const out = rememberDispatch('decision', { user: 'u', assistant: 'a' });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('working');
  });

  it("'decision' with fact emits semantic + working", () => {
    const out = rememberDispatch('decision', { user: 'u', assistant: 'a' }, [
      { kind: 'fact', content: 'birthday: 5/10' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find(x => x.type === 'semantic')?.content).toBe('birthday: 5/10');
    expect(out.find(x => x.type === 'working')).toBeDefined();
  });

  it("'decision' with preference assigns importance 0.7", () => {
    const out = rememberDispatch('decision', { user: 'u', assistant: 'a' }, [
      { kind: 'preference', content: 'prefers tea over coffee' },
    ]);
    const sem = out.find(x => x.type === 'semantic')!;
    expect(sem.importance).toBeCloseTo(0.7);
  });

  it("'decision' with event maps to episodic", () => {
    const out = rememberDispatch('decision', { user: 'u', assistant: 'a' }, [
      { kind: 'event', content: 'met X', at: '2026-05-10T10:00:00Z' },
    ]);
    expect(out.find(x => x.type === 'episodic')).toBeDefined();
  });

  it("'off' returns empty", () => {
    const out = rememberDispatch('off', { user: 'u', assistant: 'a' });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 4: `auto-remember-policy.ts` 구현.**

```ts
// packages/memento-assistant/src/policy/auto-remember-policy.ts
import type { ExtractedItem } from '../types.js';

export interface RememberDispatchItem {
  type: 'working' | 'episodic' | 'semantic';
  content: string;
  tags?: string[];
  importance?: number;
  at?: string;
}

export function rememberDispatch(
  mode: 'turn' | 'decision' | 'off' | undefined,
  turn: { user: string; assistant: string },
  extracted?: ReadonlyArray<ExtractedItem>,
): RememberDispatchItem[] {
  const m = mode ?? 'turn';
  if (m === 'off') return [];

  const turnEntry: RememberDispatchItem = {
    type: 'working',
    content: `User: ${turn.user}\nAssistant: ${turn.assistant}`,
  };

  if (m === 'turn') return [turnEntry];

  // m === 'decision'
  const out: RememberDispatchItem[] = [turnEntry];
  for (const item of extracted ?? []) {
    if (item.kind === 'fact') {
      out.push({ type: 'semantic', content: item.content, tags: item.tags });
    } else if (item.kind === 'preference') {
      out.push({ type: 'semantic', content: item.content, tags: item.tags, importance: 0.7 });
    } else if (item.kind === 'event') {
      out.push({ type: 'episodic', content: item.content, tags: item.tags, at: item.at });
    }
  }
  return out;
}
```

- [ ] **Step 5: 테스트 통과 + Commit.**

```bash
npm test -w @memento/assistant -- src/policy/
git add packages/memento-assistant/src/policy/
git commit -m "feat(assistant): auto-recall + auto-remember policies"
```

---

## Task 9: Logger (rate-limited) + Circuit Breaker + Retry Queue

**Files:**
- Create: `packages/memento-assistant/src/fallback/logger.ts`
- Create: `packages/memento-assistant/src/fallback/logger.spec.ts`
- Create: `packages/memento-assistant/src/fallback/circuit-breaker.ts`
- Create: `packages/memento-assistant/src/fallback/circuit-breaker.spec.ts`
- Create: `packages/memento-assistant/src/fallback/retry-queue.ts`
- Create: `packages/memento-assistant/src/fallback/retry-queue.spec.ts`

세 개 모두 작은 인-프로세스 유틸. lifecycle 훅에서 합성된다. **`MEMENTO_ASSISTANT_LOG`** 환경변수로 레벨 제어(spec drift 보정 — § Pre-flight 표 참조).

- [ ] **Step 1: `logger.spec.ts`.**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimitedLogger } from './logger.js';

describe('rate-limited logger', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('respects MEMENTO_ASSISTANT_LOG=warn (no info output)', () => {
    const sink = vi.fn();
    const log = createRateLimitedLogger({ level: 'warn', sink });
    log.info('x');
    expect(sink).not.toHaveBeenCalled();
    log.warn('first');
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('rate-limits same warn to once per minute', () => {
    const sink = vi.fn();
    const log = createRateLimitedLogger({ level: 'warn', sink });
    log.warn('boom: timeout');
    log.warn('boom: timeout');
    log.warn('boom: timeout');
    expect(sink).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61_000);
    log.warn('boom: timeout');
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('different keys are independent', () => {
    const sink = vi.fn();
    const log = createRateLimitedLogger({ level: 'warn', sink });
    log.warn('a');
    log.warn('b');
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: `logger.ts` 구현.**

```ts
// packages/memento-assistant/src/fallback/logger.ts
type Level = 'error' | 'warn' | 'info' | 'debug';
const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const RATE_LIMIT_MS = 60_000;

export interface AssistantLogger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}

interface CreateOpts {
  level: Level;
  sink: (line: { level: Level; msg: string }) => void;
}

export function createRateLimitedLogger(opts: CreateOpts): AssistantLogger {
  const lastEmit = new Map<string, number>();
  const emit = (level: Level, msg: string) => {
    if (ORDER[level] > ORDER[opts.level]) return;
    if (level === 'warn' || level === 'info') {
      const last = lastEmit.get(msg) ?? -Infinity;
      const now = Date.now();
      if (now - last < RATE_LIMIT_MS) return;
      lastEmit.set(msg, now);
    }
    opts.sink({ level, msg });
  };
  return {
    error: (m) => emit('error', m),
    warn:  (m) => emit('warn', m),
    info:  (m) => emit('info', m),
    debug: (m) => emit('debug', m),
  };
}

export function levelFromEnv(env: NodeJS.ProcessEnv): Level {
  const v = (env.MEMENTO_ASSISTANT_LOG ?? 'warn').toLowerCase();
  if (v === 'error' || v === 'warn' || v === 'info' || v === 'debug') return v;
  return 'warn';
}

export const consoleSink = (line: { level: Level; msg: string }) => {
  const out = `[memento-assistant] ${line.level}: ${line.msg}`;
  if (line.level === 'error' || line.level === 'warn') console.error(out);
  else console.log(out);
};
```

- [ ] **Step 3: `circuit-breaker.spec.ts`.**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts closed and allows calls', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 });
    expect(cb.canPass()).toBe(true);
  });

  it('opens after N consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 30_000 });
    cb.recordFailure(); cb.recordFailure(); cb.recordFailure();
    expect(cb.canPass()).toBe(false);
  });

  it('one success resets counter while closed', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 30_000 });
    cb.recordFailure(); cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure(); cb.recordFailure();
    expect(cb.canPass()).toBe(true);  // 4 consecutive only after reset
  });

  it('after openMs, allows half-open probe', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 30_000 });
    cb.recordFailure();
    expect(cb.canPass()).toBe(false);
    vi.advanceTimersByTime(31_000);
    expect(cb.canPass()).toBe(true);  // half-open probe
  });

  it('half-open success → closed; failure → open again', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 30_000 });
    cb.recordFailure();
    vi.advanceTimersByTime(31_000);
    expect(cb.canPass()).toBe(true);
    cb.recordFailure();  // probe failed
    expect(cb.canPass()).toBe(false);
  });
});
```

- [ ] **Step 4: `circuit-breaker.ts` 구현.**

```ts
// packages/memento-assistant/src/fallback/circuit-breaker.ts
type State = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOpts {
  failureThreshold: number;
  openMs: number;
}

export class CircuitBreaker {
  private state: State = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  constructor(private readonly opts: CircuitBreakerOpts) {}

  canPass(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.opts.openMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    // half-open
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    if (this.state === 'half-open') {
      this.state = 'open';
      this.openedAt = Date.now();
      return;
    }
    if (this.consecutiveFailures >= this.opts.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}
```

- [ ] **Step 5: `retry-queue.spec.ts`.**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetryQueue } from './retry-queue.js';

describe('RetryQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs successful job once and removes it', async () => {
    const q = new RetryQueue({ maxAttempts: 3, capacity: 100, backoffMs: [1000, 2000, 4000] });
    const fn = vi.fn().mockResolvedValue(undefined);
    q.enqueue(fn);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });

  it('retries on failure with backoff', async () => {
    const q = new RetryQueue({ maxAttempts: 3, capacity: 100, backoffMs: [1000, 2000, 4000] });
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValueOnce(undefined);
    q.enqueue(fn);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(q.size()).toBe(0);
  });

  it('drops job after maxAttempts and emits drop event', async () => {
    const drops: string[] = [];
    const q = new RetryQueue({ maxAttempts: 3, capacity: 100, backoffMs: [10, 20, 40], onDrop: () => drops.push('x') });
    q.enqueue(vi.fn().mockRejectedValue(new Error('always')));
    await vi.advanceTimersByTimeAsync(100);
    expect(drops).toHaveLength(1);
    expect(q.size()).toBe(0);
  });

  it('drops oldest when capacity exceeded', () => {
    const q = new RetryQueue({ maxAttempts: 3, capacity: 2, backoffMs: [10, 20, 40] });
    q.enqueue(vi.fn().mockResolvedValue(undefined));
    q.enqueue(vi.fn().mockResolvedValue(undefined));
    q.enqueue(vi.fn().mockResolvedValue(undefined));
    expect(q.size()).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 6: `retry-queue.ts` 구현.** (작성 시 `setTimeout` 기반 fire-and-forget. 자세한 구현은 implementer에게 위임 — 위 테스트 5개를 통과하는 최소 구현.)

핵심 시그니처:
```ts
export interface RetryQueueOpts {
  maxAttempts: number;
  capacity: number;
  backoffMs: number[];   // length 결정 = max attempts - 1
  onDrop?: (reason: 'maxAttempts' | 'capacity', err?: Error) => void;
}

export class RetryQueue {
  constructor(opts: RetryQueueOpts);
  enqueue(fn: () => Promise<void>): void;
  size(): number;
  // 프로세스 종료 시 큐는 그대로 손실 — graceful drain 없음 (spec § 8 결정)
}
```

- [ ] **Step 7: 모든 fallback 테스트 통과 + Commit.**

```bash
npm test -w @memento/assistant -- src/fallback/
git add packages/memento-assistant/src/fallback/
git commit -m "feat(assistant): logger + circuit breaker + retry queue"
```

---

## Task 10: `MementoAssistant` 클래스 + `fromEnv` skeleton

**Files:**
- Create: `packages/memento-assistant/src/assistant.ts`
- Create: `packages/memento-assistant/src/assistant.spec.ts`
- Modify: `packages/memento-assistant/src/index.ts` (export)

`fromEnv` 가 환경변수 + 옵션으로 생성. 라이프사이클 메서드는 다음 task들에서 채운다 — 본 task는 생성/구성만.

- [ ] **Step 1: `assistant.spec.ts`.** (생성/구성만 검증)

```ts
import { describe, it, expect } from 'vitest';
import { MementoAssistant } from './assistant.js';
import { MockTransport } from './transport/mock-transport.js';

describe('MementoAssistant constructor', () => {
  it('uses defaults when no options', () => {
    const a = MementoAssistant.fromEnv({ transport: new MockTransport() }, {});
    expect(a.policy.autoRecall).toBe('always');
    expect(a.policy.autoRemember).toBe('turn');
    expect(a.policy.crossChannelRecall).toBe('on');
    expect(a.policy.tokenBudget).toBe(1200);
    expect(a.policy.recallLimit).toBe(8);
    expect(a.policy.recallTimeoutMs).toBe(1500);
    expect(a.policy.degradeOnError).toBe(true);
  });

  it('explicit options override env defaults', () => {
    const a = MementoAssistant.fromEnv(
      { transport: new MockTransport(), ownerId: 'u', channel: 'tg', policy: { autoRecall: 'off' } },
      { MEMENTO_OWNER_ID: 'env-u', MEMENTO_CHANNEL: 'discord' }
    );
    expect(a.ownerId).toBe('u');
    expect(a.channel).toBe('tg');
    expect(a.policy.autoRecall).toBe('off');
  });

  it('falls back to env when options missing', () => {
    const a = MementoAssistant.fromEnv(
      { transport: new MockTransport() },
      { MEMENTO_OWNER_ID: 'env-u', MEMENTO_CHANNEL: 'discord' }
    );
    expect(a.ownerId).toBe('env-u');
    expect(a.channel).toBe('discord');
  });
});
```

- [ ] **Step 2: `assistant.ts` skeleton.**

```ts
// packages/memento-assistant/src/assistant.ts
import type { MementoAssistantOptions, Policy, BeforeUserTurnInput, BeforeUserTurnResult, AfterAssistantTurnInput } from './types.js';
import type { Transport, RecallResult, RememberResult, RememberParams } from './transport/transport.js';
import { createTransportFromEnv } from './transport/factory.js';
import { createRateLimitedLogger, levelFromEnv, consoleSink, type AssistantLogger } from './fallback/logger.js';

const DEFAULT_POLICY: Required<Policy> = {
  autoRecall: 'always',
  autoRemember: 'turn',
  crossChannelRecall: 'on',
  tokenBudget: 1200,
  recallLimit: 8,
  recallTimeoutMs: 1500,
  degradeOnError: true,
};

export class MementoAssistant {
  readonly ownerId?: string;
  readonly channel?: string;
  readonly userTags: string[];
  readonly policy: Required<Policy>;
  readonly transport: Transport;
  readonly logger: AssistantLogger;

  private constructor(args: {
    ownerId?: string; channel?: string; userTags?: string[];
    policy: Required<Policy>; transport: Transport; logger: AssistantLogger;
  }) {
    this.ownerId = args.ownerId;
    this.channel = args.channel;
    this.userTags = args.userTags ?? [];
    this.policy = args.policy;
    this.transport = args.transport;
    this.logger = args.logger;
  }

  static fromEnv(opts: MementoAssistantOptions, env: NodeJS.ProcessEnv): MementoAssistant {
    const transport = createTransportFromEnv({ transport: opts.transport }, env);
    const logger = createRateLimitedLogger({ level: levelFromEnv(env), sink: consoleSink });
    const policy: Required<Policy> = { ...DEFAULT_POLICY, ...(opts.policy ?? {}) };
    return new MementoAssistant({
      ownerId: opts.ownerId ?? env.MEMENTO_OWNER_ID,
      channel: opts.channel ?? env.MEMENTO_CHANNEL,
      userTags: opts.userTags,
      policy,
      transport,
      logger,
    });
  }

  // 라이프사이클 메서드는 다음 task에서 추가
  async beforeUserTurn(_input: BeforeUserTurnInput): Promise<BeforeUserTurnResult> {
    throw new Error('not implemented');
  }
  async afterAssistantTurn(_input: AfterAssistantTurnInput): Promise<void> {
    throw new Error('not implemented');
  }

  // passthrough
  async recall(query: string, filters?: any, limit?: number): Promise<RecallResult> {
    return this.transport.recall(query, filters, limit);
  }
  async remember(params: RememberParams): Promise<RememberResult> {
    return this.transport.remember(params);
  }
  async close(): Promise<void> {
    return this.transport.close();
  }
}
```

- [ ] **Step 3: `index.ts` export.**

```ts
export { MementoAssistant } from './assistant.js';
export type { MementoAssistantOptions, Policy, ExtractedItem, BeforeUserTurnInput, BeforeUserTurnResult, AfterAssistantTurnInput } from './types.js';
export { MockTransport } from './transport/mock-transport.js';
export type { Transport, RecallParams, RememberParams } from './transport/transport.js';
```

- [ ] **Step 4: 테스트 통과 + Commit.**

```bash
npm test -w @memento/assistant -- src/assistant.spec.ts
git add packages/memento-assistant/src/assistant.ts packages/memento-assistant/src/assistant.spec.ts packages/memento-assistant/src/index.ts
git commit -m "feat(assistant): MementoAssistant skeleton + fromEnv composition"
```

---

## Task 11: `beforeUserTurn` — autoRecall='always' happy path

**Files:**
- Create: `packages/memento-assistant/src/lifecycle/before-user-turn.ts`
- Create: `packages/memento-assistant/src/lifecycle/before-user-turn.spec.ts`
- Modify: `packages/memento-assistant/src/assistant.ts` (실제 구현으로 교체)

> 4 sub-task로 나눠 진행한다(Task 11 / 12 / 13 / 14). 각 sub-task는 독립적으로 commit, 테스트는 누적적으로 추가.

- [ ] **Step 1: 테스트 — happy path.**

```ts
import { describe, it, expect } from 'vitest';
import { MementoAssistant } from '../assistant.js';
import { MockTransport } from '../transport/mock-transport.js';

describe('beforeUserTurn — always mode', () => {
  it('calls transport.recall and formats systemContext with <memento> fence', async () => {
    const t = new MockTransport();
    t.fixture('m:1', { content: '저번에 5/10이 생일이라 했음', type: 'semantic' });
    t.fixture('m:2', { content: '회사: A', type: 'semantic' });
    const a = MementoAssistant.fromEnv({ transport: t, ownerId: 'u' }, {});
    const r = await a.beforeUserTurn({ userMessage: '내 생일 언제?', conversationId: 'c1' });
    expect(r.degraded).toBe(false);
    expect(r.systemContext).toMatch(/^<memento>/);
    expect(r.systemContext).toMatch(/<\/memento>$/);
    expect(r.systemContext).toContain('5/10');
    expect(r.references).toHaveLength(2);
    expect(t.recallCalls).toHaveLength(1);
    expect(t.recallCalls[0].query).toBe('내 생일 언제?');
  });

  it('passes ownerId via filters', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, ownerId: 'u' }, {});
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls[0].filters?.ownerId).toBe('u');
  });

  it('honors recallLimit policy', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { recallLimit: 3 } }, {});
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls[0].limit).toBe(3);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인.**

- [ ] **Step 3: `before-user-turn.ts` 구현.**

```ts
// packages/memento-assistant/src/lifecycle/before-user-turn.ts
import type { BeforeUserTurnInput, BeforeUserTurnResult, Policy } from '../types.js';
import type { Transport } from '../transport/transport.js';
import { shouldAutoRecall } from '../policy/auto-recall-policy.js';
import { scopeRecallFilters } from '../scoping/channel-scope.js';
import type { AssistantLogger } from '../fallback/logger.js';

interface Deps {
  transport: Transport;
  policy: Required<Policy>;
  ownerId?: string;
  channel?: string;
  logger: AssistantLogger;
}

export async function beforeUserTurn(deps: Deps, input: BeforeUserTurnInput): Promise<BeforeUserTurnResult> {
  const empty = { systemContext: '', references: [], degraded: false };
  if (!shouldAutoRecall(deps.policy.autoRecall, input.userMessage)) {
    return empty;
  }

  const filters = scopeRecallFilters(
    { ownerId: deps.ownerId, channel: deps.channel, crossChannelRecall: deps.policy.crossChannelRecall },
    {},
    deps.logger,
  );

  const result = await deps.transport.recall(input.userMessage, filters, deps.policy.recallLimit);
  const items = result.items;
  const body = items.map(i => `- ${i.content}`).join('\n');
  const systemContext = items.length === 0 ? '' : `<memento>\n${body}\n</memento>`;
  return {
    systemContext,
    references: items.map(i => ({ id: i.id, type: i.type, importance: i.importance })),
    degraded: false,
  };
}
```

- [ ] **Step 4: `assistant.ts` `beforeUserTurn` 위임.**

```ts
async beforeUserTurn(input: BeforeUserTurnInput): Promise<BeforeUserTurnResult> {
  return beforeUserTurn(
    { transport: this.transport, policy: this.policy, ownerId: this.ownerId, channel: this.channel, logger: this.logger },
    input,
  );
}
```

- [ ] **Step 5: 테스트 통과 + Commit.**

```bash
git add packages/memento-assistant/src/lifecycle/before-user-turn.ts packages/memento-assistant/src/lifecycle/before-user-turn.spec.ts packages/memento-assistant/src/assistant.ts
git commit -m "feat(assistant): beforeUserTurn — always mode happy path"
```

---

## Task 12: `beforeUserTurn` — heuristic + 'off'

**Files:**
- Modify: `packages/memento-assistant/src/lifecycle/before-user-turn.spec.ts` (테스트 추가)

> 구현은 Task 11에서 `shouldAutoRecall`을 이미 통합했으므로 테스트만 추가하면 통과해야 한다.

- [ ] **Step 1: 테스트 추가.**

```ts
describe('beforeUserTurn — off mode', () => {
  it('skips transport call entirely', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRecall: 'off' } }, {});
    const r = await a.beforeUserTurn({ userMessage: 'anything?', conversationId: 'c1' });
    expect(t.recallCalls).toHaveLength(0);
    expect(r.systemContext).toBe('');
    expect(r.degraded).toBe(false);
  });
});

describe('beforeUserTurn — heuristic mode', () => {
  it("does not recall on short greeting", async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRecall: 'heuristic' } }, {});
    await a.beforeUserTurn({ userMessage: 'hi', conversationId: 'c1' });
    expect(t.recallCalls).toHaveLength(0);
  });

  it('recalls on question', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRecall: 'heuristic' } }, {});
    await a.beforeUserTurn({ userMessage: 'where did we go last time?', conversationId: 'c1' });
    expect(t.recallCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 통과 확인 + Commit.**

```bash
npm test -w @memento/assistant -- src/lifecycle/before-user-turn.spec.ts
git add packages/memento-assistant/src/lifecycle/before-user-turn.spec.ts
git commit -m "test(assistant): beforeUserTurn heuristic + off mode coverage"
```

---

## Task 13: `beforeUserTurn` — crossChannelRecall scoping

**Files:**
- Modify: `packages/memento-assistant/src/lifecycle/before-user-turn.spec.ts` (추가)

- [ ] **Step 1: 테스트 추가.**

```ts
describe('beforeUserTurn — crossChannelRecall', () => {
  it("'on' (default) sends no channel tag filter", async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, channel: 'tg', ownerId: 'u' }, {});
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls[0].filters?.tags).toBeUndefined();
  });

  it("'off' includes channel:* tag filter", async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv(
      { transport: t, channel: 'discord', ownerId: 'u', policy: { crossChannelRecall: 'off' } },
      {},
    );
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls[0].filters?.tags).toContain('channel:discord');
  });

  it("'sameContext' WARNs once and behaves like 'on'", async () => {
    const sink: any[] = [];
    // logger sink를 직접 mocking — assistant 생성 시 옵션으로 inject 필요(없으면 추가 - logger 옵션)
    // 본 테스트는 lifecycle 함수에 logger를 직접 주입하는 형태로 검증해도 OK
    // (구현 디테일: assistant.ts가 logger를 외부에서 주입 가능하도록 함)
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv(
      { transport: t, channel: 'tg', policy: { crossChannelRecall: 'sameContext' } },
      { MEMENTO_ASSISTANT_LOG: 'warn' },
    );
    // console.error를 spy
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    await a.beforeUserTurn({ userMessage: 'q2', conversationId: 'c1' });
    const sameContextWarns = spy.mock.calls.flat().join(' ').match(/sameContext/g) ?? [];
    expect(sameContextWarns.length).toBe(1);  // rate-limited
    expect(t.recallCalls[0].filters?.tags).toBeUndefined();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 테스트 통과 확인 + Commit.**

```bash
npm test -w @memento/assistant -- src/lifecycle/
git add packages/memento-assistant/src/lifecycle/before-user-turn.spec.ts
git commit -m "test(assistant): beforeUserTurn crossChannelRecall scoping + sameContext WARN"
```

---

## Task 14: `beforeUserTurn` — degraded / timeout / circuit breaker

**Files:**
- Modify: `packages/memento-assistant/src/lifecycle/before-user-turn.ts` (timeout + try/catch)
- Modify: `packages/memento-assistant/src/assistant.ts` (CircuitBreaker 인스턴스 보유)
- Modify: `packages/memento-assistant/src/lifecycle/before-user-turn.spec.ts` (테스트 추가)

핵심: `recallTimeoutMs` 안에 못 받으면 degraded:true, transport throw도 degraded:true. CircuitBreaker open 시 즉시 degraded.

- [ ] **Step 1: 테스트 추가.**

```ts
import { vi } from 'vitest';

describe('beforeUserTurn — degraded mode', () => {
  it('returns degraded=true when transport throws', async () => {
    const t = new MockTransport();
    t.throwOnNextRecall(new Error('network down'));
    const a = MementoAssistant.fromEnv({ transport: t }, {});
    const r = await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(r.degraded).toBe(true);
    expect(r.systemContext).toBe('');
    expect(r.references).toEqual([]);
  });

  it('returns degraded=true on timeout', async () => {
    vi.useFakeTimers();
    try {
      // MockTransport에 delay option 추가 필요 — 또는 별도 SlowTransport 만들기
      class SlowTransport extends MockTransport {
        async recall() { return new Promise<any>(() => {}); }  // never resolves
      }
      const t = new SlowTransport();
      const a = MementoAssistant.fromEnv({ transport: t, policy: { recallTimeoutMs: 500 } }, {});
      const p = a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
      await vi.advanceTimersByTimeAsync(600);
      const r = await p;
      expect(r.degraded).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('opens circuit breaker after 5 consecutive failures and short-circuits next call', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t }, {});
    for (let i = 0; i < 5; i++) {
      t.throwOnNextRecall(new Error('boom'));
      await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    }
    // 6번째 호출: transport는 호출 안 되어야 함
    const beforeCount = t.recallCalls.length;
    const r = await a.beforeUserTurn({ userMessage: 'q', conversationId: 'c1' });
    expect(t.recallCalls.length).toBe(beforeCount);  // short-circuit
    expect(r.degraded).toBe(true);
  });
});
```

- [ ] **Step 2: `before-user-turn.ts` 보강.**

```ts
// 추가 deps: breaker
interface Deps {
  // ... 기존 ...
  breaker: { canPass(): boolean; recordSuccess(): void; recordFailure(): void };
}

export async function beforeUserTurn(deps: Deps, input: BeforeUserTurnInput): Promise<BeforeUserTurnResult> {
  const empty: BeforeUserTurnResult = { systemContext: '', references: [], degraded: false };
  const degraded: BeforeUserTurnResult = { systemContext: '', references: [], degraded: true };

  if (!shouldAutoRecall(deps.policy.autoRecall, input.userMessage)) return empty;
  if (!deps.breaker.canPass()) {
    deps.logger.warn('memento circuit open — skipping recall');
    return degraded;
  }

  const filters = scopeRecallFilters(
    { ownerId: deps.ownerId, channel: deps.channel, crossChannelRecall: deps.policy.crossChannelRecall },
    {},
    deps.logger,
  );

  try {
    const result = await withTimeout(
      deps.transport.recall(input.userMessage, filters, deps.policy.recallLimit),
      deps.policy.recallTimeoutMs,
    );
    deps.breaker.recordSuccess();
    const body = result.items.map(i => `- ${i.content}`).join('\n');
    const systemContext = result.items.length === 0 ? '' : `<memento>\n${body}\n</memento>`;
    return {
      systemContext,
      references: result.items.map(i => ({ id: i.id, type: i.type, importance: i.importance })),
      degraded: false,
    };
  } catch (err) {
    deps.breaker.recordFailure();
    deps.logger.warn(`memento recall failed: ${(err as Error).message}`);
    return degraded;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(id); resolve(v); }, e => { clearTimeout(id); reject(e); });
  });
}
```

- [ ] **Step 3: `assistant.ts`에 CircuitBreaker 인스턴스 보유.** (생성자에서 `new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 })`)

- [ ] **Step 4: 테스트 통과 + Commit.**

```bash
git add packages/memento-assistant/src/lifecycle/before-user-turn.ts packages/memento-assistant/src/assistant.ts packages/memento-assistant/src/lifecycle/before-user-turn.spec.ts
git commit -m "feat(assistant): beforeUserTurn degraded mode + timeout + circuit breaker"
```

---

## Task 15: `afterAssistantTurn` — 'turn' mode

**Files:**
- Create: `packages/memento-assistant/src/lifecycle/after-assistant-turn.ts`
- Create: `packages/memento-assistant/src/lifecycle/after-assistant-turn.spec.ts`
- Modify: `packages/memento-assistant/src/assistant.ts` (위임)

- [ ] **Step 1: 테스트.**

```ts
import { describe, it, expect, vi } from 'vitest';
import { MementoAssistant } from '../assistant.js';
import { MockTransport } from '../transport/mock-transport.js';

describe('afterAssistantTurn — turn mode', () => {
  it('saves single working memory entry', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, channel: 'tg', userTags: ['persona:asst'] }, {});
    await a.afterAssistantTurn({ userMessage: '내 생일 5/10', assistantReply: '기억해둘게요', conversationId: 'c1' });
    // fire-and-forget — flush 대기
    await vi.waitFor(() => expect(t.rememberCalls).toHaveLength(1));
    const call = t.rememberCalls[0];
    expect(call.type).toBe('working');
    expect(call.content).toContain('내 생일 5/10');
    expect(call.content).toContain('기억해둘게요');
    expect(call.tags).toEqual(expect.arrayContaining(['channel:tg', 'conv:c1', 'persona:asst']));
  });

  it("with policy.autoRemember='off' skips entirely", async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRemember: 'off' } }, {});
    await a.afterAssistantTurn({ userMessage: 'u', assistantReply: 'a', conversationId: 'c1' });
    await new Promise(r => setTimeout(r, 50));
    expect(t.rememberCalls).toHaveLength(0);
  });

  it('does not throw even when transport throws', async () => {
    const t = new MockTransport();
    t.throwOnNextRemember(new Error('boom'));
    const a = MementoAssistant.fromEnv({ transport: t }, {});
    await expect(
      a.afterAssistantTurn({ userMessage: 'u', assistantReply: 'a', conversationId: 'c1' })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 구현.**

```ts
// packages/memento-assistant/src/lifecycle/after-assistant-turn.ts
import type { AfterAssistantTurnInput, Policy } from '../types.js';
import type { Transport } from '../transport/transport.js';
import { rememberDispatch } from '../policy/auto-remember-policy.js';
import { scopeRememberTags } from '../scoping/channel-scope.js';
import type { AssistantLogger } from '../fallback/logger.js';
import type { RetryQueue } from '../fallback/retry-queue.js';

interface Deps {
  transport: Transport;
  policy: Required<Policy>;
  ownerId?: string;
  channel?: string;
  userTags?: string[];
  logger: AssistantLogger;
  retryQueue: RetryQueue;
}

export async function afterAssistantTurn(deps: Deps, input: AfterAssistantTurnInput): Promise<void> {
  const items = rememberDispatch(deps.policy.autoRemember, { user: input.userMessage, assistant: input.assistantReply }, input.extracted);
  if (items.length === 0) return;

  const tags = scopeRememberTags({ channel: deps.channel, userTags: deps.userTags }, { conversationId: input.conversationId });

  for (const item of items) {
    deps.retryQueue.enqueue(async () => {
      await deps.transport.remember({
        content: item.content,
        type: item.type,
        tags: Array.from(new Set([...(item.tags ?? []), ...tags])),
        importance: item.importance,
        ownerId: deps.ownerId,
      });
    });
  }
}
```

- [ ] **Step 3: `assistant.ts` 보강 — RetryQueue 인스턴스 보유 + `afterAssistantTurn` 위임.**

- [ ] **Step 4: 테스트 통과 + Commit.**

```bash
git add packages/memento-assistant/src/lifecycle/after-assistant-turn.ts packages/memento-assistant/src/lifecycle/after-assistant-turn.spec.ts packages/memento-assistant/src/assistant.ts
git commit -m "feat(assistant): afterAssistantTurn — turn mode with retry queue"
```

---

## Task 16: `afterAssistantTurn` — 'decision' mode + extracted dedup

**Files:**
- Modify: `packages/memento-assistant/src/lifecycle/after-assistant-turn.ts` (dedup 단계 추가)
- Modify: `packages/memento-assistant/src/lifecycle/after-assistant-turn.spec.ts` (추가)

핵심: `extracted` 항목 저장 *직전*에 `transport.recall(content, tags, limit:1)` 으로 유사도 체크. 0.85+ 결과 있으면 `updateExisting` 사용.

> 0.85 임계값은 spec § 7. transport.recall 결과의 `score` 필드가 있다고 가정 — `@memento/client` 의 `MemorySearchResult` 시그니처 확인 후 정확한 필드명 사용.

- [ ] **Step 1: 테스트 추가.**

```ts
describe('afterAssistantTurn — decision mode', () => {
  it('saves fact as semantic + working', async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRemember: 'decision' } }, {});
    await a.afterAssistantTurn({
      userMessage: 'u', assistantReply: 'a', conversationId: 'c1',
      extracted: [{ kind: 'fact', content: 'birthday 5/10' }],
    });
    await vi.waitFor(() => expect(t.rememberCalls.length).toBeGreaterThanOrEqual(2));
    expect(t.rememberCalls.find(c => c.type === 'semantic')?.content).toBe('birthday 5/10');
    expect(t.rememberCalls.find(c => c.type === 'working')).toBeDefined();
  });

  it('uses updateExisting when similar item exists (score >= 0.85)', async () => {
    const t = new MockTransport();
    t.fixture('existing:1', { content: 'birthday 5/10', type: 'semantic' });
    // MockTransport.recall이 score를 반환하도록 보강 필요 — fixture에 score 옵션 추가
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRemember: 'decision' } }, {});
    await a.afterAssistantTurn({
      userMessage: 'u', assistantReply: 'a', conversationId: 'c1',
      extracted: [{ kind: 'fact', content: 'birthday 5/10' }],
    });
    await vi.waitFor(() => expect(t.rememberCalls.some(c => c.updateExisting?.id === 'existing:1')).toBe(true));
  });

  it("'decision' without extracted falls back to 'turn' behavior", async () => {
    const t = new MockTransport();
    const a = MementoAssistant.fromEnv({ transport: t, policy: { autoRemember: 'decision' } }, {});
    await a.afterAssistantTurn({ userMessage: 'u', assistantReply: 'a', conversationId: 'c1' });
    await vi.waitFor(() => expect(t.rememberCalls).toHaveLength(1));
    expect(t.rememberCalls[0].type).toBe('working');
  });
});
```

- [ ] **Step 2: `after-assistant-turn.ts` dedup 단계 추가.**

```ts
// extracted 분기 항목만 dedup. working ('turn' 항목)은 dedup 안 함 (TTL로 자연 소멸).

const SIM_THRESHOLD = 0.85;
const isExtracted = (it: RememberDispatchItem) => it.type !== 'working';

for (const item of items) {
  let updateExisting: { id: string } | undefined;
  if (isExtracted(item)) {
    try {
      const probe = await deps.transport.recall(item.content, { ownerId: deps.ownerId, tags }, 1);
      const top = probe.items[0];
      if (top && (top.score ?? 0) >= SIM_THRESHOLD) updateExisting = { id: top.id };
    } catch {
      // 검색 실패는 무시하고 새로 저장
    }
  }
  deps.retryQueue.enqueue(async () => {
    await deps.transport.remember({
      content: item.content,
      type: item.type,
      tags: Array.from(new Set([...(item.tags ?? []), ...tags])),
      importance: item.importance,
      ownerId: deps.ownerId,
      updateExisting,
    });
  });
}
```

- [ ] **Step 3: `MockTransport`에 `score`/`updateExisting` 지원 추가.** (fixture 옵션 + recall 결과에 score 포함, remember 시 updateExisting 기록)

- [ ] **Step 4: 테스트 통과 + Commit.**

```bash
git add packages/memento-assistant/src/lifecycle/after-assistant-turn.ts packages/memento-assistant/src/lifecycle/after-assistant-turn.spec.ts packages/memento-assistant/src/transport/mock-transport.ts packages/memento-assistant/src/transport/mock-transport.spec.ts
git commit -m "feat(assistant): afterAssistantTurn decision mode + similarity dedup"
```

---

## Task 17: `afterAssistantTurn` — retry queue + drop semantics 통합 검증

**Files:**
- Modify: `packages/memento-assistant/src/lifecycle/after-assistant-turn.spec.ts` (추가)

> 구현은 Task 15에서 RetryQueue 통합으로 완료. 본 task는 *통합 시나리오 테스트*만 추가.

- [ ] **Step 1: 테스트 추가.**

```ts
describe('afterAssistantTurn — retry & drop', () => {
  it('retries 3 times then drops on persistent failure', async () => {
    vi.useFakeTimers();
    try {
      const t = new MockTransport();
      // remember가 항상 throw하도록
      const origRemember = t.remember.bind(t);
      let attempts = 0;
      t.remember = async (p) => { attempts++; throw new Error('always'); };

      const dropEvents: any[] = [];
      // assistant 생성 시 retry queue 옵션을 외부에서 inject 하거나 onDrop을 spy하려면 노출 필요
      // — 본 테스트는 logger 호출로 간접 검증해도 OK
      const sink = vi.fn();
      const a = MementoAssistant.fromEnv({ transport: t }, {});
      // 직접 sink mock은 logger 옵션 필요. 우선은 attempts 카운트로 검증.

      await a.afterAssistantTurn({ userMessage: 'u', assistantReply: 'a', conversationId: 'c1' });
      await vi.advanceTimersByTimeAsync(0);     // attempt 1
      await vi.advanceTimersByTimeAsync(1000);  // attempt 2
      await vi.advanceTimersByTimeAsync(2000);  // attempt 3
      await vi.advanceTimersByTimeAsync(4000);  // drop
      expect(attempts).toBe(3);
    } finally { vi.useRealTimers(); }
  });
});
```

- [ ] **Step 2: 통과 확인 + Commit.**

```bash
git add packages/memento-assistant/src/lifecycle/after-assistant-turn.spec.ts
git commit -m "test(assistant): afterAssistantTurn retry+drop integration"
```

---

## Task 18: README + Example app

**Files:**
- Modify: `packages/memento-assistant/README.md`
- Create: `apps/experimental-assistant-example/package.json`
- Create: `apps/experimental-assistant-example/src/index.ts`
- Create: `apps/experimental-assistant-example/README.md`

example app은 SDK API가 *진짜 동작*하는지 minimal echo bot으로 보여준다 — LLM 호출 없이 stdin → SDK → stdout만.

- [ ] **Step 1: `packages/memento-assistant/README.md` 작성.**

설치 / 5분 quickstart(stdio) / 30분 quickstart(HTTP) / API 표면 / 환경변수 표 / degraded 모드 의미 / FAQ.

- [ ] **Step 2: `apps/experimental-assistant-example/` 작성.**

```ts
// apps/experimental-assistant-example/src/index.ts
import { MementoAssistant } from '@memento/assistant';
import * as readline from 'node:readline/promises';

async function main() {
  const memory = MementoAssistant.fromEnv(
    { ownerId: process.env.USER ?? 'demo', channel: 'cli' },
    process.env,
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const conversationId = `cli-${Date.now()}`;
  console.log('echo bot — type "exit" to quit');
  while (true) {
    const userMessage = await rl.question('you> ');
    if (userMessage === 'exit') break;
    const ctx = await memory.beforeUserTurn({ userMessage, conversationId });
    if (ctx.systemContext) console.log(`[memento]\n${ctx.systemContext}\n[/memento]`);
    const assistantReply = `echo: ${userMessage}`;
    console.log(`bot> ${assistantReply}`);
    await memory.afterAssistantTurn({ userMessage, assistantReply, conversationId });
  }
  await memory.close();
  rl.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: root `package.json`의 workspace는 `apps/*` 패턴이라 자동 포함됨. 추가 설정 불필요.**

- [ ] **Step 4: 빌드 + 수동 실행 검증.**

```bash
npm run build -w @memento/assistant
npx tsx apps/experimental-assistant-example/src/index.ts <<< 'exit'
# expected: 정상 시작/종료
```

- [ ] **Step 5: Commit.**

```bash
git add packages/memento-assistant/README.md apps/experimental-assistant-example
git commit -m "docs(assistant): README + experimental echo example app"
```

---

## Task 19: stdio 통합 테스트

**Files:**
- Create: `packages/memento-assistant/test/integration/stdio.integration.spec.ts`

실제 child를 spawn — `memento-mcp-server` bin이 필요하므로 `npm run build`가 선행되었음을 가정.

- [ ] **Step 1: 테스트.**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StdioTransport } from '../../src/transport/stdio-transport.js';
import { resolve } from 'node:path';

describe('stdio integration', () => {
  let t: StdioTransport;
  const bin = resolve(__dirname, '../../../memento-server/dist/server/index.js');

  beforeAll(async () => {
    t = new StdioTransport({ command: 'node', args: [bin], env: { DB_PATH: ':memory:' } });
    await t.connect();
  }, 30_000);

  afterAll(async () => {
    await t.close();
  });

  it('roundtrip: remember → recall', async () => {
    await t.remember({ content: 'integration test fact', type: 'semantic' });
    const r = await t.recall('integration test fact', undefined, 5);
    expect(r.items.some(i => i.content.includes('integration test'))).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 2: 빌드 확인 + 테스트 실행.**

```bash
npm run build
npm test -w @memento/assistant -- test/integration/stdio.integration.spec.ts
# expected: PASS
```

- [ ] **Step 3: Commit.**

```bash
git add packages/memento-assistant/test/integration/stdio.integration.spec.ts
git commit -m "test(assistant): stdio integration with real child process"
```

---

## Task 20: HTTP 통합 테스트 + E2E 시나리오 5개

**Files:**
- Create: `packages/memento-assistant/test/integration/http.integration.spec.ts`
- Create: `packages/memento-assistant/test/e2e/cross-channel-recall.e2e.spec.ts`
- Create: `packages/memento-assistant/test/e2e/channel-isolation.e2e.spec.ts`
- Create: `packages/memento-assistant/test/e2e/degraded-fallback.e2e.spec.ts`
- Create: `packages/memento-assistant/test/e2e/working-promotion.e2e.spec.ts`
- Create: `packages/memento-assistant/test/e2e/transport-switch.e2e.spec.ts`

E2E는 in-memory SQLite + 실제 memento-server HTTP 띄움(test fixture). LLM/embedding은 mock/TF-IDF.

- [ ] **Step 1: HTTP fixture 헬퍼.** (`memento-server/src/test/test-http-server-v2.ts`를 참고해 random port + ephemeral SQLite로 띄우는 헬퍼 작성. `before`/`after`에서 시작/정지.)

- [ ] **Step 2: `http.integration.spec.ts`.** (Bearer 헤더 부착 / 401 → degraded / roundtrip)

- [ ] **Step 3: E2E 시나리오 1 — Cross-channel recall.**

```
Telegram에서 fact 저장 → Discord에서 query → 회상됨 (crossChannelRecall='on' 기본)
```

- [ ] **Step 4: E2E 시나리오 2 — Channel isolation.**

```
같은 흐름 + crossChannelRecall='off' → 회상 안 됨
```

- [ ] **Step 5: E2E 시나리오 3 — Degraded fallback.**

```
HTTP 서버 강제 종료 → beforeUserTurn 즉시 degraded:true → afterAssistantTurn 호출도 throw 안 함
```

- [ ] **Step 6: E2E 시나리오 4 — Working → episodic 승격 (입력 정확성 검증).**

> SDK 책임은 *입력 정확성*. 같은 사실 5턴 반복 후 working 5건이 모두 정확한 type/tags로 기록되는지 검증. 실제 sleep-consolidation 트리거는 SDK 범위 밖.

- [ ] **Step 7: E2E 시나리오 5 — stdio → http 전환.**

```
stdio로 fact 저장 → 종료 → 같은 DB_PATH로 HTTP 서버 띄움 → 같은 ownerId로 회상됨
```

- [ ] **Step 8: 모든 E2E 통과 + Commit.**

```bash
npm test -w @memento/assistant -- test/
git add packages/memento-assistant/test
git commit -m "test(assistant): http integration + 5 E2E scenarios"
```

---

## Task 21: PR 생성 (Phase 2)

**Files:** 없음 (외부 액션)

- [ ] **Step 1: 최종 검증.**

```bash
npm test
npm run lint
npm run type-check
```
모두 통과해야 함.

- [ ] **Step 2: 브랜치 push.**

```bash
git push -u origin docs/external-assistant-l3-plan
```

- [ ] **Step 3: PR 생성.**

```bash
gh pr create --title "feat(assistant): external assistant integration v0.1 — Phase 2 (L3 SDK)" --body "$(cat <<'EOF'
## Summary
- 신규 패키지 `@memento/assistant` (`packages/memento-assistant/`) 추가
  - Transport 추상화 (stdio / HTTP / Mock)
  - 라이프사이클 훅 `beforeUserTurn` / `afterAssistantTurn`
  - 자동 recall/remember 정책 + 채널 스코핑
  - 폴백: rate-limited logger + circuit breaker + retry queue
- root workspaces + type-check / build:packages 체이닝
- experimental-assistant-example app (LLM 없는 echo demo)
- 단위/통합/E2E 테스트

Spec: `docs/superpowers/specs/2026-04-27-external-assistant-integration-design.md`
Plan: `docs/superpowers/plans/2026-04-27-external-assistant-l3-sdk.md`

> Phase 3(L1 가이드 SDK 섹션 추가)은 본 PR 머지 후 별도 PR로 진행한다.

## Spec drift 보정
- stdio 기본 명령은 `npx -y memento-mcp-server@latest` (spec의 `start --stdio` 는 존재하지 않음)
- SDK 로그 레벨 환경변수는 `MEMENTO_ASSISTANT_LOG` (서버 측 `LOG_LEVEL`과 충돌 회피)
- `kind:'commitment'` 는 `ExtractedItem` union에서 제외(TS exhaustiveness로 차단)
- `crossChannelRecall='sameContext'` 는 1회 WARN + `'on'` fallback (throw 안 함)

## Test plan
- [ ] `npm test` 전체 통과
- [ ] `npm run lint` / `npm run type-check` 통과
- [ ] `apps/experimental-assistant-example` 수동 실행 (`exit` 입력 후 정상 종료)
- [ ] stdio 통합 테스트가 실제 child spawn으로 동작
- [ ] E2E 5개 시나리오 통과

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: PR URL 보고.**

> Phase 2 완료. 본 PR이 main에 머지된 다음 Phase 3로 진행한다.

---

# PHASE 3 — 가이드 업그레이드 (L1 → "한 단계 더: SDK 사용" 섹션 추가)

> **선행:** Phase 2 PR이 main에 머지되어 `@memento/assistant` 가 실제로 import 가능해야 한다. 머지 전에는 Phase 3을 시작하지 않는다.

## Task 22: 새 워크트리 + 새 브랜치 (Phase 2 머지 후)

**Files:** 없음 (워크트리 / 브랜치 생성)

- [ ] **Step 1:** Phase 2 PR이 main에 머지되었는지 확인.

```bash
git fetch origin main
git log --oneline origin/main | head -5
gh pr list --state merged --search "head:docs/external-assistant-l3-plan" --json number,mergedAt,title
```

- [ ] **Step 2:** 새 워크트리 / 브랜치 생성 (project root에서).

```bash
git worktree add .worktrees/docs-external-assistant-l3-guide-upgrade -b docs/external-assistant-l3-guide-upgrade origin/main
cd .worktrees/docs-external-assistant-l3-guide-upgrade
npm install
```

- [ ] **Step 3:** `@memento/assistant`가 import 가능한지 확인.

```bash
node -e "import('@memento/assistant').then(m => console.log(Object.keys(m)))"
# expected: [ 'MementoAssistant', 'MockTransport', ... ]
```

- [ ] **Step 4:** 검증만이고 commit 없음.

---

## Task 23: `_shared/sdk-quickstart.md` 신설

**Files:**
- Create: `docs/integrations/_shared/sdk-quickstart.md`

L3 SDK 사용 5분 quickstart(stdio) / 30분 quickstart(HTTP). API 핵심 표면. 라이프사이클 훅 어디에 호출해야 하는지. degraded 모드 의미.

- [ ] **Step 1: 작성.** 한국어 본문, 코드 블록은 영어. spec § 6 + § 7 + § 8 본문을 가이드 톤(사용자 중심)으로 풀어 쓴다.

핵심 섹션:
1. "왜 SDK인가" (베어 MCP vs SDK 차이)
2. "5분: stdio quickstart"
3. "30분: HTTP quickstart"
4. "라이프사이클 훅 통합 위치"
5. "환경변수 표 (spec § 6 + 보정)"
6. "Degraded 모드 — 비서가 죽지 않는다"
7. "다음 단계" (per-assistant 가이드 링크)

- [ ] **Step 2: `npm run docs:audit-links` 통과 확인.**

- [ ] **Step 3: Commit.**

```bash
git add docs/integrations/_shared/sdk-quickstart.md
git commit -m "docs(integrations): write _shared/sdk-quickstart.md"
```

---

## Task 24: `_shared/system-prompt.md` 업데이트

**Files:**
- Modify: `docs/integrations/_shared/system-prompt.md`

새 섹션: "## 한 단계 더: `@memento/assistant` 사용 시" — SDK가 자동으로 systemContext를 만들기 때문에 시스템 프롬프트는 *짧아진다*. 베어 MCP용 권장 프롬프트는 그대로 두고 새 섹션을 아래에 덧붙인다.

- [ ] **Step 1: 섹션 추가.**

```markdown
## 한 단계 더: `@memento/assistant` 사용 시

SDK가 매 턴 `<memento>...</memento>` 펜스 블록을 자동으로 만들어 시스템 프롬프트에 합성합니다.
이 경우 위의 권장 프롬프트는 *짧아져도* 됩니다 — recall 호출 의지를 LLM에 부탁할 필요가 없으니까요.

권장 SDK용 시스템 프롬프트:
\`\`\`
당신은 사용자의 개인 비서입니다. 시스템 프롬프트에 포함된 <memento>...</memento> 블록은
이 사용자에 관해 이전에 알게 된 사실/선호/사건의 회상입니다. 답변에 적극 활용하세요.
없으면 그냥 답변하세요.
\`\`\`

자동 저장 정책 옵션은 [`./sdk-quickstart.md`](./sdk-quickstart.md) 참조.
```

- [ ] **Step 2: Commit.**

```bash
git add docs/integrations/_shared/system-prompt.md
git commit -m "docs(integrations): add SDK section to system-prompt.md"
```

---

## Task 25: `openclaw.md` SDK 섹션 추가

**Files:**
- Modify: `docs/integrations/openclaw.md`

OpenClaw 게이트웨이의 어디에 SDK를 통합할지(메시지 파이프라인 어디 hook). 게이트웨이 레벨이 자연스러움 — skill 레벨이면 매 skill에 중복 호출.

- [ ] **Step 1: 섹션 추가.** "## 한 단계 더: `@memento/assistant`로 자동 회상/저장" 헤더 + 게이트웨이 라이프사이클의 정확한 hook 위치 + 코드 스니펫 + ownerId/channel 매핑(OpenClaw user 객체 → ownerId, channel 어댑터 이름 → channel).

- [ ] **Step 2: Commit.**

```bash
git add docs/integrations/openclaw.md
git commit -m "docs(integrations): add SDK upgrade section to openclaw.md"
```

---

## Task 26: `nanoclaw.md` SDK 섹션 추가

**Files:**
- Modify: `docs/integrations/nanoclaw.md`

NanoClaw는 컨테이너이므로 SDK는 컨테이너 안에서 import. transport는 HTTP 강제(stdio child spawn은 컨테이너 격리와 충돌). `MEMENTO_URL=http://host.docker.internal:9001/mcp` 권장.

- [ ] **Step 1: 섹션 추가.**

- [ ] **Step 2: Commit.**

```bash
git add docs/integrations/nanoclaw.md
git commit -m "docs(integrations): add SDK upgrade section to nanoclaw.md"
```

---

## Task 27: `zeroclaw.md` SDK 섹션 추가

**Files:**
- Modify: `docs/integrations/zeroclaw.md`

> **주의:** ZeroClaw는 Rust 바이너리. `@memento/assistant`는 Node.js 패키지라 *Rust 측에서 직접 import 불가*. ZeroClaw 사용자는 SDK 대신 베어 MCP로 충분 — 본 task는 그 사실을 명시하고 향후 Rust 포트(L2 v0.2+)를 예고한다.

- [ ] **Step 1: 섹션 추가.**

```markdown
## SDK 사용에 관해

ZeroClaw는 Rust 바이너리이므로 Node.js 기반 `@memento/assistant` 를 직접 import 할 수 없습니다.
v0.1에서는 베어 MCP 등록(stdio 또는 HTTP) + 권장 시스템 프롬프트 패턴으로 자동 회상/저장의 약 80%를 얻을 수 있습니다 ([`./_shared/system-prompt.md`](./_shared/system-prompt.md)).

Rust 측 포팅(예: `memento-assistant-rs`)은 v0.2+ 로드맵 항목입니다. 트래킹 이슈가 열리면 여기에 링크합니다.
```

- [ ] **Step 2: Commit.**

```bash
git add docs/integrations/zeroclaw.md
git commit -m "docs(integrations): clarify ZeroClaw + SDK applicability"
```

---

## Task 28: 허브 README + 루트 README 업데이트

**Files:**
- Modify: `docs/integrations/README.md`
- Modify: `README.md` (root)
- Modify: `README.en.md` (root)

`docs/integrations/README.md` 의 "더 깊은 통합 (옵션)" 섹션을 *실제 링크*로 교체. 루트 README는 "v0.2에서 별도 가이드 추가 예정" → "v0.1에서 SDK 사용 가능 — `docs/integrations/_shared/sdk-quickstart.md` 참조"로 고침.

- [ ] **Step 1: 세 파일 수정.**

- [ ] **Step 2: 링크 검증.**

```bash
npm run docs:audit-links
```

- [ ] **Step 3: Commit.**

```bash
git add docs/integrations/README.md README.md README.en.md
git commit -m "docs: surface @memento/assistant SDK in integration hub + root READMEs"
```

---

## Task 29: PR 생성 (Phase 3)

**Files:** 없음 (외부 액션)

- [ ] **Step 1: 최종 점검.**

```bash
npm test
npm run lint
npm run type-check
npm run docs:audit-links
```

- [ ] **Step 2: push.**

```bash
git push -u origin docs/external-assistant-l3-guide-upgrade
```

- [ ] **Step 3: PR 생성.**

```bash
gh pr create --title "docs(integrations): L1 guide upgrade — @memento/assistant SDK sections" --body "$(cat <<'EOF'
## Summary
- `docs/integrations/_shared/sdk-quickstart.md` 신설 (L3 SDK quickstart)
- `_shared/system-prompt.md` SDK 사용 시 권장 프롬프트 섹션 추가
- `openclaw.md` / `nanoclaw.md` SDK 통합 섹션 추가
- `zeroclaw.md` SDK 미적용 사유 + Rust 포트 예고
- `docs/integrations/README.md` "더 깊은 통합" 실제 링크로 교체
- root README / README.en SDK 섹션 활성화

Spec: `docs/superpowers/specs/2026-04-27-external-assistant-integration-design.md`
Plan: `docs/superpowers/plans/2026-04-27-external-assistant-l3-sdk.md` (Phase 3)

## Test plan
- [ ] `npm run docs:audit-links` 통과
- [ ] `npm test` 그대로 통과 (smoke 테스트 영향 없음)
- [ ] OpenClaw / NanoClaw 가이드의 SDK 스니펫을 실제 비서에서 시도 (수동 검증)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: PR URL 보고.**

> Phase 3 완료 시 외부 비서 통합 v0.1 전체 종결.

---

## Phase 별 산출물 요약

| Phase | 결과 | PR | 머지 후 사용자 효용 |
|---|---|---|---|
| Phase 0 (완료) | `packages/memento-agent/` archive | PR #210에 흡수 | 방향 전환 명시 |
| Phase 1 (완료) | `docs/integrations/` L1 가이드 + smoke 테스트 | PR #210에 흡수 | 베어 MCP로 외부 비서 연결 가능 |
| **Phase 2 (본 plan T0~21)** | **`@memento/assistant` v0.1** | **신규 PR** | **자동 recall/remember + 폴백 + 채널 스코핑** |
| **Phase 3 (본 plan T22~29)** | **L1 가이드 SDK 섹션 추가** | **신규 PR** | **사용자가 SDK 통합 가능** |
| Phase 4 (v0.2+) | 외부 비서 PR (L2) | 별도 일정 | 외부 비서 측에서 1줄 import |

---

## 실행 가이드라인 (모든 implementer 공통)

1. **TDD 엄수.** 각 task의 Step 1은 항상 실패하는 테스트.
2. **Spec과 코드가 충돌하면 코드를 따른다.** 보정 메모를 commit message + plan 변경 노트에 남긴다.
3. **자동 라이프사이클 훅(`beforeUserTurn` / `afterAssistantTurn`)은 절대 throw하지 않는다.** 모든 새 코드 경로에서 invariant 점검.
4. **`@memento/core` 의존 금지.** `packages/memento-assistant/package.json` 의 `dependencies`에 `@memento/core`가 들어가면 구조 위반.
5. **LLM 호출 / agent 루프 추가 금지.** 이게 archived `memento-agent` 와의 차별점.
6. **커버리지 게이트 추가 금지** (spec § 9: report-only).
7. **Implementer가 막히면 status `BLOCKED` 또는 `NEEDS_CONTEXT` 로 보고**, 임의 결정으로 진행 금지.

---

## Plan 검토 노트 (작성자)

advisor 권고를 수용한 사항:
- spec drift 보정을 plan 헤더에 명시 (Pre-flight 표)
- workspace 배선을 Task 1로 분리
- `beforeUserTurn` / `afterAssistantTurn` 을 각각 4 / 3 sub-task로 분해
- PR 전략을 Phase 2 = 1 PR, Phase 3 = 1 PR로 명시
- `commitment` exhaustiveness 차단 + `sameContext` WARN+fallback 테스트 명시
- 커버리지 ≥85% 게이트 추가 금지 명시
