# Memento Agent — Design Spec

**Date:** 2026-04-25  
**Issue:** #100  
**Status:** Draft v2

---

## 1. 목적

Memento(AI 기억 시스템)를 활용하여 사용자의 질문에 **기억 + 웹 검색**을 결합해 개인화된 답변을 제공하는 Agent.

핵심 장면: `memento-agent ask "이 코드 어디서 봤지?"` → 과거 기억과 웹 검색을 합쳐 LLM이 답변

---

## 2. 범위

**v0.1 = Phase 1 (CLI) + Phase 2 (MCP + HTTP) 완료 시점**

**포함:**
- `packages/memento-agent` 신규 패키지
- `AgentCore`: recall → search → LLM complete → remember 루프
- `LLMProvider` 추상화 (Claude / OpenAI / Ollama)
- `SearchProvider` 추상화 (Brave / Tavily / Playwright / Noop)
- Phase 1: CLI 인터페이스 (`memento-agent ask "<query>"`)
- Phase 2: 독립 MCP 서버 (`memento-agent serve-mcp`), HTTP endpoint (`POST /api/agent/ask`)

**제외 (v0.1 이후):**
- 멀티턴 대화 (chat 모드)
- Proactive 알림
- 웹 대시보드 UI

---

## 3. 아키텍처

### 패키지 구조

```
packages/memento-agent/
  src/
    core/
      agent-core.ts          # AgentCore 클래스 (순수 로직)
      types.ts               # AskResult, Message 등 공유 타입
    providers/
      llm/
        llm-provider.ts      # interface LLMProvider
        claude-provider.ts
        openai-provider.ts
        ollama-provider.ts
        llm-factory.ts       # env 기반 인스턴스 생성
      search/
        search-provider.ts   # interface SearchProvider
        brave-provider.ts
        tavily-provider.ts
        playwright-provider.ts  # optionalDependencies
        noop-provider.ts
        search-factory.ts
    interfaces/
      cli/
        index.ts             # CLI 진입점
      mcp/
        ask-tool.ts          # MCP tool 정의 (tool name: agent_ask)
        server.ts            # 독립 MCP 서버 (memento-agent serve-mcp)
      http/
        ask-handler.ts       # Express 5 handler
        router.ts
    prompts/
      agent-system.md        # system prompt 템플릿
  package.json
  tsconfig.json
```

### 의존 방향

```
memento-agent
  → @memento/client   (HTTP API 호출만, memento-core import 금지)
  → @anthropic-ai/sdk (ClaudeProvider)
  → openai            (OpenAIProvider)
  → playwright        (PlaywrightProvider, optionalDependencies)
```

### MCP 서버 분리 결정

`memento-agent`는 **독립 MCP 서버**(`memento-agent serve-mcp`)로 실행한다.

- `memento-server`가 `memento-agent`를 의존하면 단방향 의존 규칙 위반
- `memento-agent serve-mcp`는 MCP 클라이언트(Claude Desktop 등)에 별도 서버로 등록
- Playwright 미설치 시 search-factory.ts는 `"playwright not installed. Run: npm install playwright"` 오류 출력 후 종료

---

## 4. 핵심 흐름

```
사용자 입력 (query)
    ↓
AgentCore.ask(query)
    ├─ MementoClient.recall(query, { limit: RECALL_LIMIT })  → MemorySearchResult[]
    ├─ SearchProvider.search(query)                          → SearchResult[] (실패 시 [] 반환)
    ↓
컨텍스트 조합 (tokenBudget 적용)
    기억 결과 + 웹 결과 + system prompt (prompts/agent-system.md 기반)
    ↓
LLMProvider.complete(messages, { timeoutMs: LLM_TIMEOUT_MS })  → answer: string
    ↓
MementoClient.remember(answer, { type: 'episodic' })           → 답변을 기억에 저장
    ↓
AskResult { answer, usedMemories: MemorySearchResult[], searchResults: SearchResult[] }
```

**Memory type 정책:**
- LLM의 최종 답변 → `episodic` (무슨 질문에 뭐라 답했는지)
- 웹 검색 결과에서 파생된 사실 → `semantic` (추후 Phase 3에서 구현)
- Phase 1/2에서는 답변만 `episodic`으로 저장

---

## 5. System Prompt 템플릿

`src/prompts/agent-system.md`:

