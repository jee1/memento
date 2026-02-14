# Memento Agent MVP v0.1 — Team Feature 계획서

**PRD**: [0025-prd-actionable-memory-assistant-mvp-v01.md](0025-prd-actionable-memory-assistant-mvp-v01.md)  
**마스터 이슈**: [issue-0025-memento-agent-mvp-v01.md](issue-0025-memento-agent-mvp-v01.md)

---

## 1. Plan-First 요약

- **목표**: 기억 기반 행동 AI 비서(Memory → Action → Remember), One-Action Rule(`search_web_with_memory`).
- **구조**: 모노레포, Core=루트 `src/`, Agent=`services/agent/`(신규). Core import 금지, HTTP/MCP만.
- **산출물**: CLI 진입점, POST /chat, meta(usedMemories, executedTools, intent), Tool Registry, 검색 툴 1종.

---

## 2. 작업 패키지 및 파일 소유권

| 패키지 | 담당 레이어 | 주요 파일/디렉터리 | 의존 |
|--------|-------------|---------------------|------|
| **P1 Skeleton** | 인프라 | `services/agent/` 루트, `package.json`, `tsconfig.json`, `Dockerfile`, `README.md`; 루트 `docker-compose.yml` 수정 | - |
| **P2 Memento Client** | 클라이언트 | `services/agent/src/clients/mementoClient.ts`, `schemas/contracts.ts`, `config.ts` | P1 |
| **P3 CLI + HTTP Server** | 진입점 | `services/agent/src/server.ts`, `bin/` 또는 CLI 진입 스크립트, POST /chat 스켈레톤 | P1 |
| **P4 Core Loop** | 루프/의도/LLM | `loop/actionableLoop.ts`, `intent/ruleIntent.ts`, `clients/llmClient.ts` + provider 어댑터(openai/gemini/ollama) | P2, P3 |
| **P5 Tool + Registry** | 도구 | `tools/baseTool.ts`, `tools/registry.ts`, `tools/searchTool.ts`, `clients/searchClient.ts` (SearchProvider) | P4 |
| **P6 Transparency** | 메타/로깅 | 응답 빌더(meta 구조), 로깅 정책(intent, recall_latency, tool_execution_time, memory_count), (선택) CLI Memory Inspector | P4, P5 |

---

## 3. 단계별 실행 순서 (순차/병렬)

```
P1 (Skeleton) ──┬──► P2 (Memento Client) ──┐
                └──► P3 (CLI + Server) ───┼──► P4 (Core Loop) ──► P5 (Tool + Registry) ──► P6 (Transparency)
```

- **병렬 가능**: P2와 P3는 P1 완료 후 동시 진행 가능.
- **순차 필수**: P4 → P5 → P6.

---

## 4. 패키지별 상세 체크리스트

### P1 — Skeleton

- [x] `services/agent/` 디렉터리 생성
- [x] `services/agent/package.json` (TypeScript, Node ≥20, 스크립트: build, dev, start, chat)
- [x] `services/agent/tsconfig.json` (루트와 격리, ES 모듈)
- [x] `services/agent/Dockerfile` (Agent 전용 이미지)
- [x] 루트 `docker-compose.yml`에 Agent 서비스 추가 (Core 선행 기동, `MEMENTO_BASE_URL` 연결)
- [x] `services/agent/README.md`: 선행 조건(Memento 설치·기동), `MEMENTO_BASE_URL` 설정, (선택) `agent doctor` 안내

### P2 — Memento Client

- [x] `schemas/contracts.ts`: AgentResponse, MemoryPreview, ChatRequest, Memento 계약 타입
- [x] `config.ts`: `MEMENTO_BASE_URL` 등 환경 변수 로드
- [x] `clients/mementoClient.ts`:
  - [x] `inject(query, { ownerId })` → memories, injectionText, score, why (FR-3) — Core `/tools/recall` 호출
  - [x] `remember(payload, { ownerId, sessionId })` (FR-4) — Core `/tools/remember` 호출
  - [x] Core 연동: HTTP `/tools/recall`, `/tools/remember` 사용 (owner_id 본문 전달)
