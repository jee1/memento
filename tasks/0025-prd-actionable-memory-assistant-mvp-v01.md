# PRD: Memento Agent — 통합 PRD v1.0 (MVP v0.1)

**프로젝트명**: Memento Agent (aka. Actionable Memory Assistant)

**문서 버전**: 통합 PRD v1.0 (Cursor + Gemini + 제안 통합, 실전 개발용)

**구현 언어**: TypeScript (Memento와 동일)

---

# 1. Executive Summary

## 한 줄 정의

> **기억을 기반으로 행동하는 AI 비서**

Memento의 장기 기억을 활용해 사용자의 맥락을 이해하고, 외부 행동(검색)을 수행한 뒤 결과를 다시 기억하는 **순환형 Memory Agent**.

---

## Core Concept — One-Action Rule

MVP에서는 **단 하나의 행동만 수행**한다:

- **Personalized Web Search** (`search_web_with_memory`)

이로써 다음을 증명한다:

- Memory → Action 연결
- Personalization 체감
- Transparency 확보

---

# 2. Goals

## Product Goals

| ID | 목표 | 설명 |
|----|------|------|
| **G1** | Memory-first 체감 | 과거 맥락을 활용한 응답 생성 |
| **G2** | Action 체감 | 단순 답변이 아니라 실제 작업 수행(검색·요약) |
| **G3** | Transparency | 왜 이 기억을 썼는지 노출(usedMemories, why) |
| **G4** | 확장 가능 구조 | Tool Registry 기반으로 툴 추가 시 "등록"만으로 확장 |

---

## Non-Goals (v0.1 제외)

- 멀티 에이전트
- 멀티 툴 오케스트레이션
- Planning / Reflection loops
- Plugin ecosystem
- Fancy UI
- 멀티 채널 (WebChat/Telegram 등은 v0.1 이후)

## Agent UI (v0.1)

- **일단 CLI로 진행.** 사용자 진입점은 CLI(예: `npx memento-agent chat` 또는 전용 CLI 명령). WebChat·웹 UI·멀티 채널은 v0.1 이후 확장.

---

# 3. Architecture Principles

## AP1. Memory Server Separation

- **Memento Core** = Memory Server (기존 `src/` 또는 memory API)
- **Agent** = Runtime Layer (loop + tools + clients)

---

## AP2. Dogfooding 강제

Agent는 Core를:

- ❌ **import 금지**
- ✅ **HTTP/MCP 호출만 허용**

타입/계약은 OpenAPI, MCP 스펙, 또는 공유 JSON Schema로만 공유한다.

---

## AP3. Monorepo + Runtime Separation

- **코드**: 한 레포(모노레포)
- **실행**: core와 agent는 별도 프로세스/컨테이너
- 기본 개발 UX: `docker compose up`으로 core + agent 동시 기동

---

## AP4. Tool Interface First

- 모든 도구는 **JSON Schema 기반** 입력 스키마를 갖는다.
- MVP: Tool 1개만 등록(`search_web_with_memory`).

---

# 4. Monorepo Structure

## 4.1 Memento 본체 위치 (명시)

모노레포에서 **Memento 본체(메모리 서버)** 는 **레포 루트**에 위치한다. 별도의 `services/core/` 로 옮기지 않는다.

| 구분 | 위치 | 설명 |
|------|------|------|
| **소스 코드** | **`src/`** (루트 직하위) | Memento Core 전부. `server/`, `domains/`, `shared/`, `infrastructure/` 등. |
| **CLI/MCP 진입점** | `src/server/index.ts` | 기존 MCP 서버. |
| **HTTP 진입점** | `src/server/http-server.ts` | 기존 HTTP API. |
| **빌드·설정** | 루트 `package.json`, `tsconfig.json` 등 | 현재 레포의 빌드/테스트는 이 루트 기준으로 동작. |

- **Agent** 만 **`services/agent/`** 아래에 **신규 추가**한다.
- 기존 Memento 코드는 **이동하지 않는다** (리팩터 없이 그대로 둠).  
  → 혼동 방지: "Core = 루트의 `src/`", "Agent = `services/agent/`" 만 기억하면 됨.

**모노레포 레이아웃 요약**

```
[ 레포 루트 = Memento 본체 (src/ + package.json + 기존 설정) ]
         +
[ services/agent/ = Memento Agent (신규) ]
```

