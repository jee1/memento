# 이슈 #238 personal-agent 실제 LLM provider 연결 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `PersonalKnowledgeAgentService`에 주입되는 `ILLMPort`를 환경 기반으로 선택하고, mock은 기본·무조건 유지하며 OpenAI·Gemini·Ollama는 **명시적 설정이 있을 때만** 활성화한다. 공통 오류 모델로 `provider_disabled` / `provider_misconfigured` / `provider_runtime_failed`를 구분한다.

**Architecture:** `@memento/core`의 `personal-agent` 도메인에 **환경 파싱·런타임 팩토리(#334)**를 두고, provider별 `ILLMPort` 구현체(#335~#337)를 같은 패키지 `adapters/`에 추가한다. CLI `agent-ask`는 팩토리만 호출해 어댑터 조립을 한 곳에 모은다. 임베딩과 동일하게 루트 워크스페이스에 이미 있는 `openai`, `@google/genai`, `@google/generative-ai`를 재사용하고, Ollama는 **추가 npm 의존성 없이** `fetch`로 호출한다.

**Tech Stack:** TypeScript 5.x, Vitest, Node 24, `zod`(core에 이미 사용 중이면 동일 패턴), `openai` ^4.x, `@google/generative-ai` 또는 `@google/genai`(구현 시 한 패키지로 통일), native `fetch`.

**Spec:** [docs/superpowers/specs/2026-05-10-issue-238-provider-adapter-split-design.md](../specs/2026-05-10-issue-238-provider-adapter-split-design.md) — 하위 이슈 [#334](https://github.com/jee1/memento/issues/334)~[#337](https://github.com/jee1/memento/issues/337).

---

## 구현 전 파일 맵

| 구분 | 경로 | 책임 |
| --- | --- | --- |
| 포트(기존) | `packages/memento-core/src/domains/personal-agent/ports/llm-port.ts` | `ILLMPort` 계약 |
| Mock(기존) | `packages/memento-core/src/domains/personal-agent/adapters/deterministic-mock-llm-adapter.ts` | 기본 mock |
| 서비스(기존) | `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.ts` | LLM 주입 소비 |
| CLI(기존) | `packages/memento-server/src/cli/agent-ask.ts` | 현재 `new DeterministicMockLlmAdapter()` 하드코딩 → 팩토리 호출로 교체 |
| 배럴(기존) | `packages/memento-core/src/domains/personal-agent/index.ts`, `packages/memento-core/src/index.ts` | 신규 심볼 export |
| 신규(#334) | `packages/memento-core/src/domains/personal-agent/config/personal-agent-llm-env.ts` | env 파싱·정규화 |
| 신규(#334) | `packages/memento-core/src/domains/personal-agent/errors/personal-agent-llm-error.ts` | 구분 가능한 오류 코드 |
| 신규(#334) | `packages/memento-core/src/domains/personal-agent/services/create-personal-agent-llm-port.ts` | gating + 분기 |
| 신규(#335) | `packages/memento-core/src/domains/personal-agent/adapters/openai-chat-llm-adapter.ts` | OpenAI chat → `ILLMPort` |
| 신규(#336) | `packages/memento-core/src/domains/personal-agent/adapters/gemini-chat-llm-adapter.ts` | Gemini chat → `ILLMPort` |
| 신규(#337) | `packages/memento-core/src/domains/personal-agent/adapters/ollama-chat-llm-adapter.ts` | Ollama HTTP → `ILLMPort` |
| 신규(테스트) | 각 구현 옆 `*.spec.ts` | 단위 테스트(네트워크는 mock) |
| 문서(#337) | `docs/` 하위 agent / personal-agent 사용 가이드 | 로컬 smoke 절차 |

**환경 변수(제안 — 구현 시 스펙과 PR 본문에 동일하게 명시):**

- `MEMENTO_PERSONAL_AGENT_LLM_PROVIDER` — `mock` \| `openai` \| `gemini` \| `ollama` (미설정·빈값 = `mock`)
- OpenAI: 기존 `OPENAI_API_KEY` 재사용(이미 `mementoConfig`에서 로드). 모델 오버라이드용 `MEMENTO_PERSONAL_AGENT_OPENAI_MODEL` (선택, 기본 `gpt-4o-mini`)
- Gemini: 기존 `GEMINI_API_KEY` 재사용. 모델 오버라이드 `MEMENTO_PERSONAL_AGENT_GEMINI_MODEL` (선택, 기본은 `gemini-2.0-flash` 등 팀이 정한 안전한 기본값 하나로 고정)
- Ollama: `MEMENTO_PERSONAL_AGENT_OLLAMA_URL`(기본 `http://127.0.0.1:11434`), `MEMENTO_PERSONAL_AGENT_OLLAMA_MODEL`(필수로 두어 misconfigured 구분)

---

### Task 1 (#334) — `PersonalAgentLlmError` + 코드 상수

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/errors/personal-agent-llm-error.ts`
- Test: `packages/memento-core/src/domains/personal-agent/errors/personal-agent-llm-error.spec.ts`

- [ ] **Step 1: 실패 테스트 추가**

`personal-agent-llm-error.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  PersonalAgentLlmError,
  isPersonalAgentLlmError,
} from './personal-agent-llm-error.js';

describe('PersonalAgentLlmError', () => {
  it('exposes provider_misconfigured code', () => {
    const err = new PersonalAgentLlmError({
      code: 'provider_misconfigured',
      message: 'OPENAI_API_KEY is missing',
    });
    expect(err.code).toBe('provider_misconfigured');
    expect(isPersonalAgentLlmError(err)).toBe(true);
  });

  it('narrows unknown', () => {
    expect(isPersonalAgentLlmError(new Error('x'))).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run packages/memento-core/src/domains/personal-agent/errors/personal-agent-llm-error.spec.ts`

Expected: FAIL (모듈 없음 또는 클래스 없음)

- [ ] **Step 3: 최소 구현**

`personal-agent-llm-error.ts`:

```typescript
export type PersonalAgentLlmErrorCode =
  | 'provider_disabled'
  | 'provider_misconfigured'
  | 'provider_runtime_failed';

export type PersonalAgentLlmErrorOptions = {
  code: PersonalAgentLlmErrorCode;
  message: string;
  cause?: unknown;
};

export class PersonalAgentLlmError extends Error {
  readonly code: PersonalAgentLlmErrorCode;

  constructor(options: PersonalAgentLlmErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PersonalAgentLlmError';
    this.code = options.code;
  }
}

export function isPersonalAgentLlmError(value: unknown): value is PersonalAgentLlmError {
  return value instanceof PersonalAgentLlmError;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run packages/memento-core/src/domains/personal-agent/errors/personal-agent-llm-error.spec.ts`

Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/personal-agent/errors/
git commit -m "feat(personal-agent): LLM 런타임 오류 타입 추가 (#334)"
```

---

### Task 2 (#334) — env 파싱 (`zod`)

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/config/personal-agent-llm-env.ts`
- Test: `packages/memento-core/src/domains/personal-agent/config/personal-agent-llm-env.spec.ts`

- [ ] **Step 1: 실패 테스트**

`personal-agent-llm-env.spec.ts`에서 `parsePersonalAgentLlmEnv`를 import하고:
- `MEMENTO_PERSONAL_AGENT_LLM_PROVIDER` 미설정 시 `provider: 'mock'`
- `provider: 'openai'`인데 `OPENAI_API_KEY` 없으면 `PersonalAgentLlmError` `provider_misconfigured`
- `provider: 'ollama'`인데 `MEMENTO_PERSONAL_AGENT_OLLAMA_MODEL` 비어 있으면 `provider_misconfigured`

(테스트에서 `process.env` 백업 후 복원 패턴 사용)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/memento-core/src/domains/personal-agent/config/personal-agent-llm-env.spec.ts`

Expected: FAIL

- [ ] **Step 3: 구현**

`personal-agent-llm-env.ts` — `zod` 스키마로 provider enum 파싱, `parsePersonalAgentLlmEnv(env: NodeJS.ProcessEnv, keys: { openaiApiKey?: string; geminiApiKey?: string })` 형태로 **API 키는 인자로 주입**(테스트에서 고정, 런타임에서는 `mementoConfig.openaiApiKey` 등 전달). 반환 타입 예:

```typescript
export type ParsedPersonalAgentLlmEnv =
  | { provider: 'mock' }
  | { provider: 'openai'; model: string }
  | { provider: 'gemini'; model: string }
  | { provider: 'ollama'; baseUrl: string; model: string };
```

`export function parsePersonalAgentLlmEnv(...): ParsedPersonalAgentLlmEnv` — misconfiguration 시 `throw new PersonalAgentLlmError({ code: 'provider_misconfigured', message: '...' })`.

- [ ] **Step 4: PASS**

Run: `npx vitest run packages/memento-core/src/domains/personal-agent/config/personal-agent-llm-env.spec.ts`

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/personal-agent/config/
git commit -m "feat(personal-agent): LLM provider env 파싱 (#334)"
```

---

### Task 3 (#334) — `createPersonalAgentLlmPort` 팩토리 + 단위 테스트

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/services/create-personal-agent-llm-port.ts`
- Create: `packages/memento-core/src/domains/personal-agent/services/create-personal-agent-llm-port.spec.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/index.ts` (export)
- Modify: `packages/memento-core/src/index.ts` (필요 시 re-export 한 줄)

- [ ] **Step 1: 실패 테스트**

`create-personal-agent-llm-port.spec.ts`:
- `provider: mock` → `DeterministicMockLlmAdapter` 인스턴스(`complete` 호출 가능)
- `provider: openai`이고 `deps.createOpenAi`가 주어지면 그 팩토리가 반환한 stub `ILLMPort`를 사용
- `provider: openai`인데 `deps.createOpenAi`가 `undefined`이면 `PersonalAgentLlmError` `provider_misconfigured`

팩토리 시그니처 예:

```typescript
import type { ILLMPort } from '../ports/llm-port.js';
import type { ParsedPersonalAgentLlmEnv } from '../config/personal-agent-llm-env.js';
import { DeterministicMockLlmAdapter } from '../adapters/deterministic-mock-llm-adapter.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

export type CreatePersonalAgentLlmPortDeps = {
  createOpenAi?: (cfg: Extract<ParsedPersonalAgentLlmEnv, { provider: 'openai' }>) => ILLMPort;
  createGemini?: (cfg: Extract<ParsedPersonalAgentLlmEnv, { provider: 'gemini' }>) => ILLMPort;
  createOllama?: (cfg: Extract<ParsedPersonalAgentLlmEnv, { provider: 'ollama' }>) => ILLMPort;
};

export function createPersonalAgentLlmPort(
  parsed: ParsedPersonalAgentLlmEnv,
  deps: CreatePersonalAgentLlmPortDeps = {},
): ILLMPort {
  if (parsed.provider === 'mock') {
    return new DeterministicMockLlmAdapter();
  }
  if (parsed.provider === 'openai') {
    if (!deps.createOpenAi) {
      throw new PersonalAgentLlmError({
        code: 'provider_misconfigured',
        message: 'OpenAI adapter is not registered in this build path',
      });
    }
    return deps.createOpenAi(parsed);
  }
  if (parsed.provider === 'gemini') {
    if (!deps.createGemini) {
      throw new PersonalAgentLlmError({
        code: 'provider_misconfigured',
        message: 'Gemini adapter is not registered in this build path',
      });
    }
    return deps.createGemini(parsed);
  }
  if (!deps.createOllama) {
    throw new PersonalAgentLlmError({
      code: 'provider_misconfigured',
      message: 'Ollama adapter is not registered in this build path',
    });
  }
  return deps.createOllama(parsed);
}
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/memento-core/src/domains/personal-agent/services/create-personal-agent-llm-port.spec.ts`

- [ ] **Step 3: 구현** (위 시그니처와 동일하게 파일 작성)

- [ ] **Step 4: PASS**

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/personal-agent/services/create-personal-agent-llm-port.ts \
  packages/memento-core/src/domains/personal-agent/services/create-personal-agent-llm-port.spec.ts \
  packages/memento-core/src/domains/personal-agent/index.ts \
  packages/memento-core/src/index.ts
git commit -m "feat(personal-agent): LLM 포트 팩토리와 gating (#334)"
```

---

### Task 4 (#334) — CLI `agent-ask`에 파싱·팩토리 연결 (아직 mock만)

**Files:**
- Modify: `packages/memento-server/src/cli/agent-ask.ts` (import + `const llm = ...` 교체)
- Test: `packages/memento-server`에 CLI 단위 테스트가 있으면 env mock으로 한 케이스 추가; 없으면 **core** 테스트만으로 #334 마무리하고 CLI는 수동 스모크 체크리스트에 기록

- [ ] **Step 1:** `mementoConfig` 또는 `process.env`에서 키 읽기 → `parsePersonalAgentLlmEnv` → `createPersonalAgentLlmPort(parsed, {})` 호출. **#335 이전**이므로 `createOpenAi` 등은 넘기지 않고, `openai`/`gemini`/`ollama` 선택 시 사용자에게 명확한 `provider_misconfigured` 메시지로 종료(JSON 모드면 기존 `jsonFailure` 패턴에 매핑).

- [ ] **Step 2:** `npm run type-check` 및 `npx vitest run packages/memento-core/src/domains/personal-agent/`

- [ ] **Step 3: 커밋**

```bash
git add packages/memento-server/src/cli/agent-ask.ts
git commit -m "feat(cli): personal-agent LLM env 연동 기본(mock) (#334)"
```

---

### Task 5 (#335) — `OpenAiChatLlmAdapter`

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/adapters/openai-chat-llm-adapter.ts`
- Create: `packages/memento-core/src/domains/personal-agent/adapters/openai-chat-llm-adapter.spec.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/index.ts`
- Modify: `packages/memento-server/src/cli/agent-ask.ts` — `createOpenAi: (cfg) => new OpenAiChatLlmAdapter({ apiKey: mementoConfig.openaiApiKey!, model: cfg.model, timeoutMs: ... })` (키 없으면 앞 단계에서 이미 파싱 실패)

- [ ] **Step 1: 실패 테스트** — `openai.chat.completions.create`를 `vi.spyOn` 또는 작은 래퍼 주입으로 모킹해 `messages` 전달·`LLMCompletionResult.metadata.provider === 'openai'` 검증

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/memento-core/src/domains/personal-agent/adapters/openai-chat-llm-adapter.spec.ts`

- [ ] **Step 3: 구현** — `OpenAI` from `openai`:

```typescript
import OpenAI from 'openai';
import type { ILLMPort, LLMCompletionResult, LLMMessage } from '../ports/llm-port.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

export type OpenAiChatLlmAdapterOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export class OpenAiChatLlmAdapter implements ILLMPort {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiChatLlmAdapterOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 60_000 });
    this.model = options.model;
  }

  async complete(messages: LLMMessage[]): Promise<LLMCompletionResult> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
      });
      const text = completion.choices[0]?.message?.content ?? '';
      return {
        content: text,
        metadata: {
          provider: 'openai',
          model: this.model,
          requestId: completion.id,
          finishReason: completion.choices[0]?.finish_reason ?? undefined,
        },
      };
    } catch (cause) {
      throw new PersonalAgentLlmError({
        code: 'provider_runtime_failed',
        message: 'OpenAI chat completion failed',
        cause,
      });
    }
  }
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/personal-agent/adapters/openai-chat-llm-adapter.ts \
  packages/memento-core/src/domains/personal-agent/adapters/openai-chat-llm-adapter.spec.ts \
  packages/memento-core/src/domains/personal-agent/index.ts \
  packages/memento-server/src/cli/agent-ask.ts
git commit -m "feat(personal-agent): OpenAI chat LLM adapter (#335)"
```

---

### Task 6 (#336) — `GeminiChatLlmAdapter`

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/adapters/gemini-chat-llm-adapter.ts`
- Create: `packages/memento-core/src/domains/personal-agent/adapters/gemini-chat-llm-adapter.spec.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/index.ts`
- Modify: `packages/memento-server/src/cli/agent-ask.ts` — `createGemini` 등록

- [ ] **Step 1: 실패 테스트** — `@google/generative-ai`의 `GenerativeModel.prototype.generateContent`를 `vi.spyOn`으로 모킹. `getGenerativeModel({ model })` 호출 후 `metadata.provider === 'gemini'`.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/memento-core/src/domains/personal-agent/adapters/gemini-chat-llm-adapter.spec.ts`

- [ ] **Step 3: 구현** — `GoogleGenerativeAI` 사용 예:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerativeModel } from '@google/generative-ai';
import type { ILLMPort, LLMCompletionResult, LLMMessage } from '../ports/llm-port.js';
import { PersonalAgentLlmError } from '../errors/personal-agent-llm-error.js';

export type GeminiChatLlmAdapterOptions = {
  apiKey: string;
  model: string;
};

export class GeminiChatLlmAdapter implements ILLMPort {
  private readonly generativeModel: GenerativeModel;
  private readonly modelName: string;

  constructor(options: GeminiChatLlmAdapterOptions) {
    this.modelName = options.model;
    const genAI = new GoogleGenerativeAI(options.apiKey);
    this.generativeModel = genAI.getGenerativeModel({ model: options.model });
  }

  async complete(messages: LLMMessage[]): Promise<LLMCompletionResult> {
    try {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const rest = messages.filter((m) => m.role !== 'system');
      const prompt = [system, ...rest.map((m) => `${m.role}: ${m.content}`)].join('\n\n');
      const result = await this.generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const text = result.response.text();
      return {
        content: text,
        metadata: {
          provider: 'gemini',
          model: this.modelName,
          finishReason: undefined,
        },
      };
    } catch (cause) {
      throw new PersonalAgentLlmError({
        code: 'provider_runtime_failed',
        message: 'Gemini generateContent failed',
        cause,
      });
    }
  }
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-core/src/domains/personal-agent/adapters/gemini-chat-llm-adapter.ts \
  packages/memento-core/src/domains/personal-agent/adapters/gemini-chat-llm-adapter.spec.ts \
  packages/memento-core/src/domains/personal-agent/index.ts \
  packages/memento-server/src/cli/agent-ask.ts
git commit -m "feat(personal-agent): Gemini chat LLM adapter (#336)"
```

---

### Task 7 (#337) — `OllamaChatLlmAdapter` + smoke 문서

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/adapters/ollama-chat-llm-adapter.ts`
- Create: `packages/memento-core/src/domains/personal-agent/adapters/ollama-chat-llm-adapter.spec.ts`
- Modify: `packages/memento-core/src/domains/personal-agent/index.ts`
- Modify: `packages/memento-server/src/cli/agent-ask.ts`
- Create or Modify: `docs/` 내 personal-agent / CLI 절차 (기존 agent-ask 문서가 있으면 그 파일에 "Ollama smoke" 절 추가)

Ollama HTTP 예 (`/api/chat`):

```typescript
const res = await fetch(new URL('/api/chat', baseUrl), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  }),
});
if (!res.ok) {
  throw new PersonalAgentLlmError({
    code: 'provider_runtime_failed',
    message: `Ollama HTTP ${res.status}`,
  });
}
```

- [ ] **Step 1~4:** Task 5와 동일 리듬(Vitest에서 `global.fetch` mock)

- [ ] **Step 5: 문서** — `ollama serve` 선행, 환경 변수 예, `memento ... agent ask` 한 줄 예시

- [ ] **Step 6: 커밋**

```bash
git commit -m "feat(personal-agent): Ollama chat LLM adapter 및 로컬 smoke 문서 (#337)"
```

---

### Task 8 — 품질 게이트

- [ ] **Step 1:** 루트에서 `npm run type-check`

- [ ] **Step 2:** `npm test`

- [ ] **Step 3:** `npm run lint`

- [ ] **Step 4:** 커밋(필요 시만) 또는 CI 녹색 확인

---

## Spec coverage (self-review)

| 스펙 요구 | 담당 Task |
| --- | --- |
| 명시 설정 없으면 실제 provider 비활성(mock) | Task 2, 3, 4 |
| disabled / misconfigured / runtime-failed 구분 | Task 1(`provider_disabled`는 예: 사용자가 `MEMENTO_PERSONAL_AGENT_LLM_PROVIDER=openai`로 두고 기능 플래그로 막는 경우 등 **정책 확정 후** CLI 메시지에 사용), Task 2·5~7 |
| provider별 독립 검증 | Task 5, 6, 7 각각 전용 spec |
| mock 테스트 외부 API 없음 | 모든 provider 테스트는 mock/spy |

**Gap 보완:** `provider_disabled`의 정확한 UX(예: 향후 `MEMENTO_PERSONAL_AGENT_LLM_ENABLED=false`)는 스펙 비목표와 충돌하지 않는 선에서 Task 2에 **한 문장**으로만 추가하거나, 별도 이슈로 남긴다.

## Placeholder scan

- 본 문서에 `TBD` / `implement later` 없음.

## Type consistency

- 모든 어댑터는 `ILLMPort` 구현.
- `LLMProviderMetadata.provider`는 `llm-port.ts`의 리터럴 유니온과 일치(`'openai' \| 'gemini' \| 'ollama' \| 'mock'`).

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-15-issue-238-personal-agent-llm-providers.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 태스크마다 새 서브에이전트를 붙이고 태스크 사이에 리뷰.

**2. Inline Execution** — 이 세션에서 `executing-plans` 스타일로 체크포인트마다 실행.

원하시는 쪽을 알려 주세요.