- **확정**: Core 기존 `/tools/:name` 라우트에 body로 `owner_id` 전달.

### P3 — CLI + HTTP Server

- [x] `server.ts`: Express, POST /chat 라우트, actionableLoop 연동
- [x] CLI: `npx memento-agent chat` 또는 `npm run chat`으로 대화 진입 (로컬 루프, 서버 불필요)
- [x] POST /chat: ChatRequest 수신, runActionableLoop 호출 후 AgentResponse 반환

### P4 — Core Loop

- [x] `intent/ruleIntent.ts`: 규칙 기반 intent ("/search", "검색해줘", "찾아줘", "요즘 뭐가 핫해" → `action_search`, 그 외 → `chat`)
- [x] `clients/llmClient.ts`: `LLMProvider` 인터페이스, `chat(message, { injectionText })`, `summarize(content)`
- [x] Provider 어댑터: OpenAI / Gemini / Ollama, 설정(`AGENT_LLM_PROVIDER`)으로 선택
- [x] `loop/actionableLoop.ts`: User Input → Intent → Memory Injection → LLM / Tool → Remember → Response (FR-1, §9)
- [x] POST /chat에서 actionableLoop 호출, AgentResponse 반환

### P5 — Tool + Registry

- [x] `tools/baseTool.ts`: `Tool` 인터페이스 (name, description, inputSchema, execute)
- [x] `tools/registry.ts`: `ToolRegistry`, 등록/조회
- [x] `SearchProvider` 인터페이스: `search(query, context?)` → SearchResult
- [x] `tools/searchTool.ts`: `search_web_with_memory`, context 키워드 활용, 결과 요약
- [x] Search 구현체: StubSearchProvider (실제 API 연동은 추후 AGENT_SEARCH_PROVIDER로 교체 가능)
- [x] Action 경로에서 툴 실행 후 응답에 반영

### P6 — Transparency

- [x] `AgentResponse.meta`: intent, usedMemories, executedTools 구조화 (FR-6)
- [x] 로깅: intent, recall_latency, tool_execution_time, memory_count (LOG_LEVEL=debug 시)
- [x] CLI에서 meta 출력: 기억 사용 건수, 실행 도구명 (chat 시)

---

## 5. Core API 매핑 (의존 사항)

- **memory_injection**: Memento는 현재 MCP 도구로만 노출. Agent는 (a) MCP 클라이언트로 호출하거나 (b) Core에 HTTP 퍼사드(예: POST /api/v1/memory/inject) 추가 후 호출. `owner_id` 전달 방식은 Memento 스키마와 맞춰 확정 필요.
- **remember**: 동일. MCP `remember` 또는 HTTP POST /api/v1/memory/remember 및 owner_id/sessionId 매핑 확정.

---

## 6. 승인 후 구현 순서 (권장)

1. **P1** 완료 → 저장소에 `services/agent/` 스켈레톤 반영.
2. **P2 + P3** 병렬 또는 순차 완료 → mementoClient 연동 가능, POST /chat 스켈레톤 동작.
3. **P4** 완료 → inject + chat + remember 루프, intent, LLM 연동.
4. **P5** 완료 → search_web_with_memory 툴, Registry 등록.
5. **P6** 완료 → meta, 로깅, (선택) CLI Inspector.

---

## 7. 성공 기준 (PRD §11)

- 사용자: 같은 질문 반복 시 개인화된 답, 검색 결과가 기억으로 누적, usedMemories/why로 설명 가능.
- 개발자: 툴 2개 추가 시 "등록"만으로 확장, Core API 변경 없이 agent만 업데이트 가능, `docker compose up` 한 번에 E2E 실행 가능.

---

**Plan-first 승인** 후 위 순서대로 구현을 진행하면 됩니다. 변경이 필요하면 이 문서를 수정한 뒤 이슈에 반영하세요.