---

## 4.2 디렉터리 트리

```
jee1/memento/
├── src/                          # ★ Memento 본체 (Memory Server) — 변경 없음
│   ├── server/                   # MCP: index.ts, HTTP: http-server.ts
│   ├── domains/
│   ├── shared/
│   ├── infrastructure/
│   └── ...
├── package.json                  # 루트 빌드/의존성 (Memento Core)
├── tsconfig.json
├── services/
│   └── agent/                    # ★ Memento Agent (신규)
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── server.ts
│       │   ├── loop/
│       │   │   └── actionableLoop.ts
│       │   ├── tools/
│       │   │   ├── baseTool.ts
│       │   │   ├── searchTool.ts
│       │   │   └── registry.ts
│       │   ├── clients/
│       │   │   ├── mementoClient.ts
│       │   │   ├── llmClient.ts
│       │   │   └── searchClient.ts
│       │   ├── intent/
│       │   │   └── ruleIntent.ts
│       │   ├── schemas/
│       │   │   └── contracts.ts
│       │   └── config.ts
│       ├── Dockerfile
│       └── README.md              # 지원 core API 버전 명시
└── docker-compose.yml             # core + agent 동시 기동
```

---

## 4.3 Agent 설치 및 Memento 의존성

Agent는 Memento를 **API(HTTP/MCP) 호출**로만 사용하므로, **Agent를 쓰기 전에 Memento(Core)가 설치·실행되어 있어야** 한다.

### 전제 조건

- **Memento(Core)가 이미 설치되어 있고, HTTP 또는 MCP로 접근 가능한 상태.**

### 설치·실행 시나리오

| 시나리오 | Memento 설치·실행 | Agent 설치·실행 | 비고 |
|----------|--------------------|-----------------|------|
| **A. 모노레포 로컬** | 루트에서 `npm install && npm run dev` 또는 `npm run dev:http` → Memento HTTP 서버 기동 | `cd services/agent && npm install`, `MEMENTO_BASE_URL=http://localhost:<PORT>` 설정 후 CLI/서버 실행 | 개발 시 동일 레포에서 Core·Agent 각각 실행 |
| **B. Docker Compose** | `docker compose up` 시 **Memento 컨테이너**가 먼저 기동 | 같은 `docker compose up`으로 **Agent 컨테이너**도 기동. Agent는 `MEMENTO_BASE_URL=http://memento-core:<PORT>` 등으로 Core 호출 | 한 번에 둘 다 실행, 권장 방식 |
| **C. Memento 원격** | 이미 다른 호스트/서비스로 Memento가 떠 있음 | Agent만 설치 후 `MEMENTO_BASE_URL=https://...` 로 해당 URL 지정 | Core와 Agent 분리 배포 시 |

### Agent 쪽 필수 설정

- **`MEMENTO_BASE_URL`** (또는 `MEMENTO_HTTP_URL`): Memento HTTP API 베이스 URL (예: `http://localhost:3000`, `http://memento-core:3000`).  
  - Agent의 `mementoClient`는 이 URL로 memory_injection, remember 등 호출.
- (선택) Memento가 인증을 요구하면 API 키·헤더 등은 구현 시 계약에 맞춰 추가.

### 권장 설치 순서 (v0.1)

1. **Memento 설치·기동**  
   - 같은 레포: 루트에서 `npm install`, `npm run build`, `npm run dev:http`(또는 `npm run dev`)로 Memento 기동.  
   - 또는 `docker compose up`으로 Memento 서비스만 먼저 올려서 확인.
2. **Agent 설치·기동**  
   - `cd services/agent && npm install` (또는 워크스페이스면 루트에서 `npm install`).  
   - `MEMENTO_BASE_URL` 설정 후 `npm run dev` 또는 CLI 명령 실행.  
   - Docker 사용 시: `docker compose up` 한 번에 Core + Agent 모두 기동되도록 compose 정의.

### 문서화 요구

- **Agent README** (`services/agent/README.md`):  
  - "Prerequisites: Memento must be installed and running."  
  - Memento 기동 방법(루트에서 실행 또는 Docker) 링크 또는 요약.  
  - `MEMENTO_BASE_URL` 설정 방법 및 기본값(예: `http://localhost:3000`).  
  - (선택) `agent setup` 또는 `agent doctor` 같은 명령으로 Memento 연결 가능 여부 체크.

