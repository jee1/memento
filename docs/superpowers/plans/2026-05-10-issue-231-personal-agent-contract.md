# PersonalKnowledgeAgentService 계약 추가 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **워크트리:** 구현 시작 전 `superpowers:using-git-worktrees` 스킬로 `issue-231-personal-agent-contract` 브랜치 워크트리를 먼저 생성할 것.

**Goal:** `memento-core`에 `PersonalKnowledgeAgentService` 계약(타입·포트·서비스 골격)을 추가하고, mock DI로 한 턴 실행을 단위 테스트로 검증한다.

**Architecture:** 신규 `domains/personal-agent/` 도메인을 `memento-core` 안에 추가한다. 외부 의존(LLM·context·persistence)은 포트 인터페이스로 추상화해 DI로 주입받으며, 기존 `remember`/`recall`/`memory_injection` 코드는 전혀 변경하지 않는다.

**Tech Stack:** TypeScript, Vitest(`vi.fn()` mock), Node.js ≥ 24

---

## 파일 구조

| 상태 | 경로 | 역할 |
|------|------|------|
| 신규 | `packages/memento-core/src/domains/personal-agent/types/agent-types.ts` | 도메인 타입 3종 |
| 신규 | `packages/memento-core/src/domains/personal-agent/ports/llm-port.ts` | LLM 포트 |
| 신규 | `packages/memento-core/src/domains/personal-agent/ports/context-port.ts` | Context 포트 |
| 신규 | `packages/memento-core/src/domains/personal-agent/ports/persistence-port.ts` | Persistence 포트 |
| 신규 | `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.ts` | 서비스 골격 |
| 신규 | `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts` | 단위 테스트 |
| 신규 | `packages/memento-core/src/domains/personal-agent/index.ts` | public export |

---

## Task 1: 디렉터리 생성 & 스펙 파일 작성 (TDD Red)

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts`

- [ ] **Step 1: 디렉터리 생성**

```bash
mkdir -p packages/memento-core/src/domains/personal-agent/{types,ports,services}
```

- [ ] **Step 2: 스펙 파일 작성** (아직 import 대상 파일이 없어 type-check 실패 — 의도적)

`packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PersonalKnowledgeAgentService } from './personal-knowledge-agent-service.js';
import type { ILLMPort } from '../ports/llm-port.js';
import type { IContextPort } from '../ports/context-port.js';
import type { IPersistencePort } from '../ports/persistence-port.js';

describe('PersonalKnowledgeAgentService', () => {
  function makeDeps() {
    const completeFn = vi.fn().mockResolvedValue('LLM 응답');
    const buildContextFn = vi.fn().mockResolvedValue('컨텍스트 텍스트');
    const proposeCandidatesFn = vi.fn().mockResolvedValue(undefined);
    const persistFn = vi.fn().mockResolvedValue(undefined);

    const llm = { complete: completeFn } as unknown as ILLMPort;
    const context = { buildContext: buildContextFn, proposeCandidates: proposeCandidatesFn } as unknown as IContextPort;
    const persistence = { persist: persistFn } as unknown as IPersistencePort;

    return { llm, context, persistence, completeFn, buildContextFn, proposeCandidatesFn, persistFn };
  }

  it('mock dependency로 한 턴을 실행하고 llmResponse를 반환한다', async () => {
    const { llm, context, persistence } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    const result = await svc.runOneTurn({ userMessage: '테스트 입력' });

    expect(result.llmResponse).toBe('LLM 응답');
    expect(result.persisted).toBe(true);
    expect(result.candidates).toEqual([]);
  });

  it('buildContext를 userMessage와 projectId로 호출한다', async () => {
    const { llm, context, persistence, buildContextFn } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await svc.runOneTurn({ userMessage: '입력', projectId: 'proj-1' });

    expect(buildContextFn).toHaveBeenCalledWith('입력', 'proj-1');
  });

  it('projectId 없을 때 buildContext를 undefined로 호출한다', async () => {
    const { llm, context, persistence, buildContextFn } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await svc.runOneTurn({ userMessage: '입력' });

    expect(buildContextFn).toHaveBeenCalledWith('입력', undefined);
  });

  it('llm.complete를 system+user 메시지로 호출한다', async () => {
    const { llm, context, persistence, completeFn } = makeDeps();
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await svc.runOneTurn({ userMessage: '질문' });

    expect(completeFn).toHaveBeenCalledWith([
      { role: 'system', content: '컨텍스트 텍스트' },
      { role: 'user', content: '질문' },
    ]);
  });

  it('LLM 포트가 reject하면 에러를 그대로 전파한다', async () => {
    const { llm, context, persistence, completeFn } = makeDeps();
    completeFn.mockRejectedValueOnce(new Error('LLM 오류'));
    const svc = new PersonalKnowledgeAgentService({ llm, context, persistence });

    await expect(svc.runOneTurn({ userMessage: '입력' })).rejects.toThrow('LLM 오류');
  });
});
```

- [ ] **Step 3: type-check가 실패하는지 확인 (의도된 실패)**

```bash
npm run type-check -w @memento/core 2>&1 | grep "personal-agent" | head -5
```

예상 출력: `Cannot find module './personal-knowledge-agent-service.js'` 형태의 오류

---

## Task 2: 타입 & 포트 정의 (TDD Green — 타입 레벨)

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/types/agent-types.ts`
- Create: `packages/memento-core/src/domains/personal-agent/ports/llm-port.ts`
- Create: `packages/memento-core/src/domains/personal-agent/ports/context-port.ts`
- Create: `packages/memento-core/src/domains/personal-agent/ports/persistence-port.ts`