```
당신은 Memento 기억 시스템과 연결된 개인 AI 어시스턴트입니다.

사용자의 질문에 답할 때:
1. 제공된 과거 기억(memories)을 먼저 참고하세요
2. 웹 검색 결과(search results)가 있으면 기억과 결합하세요
3. 불확실한 내용은 추측하지 말고 모른다고 답하세요
4. 어떤 기억/검색 결과를 근거로 답했는지 간략히 밝히세요

[MEMORIES]
{{memories}}

[SEARCH_RESULTS]
{{searchResults}}
```
(결과가 없으면 해당 섹션 전체를 프롬프트에서 제외)

---

## 6. 인터페이스 명세

### CLI
```bash
memento-agent ask "query"
  --no-search          # 웹 검색 비활성화
  --json               # AskResult 전체를 JSON으로 출력 (HTTP response와 동일 스키마)
  --base-url <url>     # Memento 서버 URL (기본: MEMENTO_BASE_URL)

memento-agent serve-mcp   # 독립 MCP 서버 실행 (stdio)
```

### MCP Tool
```json
{
  "name": "agent_ask",
  "description": "기억과 웹 검색을 결합해 질문에 답합니다",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "useSearch": { "type": "boolean", "default": true }
    },
    "required": ["query"]
  }
}
```

### HTTP (Express 5, 기존 memento-server와 동일 프레임워크)
```
POST /api/agent/ask
Headers: (인증 없음, v0.1은 로컬 전용)
Body: { "query": string, "useSearch"?: boolean }
Response 200: { "answer": string, "usedMemories": MemorySearchResult[], "searchResults": SearchResult[] }
Response 503: { "error": "Memento server unavailable" }
Response 500: { "error": "LLM provider error: <message>" }
```

---

## 7. 환경 변수

| 변수 | 설명 | 기본값 |
|---|---|---|
| `MEMENTO_BASE_URL` | Memento HTTP 서버 URL | `http://localhost:3000` |
| `MEMENTO_AGENT_LLM` | LLM 프로바이더 (`claude`/`openai`/`ollama`) | `claude` |
| `ANTHROPIC_API_KEY` | Claude API 키 | — |
| `OPENAI_API_KEY` | OpenAI API 키 | — |
| `MEMENTO_AGENT_SEARCH` | 검색 프로바이더 (`brave`/`tavily`/`playwright`/`none`) | `none` |
| `BRAVE_API_KEY` | Brave Search API 키 | — |
| `TAVILY_API_KEY` | Tavily API 키 | — |
| `MEMENTO_AGENT_RECALL_LIMIT` | recall 결과 최대 개수 | `10` |
| `MEMENTO_AGENT_TOKEN_BUDGET` | LLM context 토큰 예산 | `4000` |
| `MEMENTO_AGENT_LLM_TIMEOUT_MS` | LLM API 타임아웃 | `30000` |
| `MEMENTO_AGENT_SEARCH_TIMEOUT_MS` | 검색 API 타임아웃 | `10000` |

---

## 8. 에러 처리

| 상황 | CLI | HTTP | MCP |
|---|---|---|---|
| Memento 연결 실패 | 오류 메시지 + exit 1 | 503 + JSON error | MCP error content |
| LLM API 실패 | 오류 메시지 + exit 1 | 500 + JSON error | MCP error content |
| SearchProvider 실패 | 경고 출력 + 계속 | 200 (searchResults: []) | isError: false, searchResults: [] |
| LLM 타임아웃 | 오류 메시지 + exit 1 | 504 + JSON error | MCP error content |

---

## 9. 테스트 전략

| 레이어 | 방법 |
|---|---|
| `AgentCore` | MementoClient + LLMProvider + SearchProvider mock |
| `LLMProvider` 구현체 | 응답 스텁, 실제 API 호출 없음 |
| CLI | `--json` 플래그 출력의 JSON 파싱 가능 여부 검증 |
| MCP tool | MCP SDK test harness |
| HTTP handler | supertest (Express 5) |
| E2E | `NoopSearchProvider` + 로컬 Memento 인스턴스 |

---

## 10. 구현 단계

- **Phase 1 (v0.1 Part 1)**: 패키지 스캐폴딩, `AgentCore`, `LLMProvider` (Claude), `SearchProvider` (Noop + Brave), CLI
- **Phase 2 (v0.1 Part 2)**: 독립 MCP 서버, HTTP endpoint (Express 5)
- **Phase 3**: Tavily, Playwright SearchProvider 추가
- **Phase 4**: OpenAI, Ollama LLMProvider 추가, 웹 검색 결과 `semantic` 저장