---

# 5. Functional Requirements

## FR-1. Actionable Memory Loop

한 턴 처리 단계(Loop Stages):

1. **User Input** 수신
2. **Intent Detection** (rule-based only, v0.1)
3. **Memory Injection** (Core HTTP/MCP 호출)
4. **LLM Reasoning** (prompt + 주입된 기억)
5. **Tool Execution** (optional, intent가 action_search일 때만)
6. **Response** 생성
7. **Memory Remember** (요약·핵심 키워드 저장)

---

## FR-2. Intent Detection (v0.1 고정)

**Rule-based only.** LLM intent classification은 v0.1 스코프에서 **금지** (범위 보호).

### Action 트리거 (검색 경로)

- `/search`
- "검색해줘"
- "찾아줘"
- "요즘 뭐가 핫해"

위 패턴/키워드 매칭 시 → `intent: "action_search"`.  
그 외 → `intent: "chat"`.

---

## FR-3. Memory Injection

Agent는 Memento Core를 **HTTP/MCP**로만 호출한다. 호출 시 **`owner_id`**를 반드시 전달하여, 해당 소유자의 기억만 검색·주입되도록 한다.

### 계약 요구사항 (Agent가 사용할 응답 형태)

- `memories[]` (또는 동등한 관련 기억 목록)
- `score` (관련도)
- `why` (matched terms 등 근거)
- `injectionText` (프롬프트에 넣을 문자열)

> **구현 시**: Memento 실제 엔드포인트(MCP prompt `memory_injection` 또는 HTTP 라우트)와 위 필드를 매핑한다. `docs/api/en/api-reference.md` 및 Core API 매핑 작업에서 확정.

---

## FR-4. Memory Consolidation (Remember)

Agent는 응답/행동 요약을 Core에 저장한다.

### 저장 시 포함 권장

- 행동 요약 (또는 대화 요약)
- 핵심 키워드
- **`owner_id`** (필수 권장): 기억의 소유자 구분. Memento Core의 `owner_id`와 동일 개념. 같은 owner의 모든 대화·세션에 걸쳐 recall 시 해당 사용자 기억만 검색되도록 전달.
- **`sessionId`** (선택): 대화 단위 구분. 바뀌면 "다른 대화"로 취급되나, recall 시에는 **owner_id**로 묶여 있어 이전 대화 기억도 주입 가능.
- `source: "memento-agent"` (출처 구분용)

### 계약

- Core의 **remember** API (MCP 도구 또는 HTTP `POST /api/v1/memory/remember` 등)를 호출.
- content, type(episodic/semantic 등), tags 등은 Memento 스키마에 맞춘다.

---

## FR-5. One Killer Tool — Personalized Search

### Tool Name

`search_web_with_memory`

### 동작 방식

1. Memory에서 context keywords 추출 (memory_injection 또는 recall 결과 활용)
2. `query + context`로 검색 수행
3. 결과 요약
4. 출처(링크/스니펫) 포함 반환
5. (선택) 결과 요약을 remember로 저장

### Provider Abstraction

```ts
interface SearchProvider {
  search(query: string, context?: string): Promise<SearchResult>;
}
```

동일 인터페이스를 구현하는 provider를 설정으로 선택한다. v0.1에서 **하나 이상** 구현하면 된다.

### Search Provider 후보

| 방식 | 비용 | 장점 | 주의사항 |
|------|------|------|----------|
| **Tavily / SerpAPI / Brave 등 API** | 유료(호출당) | 안정적, 빠름, ToS 명확 | 비용 발생 |
| **Playwright + Google (또는 DDG)** | 무료 | 검색 비용 0, LLM만 과금 | 아래 "Playwright 검색" 참고 |

#### Playwright 검색 (무료 옵션)

**의도**: 검색은 API 비용 없이, Playwright로 브라우저 자동화해 Google(또는 DuckDuckGo 등) 결과 페이지를 열고 결과를 파싱한다. LLM 비용은 어쩔 수 없지만, 검색 비용을 줄이고 싶을 때 선택 가능하다.