- [ ] **Step 1: agent-types.ts 작성**

`packages/memento-core/src/domains/personal-agent/types/agent-types.ts`

```typescript
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
  persisted: boolean;
}
```

- [ ] **Step 2: llm-port.ts 작성**

`packages/memento-core/src/domains/personal-agent/ports/llm-port.ts`

```typescript
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ILLMPort {
  complete(messages: LLMMessage[]): Promise<string>;
}
```

- [ ] **Step 3: context-port.ts 작성**

`packages/memento-core/src/domains/personal-agent/ports/context-port.ts`

```typescript
import type { KnowledgeCandidate } from '../types/agent-types.js';

export interface IContextPort {
  buildContext(userMessage: string, projectId?: string): Promise<string>;
  proposeCandidates(candidates: KnowledgeCandidate[]): Promise<void>;
}
```

- [ ] **Step 4: persistence-port.ts 작성**

`packages/memento-core/src/domains/personal-agent/ports/persistence-port.ts`

```typescript
import type { KnowledgeCandidate } from '../types/agent-types.js';

export interface IPersistencePort {
  persist(candidates: KnowledgeCandidate[]): Promise<void>;
}
```

- [ ] **Step 5: 포트 파일만 type-check 확인 (서비스 파일 오류는 아직 정상)**

```bash
npm run type-check -w @memento/core 2>&1 | grep "personal-agent" | head -10
```

예상: `personal-knowledge-agent-service.ts`를 찾을 수 없다는 오류만 남아 있어야 함 (포트/타입 파일 오류는 사라짐)

---

## Task 3: 서비스 구현 (TDD Green — 런타임)

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.ts`

- [ ] **Step 1: 서비스 파일 작성**

`packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.ts`

```typescript
import type { ILLMPort } from '../ports/llm-port.js';
import type { IContextPort } from '../ports/context-port.js';
import type { IPersistencePort } from '../ports/persistence-port.js';
import type {
  KnowledgeCandidate,
  PersonalKnowledgeAgentInput,
  PersonalKnowledgeAgentResult,
} from '../types/agent-types.js';

export interface PersonalKnowledgeAgentDeps {
  llm: ILLMPort;
  context: IContextPort;
  persistence: IPersistencePort;
}

export class PersonalKnowledgeAgentService {
  constructor(private readonly deps: PersonalKnowledgeAgentDeps) {}

