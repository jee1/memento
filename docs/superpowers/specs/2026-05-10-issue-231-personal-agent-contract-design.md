# 설계: 이슈 #231 — PersonalKnowledgeAgentService 계약 추가

**날짜**: 2026-05-10  
**이슈**: [#231](https://github.com/jee1/memento/issues/231)  
**부모**: [#82](https://github.com/jee1/memento/issues/82) 개인 지식 축적 Agent MVP  
**상태**: 설계 완료, 구현 대기

---

## 1. 목표

개인 지식 Agent Loop의 서비스 계약과 타입을 `memento-core` 도메인에 추가한다.  
실제 LLM·context·persistence 구현은 포트 인터페이스로 추상화하여 #232~#238에서 교체한다.

---

## 2. 범위

### 포함
- `PersonalKnowledgeAgentInput`, `PersonalKnowledgeAgentResult`, `KnowledgeCandidate` 타입 정의
- `ILLMPort`, `IContextPort`, `IPersistencePort` 포트 인터페이스 정의
- `PersonalKnowledgeAgentService` 골격 (DI 기반, mock 가능)
- mock dependency로 한 턴 실행을 검증하는 단위 테스트

### 제외
- 실제 LLM provider 연결 (#233, #238)
- 실제 context 검색 (#232)
- 실제 `remember` 저장 (#235)
- CLI 명령 (#236)

---

## 3. 파일 구조

```
packages/memento-core/src/domains/personal-agent/
├── types/
│   └── agent-types.ts
├── ports/
│   ├── llm-port.ts
│   ├── context-port.ts
│   └── persistence-port.ts
├── services/
│   ├── personal-knowledge-agent-service.ts
│   └── personal-knowledge-agent-service.spec.ts
└── index.ts
```

기존 `consolidation` 도메인(`services/` 서브디렉터리 + 코로케이트 스펙 + `index.ts`)과 동일한 패턴.

---

## 4. 타입 정의

**`types/agent-types.ts`**

```typescript
export interface KnowledgeCandidate {
  content: string;
  type: 'episodic' | 'semantic' | 'procedural';
  importance: number;       // 0.0 ~ 1.0, 기존 메모리 시스템 스케일 준수
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

- `KnowledgeCandidate.type`은 기존 `MemoryType` 열거형과 동일 값 사용
- `sessionId`·`projectId`는 옵셔널 — #231 범위에서 mock이 무시해도 무방

---

## 5. 포트 인터페이스

**`ports/llm-port.ts`**
```typescript
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ILLMPort {
  complete(messages: LLMMessage[]): Promise<string>;
}
```

**`ports/context-port.ts`**
```typescript
import type { KnowledgeCandidate } from '../types/agent-types.js';

export interface IContextPort {
  buildContext(userMessage: string, projectId?: string): Promise<string>;
  proposeCandidates(candidates: KnowledgeCandidate[]): Promise<void>;
}
```

**`ports/persistence-port.ts`**
```typescript
import type { KnowledgeCandidate } from '../types/agent-types.js';

export interface IPersistencePort {
  persist(candidates: KnowledgeCandidate[]): Promise<void>;
}
```

- `ILLMPort`는 아카이브(`memento-agent-issue-100`)의 `LLMProvider` 패턴 단순화
- `IContextPort`가 context 빌드와 후보 제안을 담당 — #232가 구현할 경계
- `IPersistencePort` 분리 — #235에서 실제 `remember` 연결 시 교체

---

## 6. 서비스 골격

**`services/personal-knowledge-agent-service.ts`**
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

- `PersonalKnowledgeAgentDeps` 패턴은 `SleepConsolidationServiceDeps`와 동일
- `candidates = []` stub — #234 전에도 타입 계약 성립

---

## 7. 테스트

**`services/personal-knowledge-agent-service.spec.ts`**

| 케이스 | 검증 내용 |
|---|---|
| mock DI로 한 턴 실행 | `llmResponse`, `persisted`, `buildContext` 호출 확인 |
| `projectId` 없는 입력 | `buildContext(msg, undefined)` 정상 처리 |
| LLM 실패 | 포트 reject 시 `runOneTurn` propagate |

---

## 8. 의존 방향

```
personal-agent (domain)
  └── depends on → shared types 만
  └── does NOT import → memory / recall / remember 구현체
```

기존 `remember`·`recall`·`memory_injection` 동작 무변경.

---

## 9. 완료 기준

- `npm run type-check` 통과
- `personal-knowledge-agent-service.spec.ts` 전체 통과
- 기존 core 단위 테스트 회귀 없음

---

## 10. 후속 이슈 연결

| 이슈 | 교체/확장 대상 |
|---|---|
| #232 | `IContextPort` 실제 구현 (recall 기반) |
| #233 | `ILLMPort` mock provider 추가 |
| #234 | `candidates` stub → 실제 추출 |
| #235 | `IPersistencePort` 실제 구현 |
| #236 | CLI 명령 추가 |
| #237 | E2E 시나리오 |
| #238 | 실제 LLM provider adapter |