- **장점**: 호출당 요금 없음, Google 품질 활용 가능, `SearchProvider` 구현체 하나로 추가 가능.
- **주의사항**  
  - **이용약관**: Google 등 검색 엔진의 ToS는 자동화·스크래핑을 제한할 수 있음. 개인/로컬·저빈도 사용은 실무에서 많이 쓰이나, 제품 기본값으로 쓸 때는 ToS 확인 권장.  
  - **안정성**: HTML 구조 변경 시 셀렉터/파싱 로직 수정 필요. 유지보수 부담.  
  - **지연·리소스**: 브라우저 기동·페이지 로드로 API 대비 지연·메모리 사용 증가 (수 초 단위).  
  - **규모**: 동시 요청·과도한 호출 시 IP 제한·CAPTCHA 가능성.
- **구현**: `SearchProvider`의 한 구현체로 `PlaywrightSearchProvider`(또는 유사명)를 두고, 설정(예: `AGENT_SEARCH_PROVIDER=playwright`)으로 선택 가능하게 하면, API 기반 provider와 나중에 교체·병행하기 쉽다.

**정리**: 비용 절감 목적으로는 **타당한 선택**이다. 기본값을 API로 둘지 Playwright로 둘지는 운영 정책(ToS·안정성 우선 vs 비용 우선)에 따라 결정하고, PRD에서는 **옵션으로 명시**하는 것이 좋다.

**MVP 기본값**: Open Questions에서 결정. (API 1종 vs Playwright 1종 vs 둘 다 구현 후 설정으로 선택.)

---

## FR-6. Transparency UX

Agent 응답은 반드시 **meta** 포함:

- `usedMemories`: 이번 턴에 사용된 기억 목록 (preview, score, why)
- `executedTools`: 실행된 도구와 결과 요약 (action_search일 때)
- `intent`: `"chat"` | `"action_search"`

클라이언트가 "왜 이 답인지" 보여줄 수 있도록 한다. **v0.1에서는 Memory Inspector도 CLI로 제공**하며, 응답 meta(usedMemories, why 등)를 터미널에 출력한다. 웹 Inspector는 v0.1 이후.

---

## FR-7. LLM Provider (Agent)

Agent의 **채팅 응답 생성** 및 **검색 결과 요약**에는 LLM이 사용된다. Memento Core의 LLM 설정과는 **독립적으로**, Agent 전용 LLM 설정을 둔다.

### 지원 대상 (v0.1)

| Provider | 설명 | 비고 |
|----------|------|------|
| **OpenAI (ChatGPT)** | OpenAI API | `OPENAI_API_KEY` 등 |
| **Google (Gemini)** | Gemini API | `GEMINI_API_KEY` 등 |
| **Ollama** | 로컬 Ollama 서버 | API 키 불필요, 로컬 실행 |

이후 **Claude, 기타 API** 등이 추가될 수 있도록 설계한다.

### Provider 추상화

새 LLM을 붙일 때 **구조를 갈아엎지 않고** 구현체만 추가할 수 있도록 인터페이스를 둔다.

```ts
interface LLMProvider {
  /** 사용자 메시지 + 주입된 기억으로 채팅 응답 생성 */
  chat(message: string, context: { injectionText: string }): Promise<string>;
  /** 검색 결과 등 내용 요약 (action_search 경로) */
  summarize(content: string): Promise<string>;
}
```

- 설정(환경 변수 또는 config)으로 **사용할 provider** 선택 (예: `AGENT_LLM_PROVIDER=openai | gemini | ollama`).
- API 키는 provider별 환경 변수 (`OPENAI_API_KEY`, `GEMINI_API_KEY` 등). Ollama는 base URL만 필요 시 지정.

### 구현 위치

- `services/agent/src/clients/llmClient.ts` — 선택된 provider 인스턴스를 사용해 `chat` / `summarize` 호출.
- provider별 어댑터(예: `openaiAdapter.ts`, `geminiAdapter.ts`, `ollamaAdapter.ts`)는 동일 인터페이스를 구현하고, 설정에 따라 하나만 주입.

### 비목표 (v0.1)

- Memento Core와 Agent가 **같은 LLM 설정을 공유할 의무는 없음**. Core는 recall/embedding 등 자체 용도, Agent는 채팅/요약 전용으로 각자 설정 가능.

---

# 6. Tool Registry

## Base Tool Interface

```ts
interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;  // JSON Schema 호환
  execute(input: unknown): Promise<ToolResult>;
}
```

## Registry Design