  async runOneTurn(input: PersonalKnowledgeAgentInput): Promise<PersonalKnowledgeAgentResult> {
    const contextText = await this.deps.context.buildContext(
      input.userMessage,
      input.projectId,
    );

    const llmResponse = await this.deps.llm.complete([
      { role: 'system', content: contextText },
      { role: 'user', content: input.userMessage },
    ]);

    // #234에서 실제 후보 추출 구현
    const candidates: KnowledgeCandidate[] = [];
    await this.deps.context.proposeCandidates(candidates);

    // #235에서 승인 흐름 구현
    await this.deps.persistence.persist(candidates);

    return { candidates, llmResponse, persisted: true };
  }
}
```

- [ ] **Step 2: 스펙 파일만 실행 — 전체 통과 확인**

```bash
vitest --run packages/memento-core/src/domains/personal-agent/services/personal-knowledge-agent-service.spec.ts
```

예상 출력:
```
✓ personal-knowledge-agent-service.spec.ts (5)
  ✓ PersonalKnowledgeAgentService
    ✓ mock dependency로 한 턴을 실행하고 llmResponse를 반환한다
    ✓ buildContext를 userMessage와 projectId로 호출한다
    ✓ projectId 없을 때 buildContext를 undefined로 호출한다
    ✓ llm.complete를 system+user 메시지로 호출한다
    ✓ LLM 포트가 reject하면 에러를 그대로 전파한다

Test Files  1 passed (1)
Tests       5 passed (5)
```

- [ ] **Step 3: type-check 통과 확인**

```bash
npm run type-check -w @memento/core 2>&1 | grep -c "error TS"
```

예상 출력: `0` (오류 없음)

---

## Task 4: index.ts 작성 & 전체 검증 & 커밋

**Files:**
- Create: `packages/memento-core/src/domains/personal-agent/index.ts`

- [ ] **Step 1: index.ts 작성**

`packages/memento-core/src/domains/personal-agent/index.ts`

```typescript
export type {
  KnowledgeCandidate,
  PersonalKnowledgeAgentInput,
  PersonalKnowledgeAgentResult,
} from './types/agent-types.js';

export type { LLMMessage, ILLMPort } from './ports/llm-port.js';
export type { IContextPort } from './ports/context-port.js';
export type { IPersistencePort } from './ports/persistence-port.js';

export {
  PersonalKnowledgeAgentService,
} from './services/personal-knowledge-agent-service.js';
export type { PersonalKnowledgeAgentDeps } from './services/personal-knowledge-agent-service.js';
```

- [ ] **Step 2: core 전체 테스트 실행 — 회귀 없음 확인**

```bash
npm run test:ci:core 2>&1 | tail -10
```

예상: `Test Files X passed`, `Tests Y passed` — personal-agent 5개 포함, 기존 테스트 모두 통과

- [ ] **Step 3: core type-check 최종 확인**

```bash
npm run type-check -w @memento/core
```

예상: 오류 없이 종료 (exit code 0)

- [ ] **Step 4: 변경 파일 스테이징 & 커밋**

```bash
git add packages/memento-core/src/domains/personal-agent/
git commit -m "feat(personal-agent): add PersonalKnowledgeAgentService contract (#231)

- PersonalKnowledgeAgentInput / Result / KnowledgeCandidate 타입 정의
- ILLMPort / IContextPort / IPersistencePort 포트 인터페이스 정의
- PersonalKnowledgeAgentService 골격 (DI 기반, mock 가능)
- mock dependency 한 턴 실행 단위 테스트 5종"
```

- [ ] **Step 5: 이슈 #231 완료 기준 체크**

```bash
# 1) type-check 통과
npm run type-check -w @memento/core && echo "✓ type-check"

# 2) 단위 테스트 통과
vitest --run packages/memento-core/src/domains/personal-agent/ && echo "✓ tests"

# 3) 기존 core 테스트 회귀 없음
npm run test:ci:core && echo "✓ no regression"
```

---

## 완료 기준 요약

| 기준 | 검증 커맨드 |
|------|------------|
| TypeScript 타입 오류 없음 | `npm run type-check -w @memento/core` |
| 신규 단위 테스트 5종 통과 | `vitest --run packages/memento-core/src/domains/personal-agent/` |
| 기존 core 테스트 회귀 없음 | `npm run test:ci:core` |
| 기존 `remember`/`recall`/`memory_injection` 변경 없음 | `git diff HEAD -- packages/memento-core/src/domains/memory/` (변경 없어야 함) |
