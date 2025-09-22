# Memento Goals

## 1. 목표 정리

**목표**: 에이전트가 대화/작업 맥락을 잃지 않도록, 사람의 기억 체계(작업기억·일화기억·의미기억·절차기억)를 모사한 스토리지+검색+요약+망각 메커니즘을 제공.

**비목표**: 초대규모 RAG 플랫폼, 범용 데이터레이크. 초기엔 개인/워크스페이스 단위의 장기 기억과 대화-세션 간 전이에 집중.

### 사람의 기억 모델에 대한 근거

- **일화(episodic)/의미(semantic) 분리**: Tulving 계보 – 일화는 사건, 의미는 지식. 두 체계는 상호의존적. [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2657600/) +1

- **작업기억(working memory)**: 중앙집행·음운고리·시공간 메모리 구성으로 "현재 처리 중인 정보"를 관리. [Simply Psychology](https://www.simplypsychology.org/working-memory.html) +1

- **망각/간격반복**: 에빙하우스 곡선과 "주기적 리마인드"가 장기 유지에 유리. [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2657600/) +1

### MCP 적용 근거

MCP는 Tools/Resources/Prompts를 표준으로 노출하고, 클라이언트(Claude, ChatGPT, Cursor 등)에서 쉽게 연결 가능. [WorkOS](https://workos.com/) +3, [Model Context Protocol](https://modelcontextprotocol.io/) +3

## 2. 시스템 개요(컴포넌트)

### Memory MCP Server

- **프로토콜**: MCP(spec 2025-03-26)
- **인터페이스**: tools(기억 쓰기·검색·고정·삭제 등), resources(읽기 전용 뷰), prompts(컨텍스트 주입 템플릿). [Model Context Protocol](https://modelcontextprotocol.io/) +1

### 스토리지

- **기본**: PostgreSQL + pgvector(벡터/메타/트랜잭션 같이 관리). [GitHub](https://github.com/pgvector/pgvector) +1
- **대안**: SQLite+FTS5(+lancedb)로 임베디드, 또는 Qdrant/Milvus로 분리

### 임베딩 & 요약

텍스트 임베딩 모델(문장 임베딩), "정보 압축 요약기(map-reduce)" 파이프라인.

### 스케줄러/워커

"수면 통합" 배치(야간 클러스터링·요약·규칙 추출), "망각/리뷰" 배치(재노출·삭제 후보 선정).

## 3. 데이터 모델(사람 기억에 대응)

### 핵심 테이블

#### memory_item
- `id`, `type`(working|episodic|semantic|procedural), `title`, `content`, `source`(chat|tool|file|url), `agent_id`, `user_id`, `project_id`
- `created_at`, `last_accessed_at`, `importance`(0~1), `pinned`(bool), `privacy_scope`(private|team|public), `origin_trace`(json)

#### memory_embedding
- `memory_id` FK, `embedding` vector, `dim`

#### memory_tag (N:N)
- 태그(예: tech:mariadb, pref:coffee, task:ads-settlement)

#### memory_link
- 기억 간 관계(cause_of, derived_from, duplicates, contradicts) – 의미적 연결망

#### feedback_event
- `memory_id`, `event`(used|edited|neglected|helpful|not_helpful), `score`, `ts`

### 작업기억(working) 버퍼

#### wm_buffer
- `session_id`, `items`(json), `token_budget`, `expires_at`

세션 종료/토큰 한도 초과 시 **일화(episodic)**으로 스냅샷 전환.

## 4. 검색·랭킹·망각(수식 포함)

### 4.1 검색 스코어

최종 점수 S:

```
S = α * relevance + β * recency + γ * importance + δ * usage - ε * duplication_penalty
```

- **relevance**: 코사인 유사도(임베딩) + keyword TF-IDF 보정
- **recency**: `exp(-λ * age_days)` (에빙하우스 계열 망각 함수를 응용; λ는 도메인별 튜닝) [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2657600/) +1
- **importance**: 명시/추론("사용자 선호·규칙·장기목표"는 가중치↑)
- **usage**: 조회·인용·재사용 빈도 로그 스케일
- **duplication_penalty**: 군집 내 유사 항목 중복 감점

### 4.2 망각·간격반복

- **소프트 삭제 후보 큐**: S가 낮고 `last_accessed_at` 오래된 항목 중 비핀(pinned)·비정책 항목
- **리텐션 정책**: 태그/스코프별 TTL(예: wm: 48시간, episodic: 90일, semantic: 무기한)
- **간격반복**: 중요도 상위 항목은 리뷰 이벤트(카드 형태 리마인드)를 생성해 재노출

### 4.3 의미 통합("수면 통합")

최근 episodic을 군집화→ 충돌/일관성 검사→ 규칙·사실 형태의 semantic 생성

CLS 가설(해마-네오코텍스 보완 학습)을 모티프로 "빠른 일화→느린 의미 통합"을 구현. [PubMed](https://pubmed.ncbi.nlm.nih.gov/) +1

## 5. MCP 인터페이스 설계(도구/리소스/프롬프트)

### 5.1 tools (요약된 시그니처)

#### remember
- **입력**: `content`, `type?`, `tags?`, `importance?`, `source?`, `privacy_scope?`
- **출력**: `memory_id`

#### recall
- **입력**: `query`, `filters?`(type/tags/time/project/agent), `limit?`
- **출력**: `items[]`(snippet, score, recall_reason)

#### pin / unpin

#### forget
- 하드/소프트 삭제 옵션, GDPR식 "지우기 권리" 지원

#### summarize_thread
- 현재 세션 로그→ wm_buffer 요약→ episodic 저장

#### link
- 기억 간 관계 생성(원인·파생·중복·모순)

#### export
- NDJSON/Markdown/CSV 내보내기

#### feedback
- 사용성/정확성 피드백 수집(helpful, not_helpful, 정답 첨부)

**MCP 스펙 근거**: 툴/리소스/프롬프트를 표준화해 클라이언트가 자동 발견·호출·구성. [Model Context Protocol](https://modelcontextprotocol.io/) +1

### 5.2 resources

- `memory/{id}`: 읽기 전용 단일 뷰
- `memory/search?query=...`: 최근 검색 결과 캐시 리소스(클라이언트 사이드 프리뷰에 유용)

### 5.3 prompts

#### memory_injection
- **설명**: "이번 턴 답변 전에 '상위 5개 관련 기억 요약'을 컨텍스트로 주입"
- **파라미터**: `query`, `token_budget`

MCP Prompts 기능으로 에이전트가 쉽게 가져다 씀. [Model Context Protocol](https://modelcontextprotocol.io/)

## 6. 에이전트 실행 플로우

1. **WM 적재**: 현재 사용자 메시지 + 직전 n턴 요약을 `wm_buffer`에 정리
2. **질의 구성**: `query = user_msg + task + wm_summary`
3. **recall 호출**:
   - 필터: `project_id`, `tags`, `type in {semantic, episodic}`
   - 1차 ANN(벡터) → 2차 rerank(BM25/keyword + rule match)
   - 중복 제거 & 압축: map-reduce 요약, 충돌은 `link(contradicts)`로 기록
4. **프롬프트 주입**: `prompts.memory_injection`으로 상위 K개를 투입
5. **답변 생성 후**:
   - `remember`로 새로운 사실/선호/결정 기록
   - `feedback(helpful)` 신호 반영
6. **배치 작업(야간)**: 군집화·요약 통합·망각/리마인드 스케줄링

## 7. 최소기능(MVP) 스펙

- 기억 쓰기/읽기/검색/핀/삭제 툴
- 일화/의미 두 타입만 우선 지원(작업기억은 세션 캐시로)
- **스코어**: `S = 0.5*relevance + 0.2*recency + 0.2*importance + 0.1*usage`
- **리텐션**: episodic 90d, semantic 무기한, wm 48h
- **저장소**: Postgres+pgvector, ivfflat 인덱스, cosine 거리. [GitHub](https://github.com/pgvector/pgvector) +1
- MCP `prompts.memory_injection` 1종

## 8. 예시: TypeScript MCP 서버 스켈레톤

```typescript
// package: mcp-memory-server
import { Server } from "@modelcontextprotocol/sdk/server";
import { z } from "zod";
import { recall, remember, pin, unpin, forget, summarizeThread, link, exportMem, feedback } from "./tools";

const server = new Server({ name: "mcp-memory", version: "0.1.0" });

// Tools
server.tool("remember", {
  schema: z.object({
    content: z.string(),
    type: z.enum(["episodic","semantic"]).default("episodic"),
    tags: z.array(z.string()).optional(),
    importance: z.number().min(0).max(1).default(0.5),
    source: z.string().optional(),
    privacy_scope: z.enum(["private","team","public"]).default("private")
  }),
  handler: remember
});

server.tool("recall", {
  schema: z.object({
    query: z.string(),
    filters: z.object({
      type: z.array(z.enum(["episodic","semantic"])).optional(),
      tags: z.array(z.string()).optional(),
      project_id: z.string().optional(),
      time_from: z.string().optional(),
      time_to: z.string().optional()
    }).optional(),
    limit: z.number().default(8)
  }),
  handler: recall
});

// ... pin/unpin/forget/summarizeThread/link/export/feedback 등록 ...

// Resources
server.resource("memory/{id}", async (params) => {/* read-only view */});

// Prompts
server.prompt("memory_injection", {
  params: [{ name: "query", required: true }, { name: "token_budget", required: false }],
  getPrompt: async ({ query, token_budget = 1200 }) => {
    const items = await recall({ query, limit: 6 });
    const summary = await compress(items, token_budget);
    return [{ role: "system", content: `관련 장기기억 요약:\n${summary}` }];
  }
});

server.start();
```