```ts
const registry = new ToolRegistry([
  new SearchTool(),  // search_web_with_memory
]);
```

MVP: **Tool 1개만 등록.** 두 번째 툴 추가 시 구조 변경 없이 등록만으로 확장.

---

# 7. Data Contracts

## Agent → Client Response

```ts
interface AgentResponse {
  answer: string;
  meta: {
    intent: "chat" | "action_search";
    usedMemories: MemoryPreview[];
    executedTools?: ToolExecution[];
  };
}
```

## Memory Preview

```ts
interface MemoryPreview {
  id: string;
  preview: string;
  score: number;
  why: {
    matchedTerms: string[];
    type: string;
  };
}
```

## POST /chat Request

```ts
interface ChatRequest {
  message: string;
  /** 기억 소유자 구분. Memento recall/remember 시 owner_id로 전달. 같은 owner면 세션 바뀌어도 이전 대화 기억 검색 가능. */
  ownerId: string;
  /** 대화 단위(선택). 바뀌면 새 대화로 취급. 미전달 시 단일 대화로 간주하거나 서버 기본값. */
  sessionId?: string;
}
```

---

# 8. API Design (Agent)

## POST /chat

### Request

```json
{
  "message": "요즘 AI 에이전트 뭐 써?",
  "ownerId": "user_abc",
  "sessionId": "s_1"
}
```

- **ownerId**: 필수. 클라이언트가 사용자(또는 테넌트)를 구분하는 ID. Memento의 `owner_id`로 전달되어 해당 소유자 기억만 검색·저장.
- **sessionId**: 선택. 대화 단위 식별. 없으면 서버가 생성하거나 단일 스레드로 처리.

### Response

```json
{
  "answer": "...",
  "meta": {
    "intent": "action_search",
    "usedMemories": [
      {
        "id": "mem_xxx",
        "preview": "...",
        "score": 0.85,
        "why": { "matchedTerms": ["AI", "에이전트"], "type": "episodic" }
      }
    ],
    "executedTools": [
      { "name": "search_web_with_memory", "summary": "..." }
    ]
  }
}
```

---

# 9. Actionable Loop (Pseudo Code)

```ts
async function actionableLoop(req: ChatRequest): Promise<AgentResponse> {
  const intent = detectIntent(req.message);  // rule-based

  const memories = await mementoClient.inject(req.message, { ownerId: req.ownerId });

  if (intent === "action_search") {
    const context = extractKeywords(memories);
    const toolResult = await searchTool.execute({
      query: req.message,
      context,
    });
    const answer = await llmClient.summarize(toolResult);
    await mementoClient.remember(buildSummary(answer), { ownerId: req.ownerId, sessionId: req.sessionId });
    return buildResponse(answer, memories, [toolResult]);
  }

  const answer = await llmClient.chat(req.message, memories);
  await mementoClient.remember(buildSummary(answer), { ownerId: req.ownerId, sessionId: req.sessionId });
  return buildResponse(answer, memories);
}
```

---

# 10. Non-Functional Requirements

## Performance

- **p95 응답 시간** < 5초 (단일 /chat 요청 기준).

## Observability

필수 로그 항목:

- `intent`
- `recall_latency` (memory injection 소요 시간)
- `tool_execution_time`
- `memory_count` (주입된 기억 개수)

## Reliability

- **Tool 실패 시**: chat fallback. 검색 API 장애 시에도 답변은 LLM만으로 생성 가능하도록 한다.

---

# 11. Success Metrics

## 사용자 기준

- 같은 질문 반복 시 개인화된 답이 나온다.
- 검색 결과가 기억으로 누적되어 다음 대화에서 활용된다.
- "왜 이 답인지" (usedMemories, why) 이해 가능하다.

## 개발자 기준

- Tool 2개 추가 시 구조 변경 없이 "등록"만으로 추가 가능하다.
- Core API 변경 없이 agent만 업데이트 가능하다 (계약 유지).
- `docker compose up` 한 번으로 로컬 end-to-end 실행 가능하다.

---

# 12. Implementation Plan

## Phase 1 — Skeleton

- `services/agent/` 폴더 생성
- **CLI 진입점** 준비 (예: `chat` 명령 또는 `npx memento-agent chat`). v0.1 사용자 UI는 CLI.
- **설치·의존성**: Agent README에 "Memento 선행 설치·기동" 및 `MEMENTO_BASE_URL` 설정 방법 명시. (선택) `agent doctor` 등으로 Memento 연결 확인.
- `docker-compose.yml`에 core + agent 연결 (Memento 기동 후 Agent가 해당 URL로 호출하도록).
- `mementoClient` 작성 (HTTP/MCP만 사용, core import 금지)

## Phase 2 — Core Loop

- inject + chat loop 구현
- Intent rule-based 분기 (chat만 먼저 동작해도 됨)
- **LLM Provider**: `LLMProvider` 인터페이스 및 llmClient 구현, v0.1에서 OpenAI/Gemini/Ollama 중 1개 이상 연동
- LLM 호출(chat / summarize), remember 호출
- `/chat` 엔드포인트 및 `AgentResponse` 반환

## Phase 3 — Killer Tool

- `SearchProvider` 인터페이스 및 Tavily 연동 (또는 선택한 1개 provider)
- `search_web_with_memory` 툴 구현
- Tool Registry에 등록
- Action 경로에서 툴 실행 후 응답에 반영

## Phase 4 — Transparency

- `meta.usedMemories`, `meta.executedTools`, `meta.intent` 구조화
- 로깅 정책 적용 (intent, recall_latency, tool_execution_time, memory_count)
- (선택) Memory Inspector 최소 버전 — **CLI** (meta 출력, 기억 목록 조회 등)

---

# 13. Open Questions

- **검색 소스**: (1) API 계열(Tavily, SerpAPI, Brave 등) vs (2) Playwright + Google(또는 DDG) 무료 방식 — MVP 기본값 및 ToS·비용·유지보수 트레이드오프 결정.
- **Agent 기본 LLM**: v0.1 기본 provider로 OpenAI vs Gemini vs Ollama 중 어떤 것을 권장할지 (비용·지연·로컬 실행 등).
- **Session memory scope**: `ownerId`는 필수로 두고 클라이언트에서 전달. Memento Core의 `owner_id`와 1:1 매핑. `sessionId`는 대화 단위(선택). 구현 시 Memento recall/remember 호출 시 `owner_id` 파라미터 전달 방식 확정.
- **Inspector**: v0.1에서는 CLI로 결정. 웹 Inspector는 이후 확장.
- **Core API 매핑**: Memento 실제 HTTP/MCP 엔드포인트와 FR-3/FR-4 계약 필드 매핑 확정.

---

# 14. Future Extensions (v0.1 이후)

- **추가 LLM provider**: Claude, 기타 API 등 — `LLMProvider` 구현체 추가로 확장.
- GitHub Tool (이슈/PR 초안)
- Local File / Notes Search Tool
- Memory Graph UI
- MCP Tool Bridge
- Multi-agent runtime
- 멀티 채널 (WebChat, Telegram 등)

---

# 15. References

- **Memento 본체 구조**: `AGENTS.md` (프로젝트 구조 및 모듈 구성, 진입점 설명)
- Memento API 레퍼런스: `docs/api/en/api-reference.md`
- Memento 문서 인덱스: `docs/README.md`
- 합의된 MVP 정리: Actionable Memory Assistant v0.1 (Loop + One Killer Tool + Transparency)
- 운영 규칙: Agent는 core import 금지, HTTP/MCP로만 호출, docker compose 기본, core API 버전 명시

---

# 16. Next Steps (권장 순서)

1. **Memento 설치·기동 확인**: 루트에서 `npm run dev:http` 또는 docker로 Core가 떠 있는지 확인.
2. **Core API 매핑**: Memento 실제 HTTP/MCP 엔드포인트를 FR-3/FR-4 계약과 맞추기.
3. **Agent Skeleton 생성**: TypeScript 코드 스켈레톤, `mementoClient`(환경 변수 `MEMENTO_BASE_URL` 사용), `ToolRegistry` 최소 구현.
4. **docker-compose 실행**: Core + Agent 동시 기동으로 로컬 end-to-end 테스트 가능한 최소 버전까지 구현.

이후 "코드 생성" 요청 시 다음을 단계별로 생성할 수 있다:

- TypeScript 코드 스켈레톤
- `mementoClient` 실제 구현 (Memento API 호출)
- `ToolRegistry` 및 `SearchTool` 구현
- 실행 가능한 최소 `/chat` 버전
