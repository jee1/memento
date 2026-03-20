# Memento CLI for AI 검토

AI가 Memento를 사용하기 쉽도록 CLI 형태로 제공하는 방안과, AI에게 제공해야 할 정보를 검토한 문서입니다.

---

## 1. 배경 및 목적

### 현재 상태

- Memento는 **MCP 서버**로 제공되며, Cursor 등에서 MCP 클라이언트가 도구(recall, remember, forget 등)를 호출한다.
- AI가 MCP 없이 **터미널만** 사용하는 환경(일부 CLI 에이전트, 스크립트, 다른 IDE)에서는 Memento를 직접 호출할 수 없다.

### 목적

- **CLI 형태**로 동일한 기능을 노출하여, AI가 `memento recall ...`, `memento remember ...`처럼 셸 명령으로 기억을 조회·저장할 수 있게 한다. 다른 프로젝트에서 설치 여부가 불명확할 때는 `npm exec --package memento-mcp-server -- memento ...`를 기본 예시로 쓴다.
- CLI를 사용하는 **AI에게 필요한 정보**(명령 목록, 스키마, 워크플로, 예제)를 정리하여, 도구 설명·시스템 프롬프트·문서에 활용할 수 있게 한다.

---

## 2. CLI 제공 방향

### 2.1 권장 형태: 서브커맨드형

| 방식 | 예시 | 장점 | 단점 |
|------|------|------|------|
| **서브커맨드** | `memento recall --query "..." --limit 5` | 셸에서 읽기 쉽고, AI가 명령 조합이 쉬움 | 인자 많은 도구는 옵션이 길어짐 |
| **JSON stdin** | `echo '{"tool":"recall","arguments":{...}}' \| memento run` | MCP와 1:1 대응, 복잡 인자에 유리 | 셸 이스케이프·가독성 낮음 |

**권장**: 기본은 **서브커맨드형**으로 제공하고, 필요 시 `memento run --json '...'` 형태로 JSON 한 번에 호출하는 방식을 보조로 둔다.

### 2.2 입출력 규칙 (AI 파싱 용이)

- **성공 시**: 결과만 **stdout**에 JSON으로 출력. 다른 메시지는 넣지 않는다.
- **실패 시**: 에러 메시지는 **stderr**, exit code **non-zero**.
- **로그**: 진행/디버그 로그는 stderr로만 출력하여 stdout이 항상 파싱 가능한 JSON이 되도록 한다.

이렇게 하면 AI는 `stdout`만 파싱하면 되고, exit code로 성공/실패를 판단할 수 있다.

### 2.3 구현 위치

- **진입점**: `packages/memento-server`에 CLI 진입 스크립트 추가 (예: `src/cli.ts`).
- **실행**: 기존 `getToolRegistry()`·`executeTool()`를 재사용하여, 서브커맨드 이름을 MCP 도구 이름에 매핑하고 `ToolContext`를 구성한 뒤 실행.
- **bin**: `package.json`의 `bin`에 `memento`(또는 `memento-cli`) 추가.

### 2.4 npx 실행 시: CLI vs stdio vs HTTP 구분

npx로 설치 없이 실행할 때 **어떤 모드(CLI / stdio MCP / HTTP 서버)**로 동작하는지는 다음으로 결정된다.

#### 현재 구조 (CLI 미구현 상태)

| 실행 방법 | 진입 파일 | 모드 | 비고 |
|-----------|-----------|------|------|
| `npx memento-mcp-server` / `npx memento-mcp` | `dist/server/index.js` | **stdio MCP** | 기본. Cursor 등 MCP 클라이언트가 stdio로 연결. |
| `npx memento-mcp-server` + `TRANSPORT_TYPE=sse` | `dist/server/index.js` | **HTTP/SSE** | 같은 index.js가 환경 변수에 따라 SSE 서버로 기동. |
| `npx memento-dev` | `dist/server/http-server.js` | **HTTP 서버** | Express + WebSocket 등. 별도 bin·별도 진입점. |

즉, **구분 방법**은 두 가지다.

1. **실행한 bin 이름**  
   - `memento-mcp-server`, `memento-mcp` → **index.js** (stdio 또는 TRANSPORT_TYPE에 따라 SSE).  
   - `memento-dev` → **http-server.js** (항상 HTTP).
2. **index.js를 쓸 때만**  
   - 환경 변수 **`TRANSPORT_TYPE`**: 미설정 또는 `stdio` → stdio MCP, `sse` → HTTP/SSE.

현재는 **CLI 모드가 없어** "한 번 실행하고 stdout만 받고 끝나는" 도구 형태는 없다. 그래서 npx로 "CLI처럼" 쓰려면 CLI 진입점(`memento` bin)을 추가해야 한다.

#### CLI 도입 후 제안: 단일 진입점 + 서브커맨드

모드를 **명령 하나로** 드러내려면, 하나의 bin `memento`에서 서브커맨드로 나누는 방식을 권장한다.

| 명령 | 동작 |
|------|------|
| `npx memento-mcp-server mcp` 또는 `npm exec --package memento-mcp-server -- memento mcp` | stdio MCP 서버 기동 (기존 index.js 로직). |
| `npm exec --package memento-mcp-server -- memento http` | HTTP 서버 기동 (기존 http-server 로직). |
| `npm exec --package memento-mcp-server -- memento recall ...` / `... remember ...` 등 | **CLI 모드** — 한 번 실행 후 stdout에 JSON 출력하고 종료. |

이렇게 하면 "지금이 CLI인지, stdio인지, HTTP인지"는 **실행한 서브커맨드**만 보면 알 수 있다.  
(기존처럼 bin을 여러 개 두는 방식도 유지할 수 있다: `memento-mcp-server` → stdio, `memento-dev` → http, `memento` → CLI.)

#### CLI + npx: 다운로드/캐시 이슈

**질문:** CLI를 `npm exec --package memento-mcp-server -- memento recall ...`처럼 매 명령마다 실행하면, 매번 패키지를 다운로드하나?

**동작:** npx는 tarball을 **npm 캐시에 저장**하므로 매 실행마다 전부 재다운로드하는 것은 아니다. 다만 매 실행마다 캐시 풀기·메타데이터 확인 등 **npx 오버헤드**가 있어, CLI를 반복 호출(예: AI가 recall/remember 다수 호출)할 때는 지연이 누적된다.

**권장:** CLI를 자주 쓸 때는 **글로벌 설치** (`npm install -g memento-mcp-server` 후 `memento recall ...`) 또는 **프로젝트 로컬 의존성**으로 두고 `npm exec -- memento recall ...`(로컬 node_modules 사용)을 권장한다. 설치 여부가 불명확한 문서 예시는 `npm exec --package memento-mcp-server -- memento ...`를 기본으로 둔다.

#### 문서·AI 안내 시

- README·설치 가이드에 **"npx로 실행 시 모드별 사용법"** 표를 두고,  
  - MCP(Cursor)용: `npx memento-mcp-server` 또는 `npm exec --package memento-mcp-server -- memento mcp`  
  - HTTP 서버용: `npx memento-dev` 또는 `npm exec --package memento-mcp-server -- memento http`  
  - CLI(도구 호출)용: `npm exec --package memento-mcp-server -- memento recall ...`  
  로 정리하면, 사용자·AI 모두 "어떤 명령이 어떤 모드인지" 한눈에 알 수 있다.

---

## 3. AI에게 제공해야 할 정보

CLI를 쓰는 AI가 "무엇을 쓸 수 있고, 어떻게 써야 하는지" 알 수 있도록 아래를 문서·스키마·도구 설명으로 제공하는 것이 좋다.

### 3.1 명령 목록 및 한 줄 설명

| 명령 | 설명 (AI용 한 줄) |
|------|-------------------|
| `recall` | 관련 기억을 하이브리드 검색으로 조회 |
| `remember` | 새 기억 저장 (episodic/semantic/procedural 등) |
| `forget` | 기억 삭제(소프트/하드) |
| `memory_injection` | 쿼리에 맞는 맥락을 요약해 token_budget 안에서 반환 |
| `pin` | 기억을 핀하여 보존 |
| `unpin` | 핀 해제 |
| `get_memory_neighbors` | 특정 기억의 이웃(유사 기억) 조회 |
| `set_anchor` | 앵커 슬롯에 기억 설정 |
| `get_anchor` | 현재 앵커 조회 |
| `search_local` | 앵커 주변 기억 검색 |
| `clear_anchor` | 앵커 해제 |
| `remember_procedure` | 절차형 기억 저장 |
| `procedural_diff` | 절차 버전 간 diff 조회 |
| `procedural_rollback` | 절차 버전 롤백 |

이 표는 "Memento CLI for AI" 문서 상단이나 `memento --help` 요약에 넣을 수 있다.

### 3.2 각 명령의 인자 스키마

- **출처**: MCP 도구 descriptor(JSON Schema)와 동일하게 유지하는 것이 좋다. CLI는 옵션을 JSON으로 조합해 `executeTool(name, params, context)`에 넘기면 된다.
- **제공 형태**: 문서(필수/선택 인자, 타입, 기본값), 기계용(`memento schema`).

### 3.3 워크플로 가이드 (언제 어떤 명령을 쓸지)

작업 전 recall/memory_injection, 작업 후 remember, 앵커 set_anchor/search_local/clear_anchor. (자세한 내용은 [mcp-server-instructions.md](../../../guides/ko/mcp-server-instructions.md) 참조.)

### 3.4 예제 호출 및 샘플 출력

문서에 예제 호출·샘플 JSON 출력·실패 시 stderr/exit code 예시를 포함.

---

## 4. 문서/아티팩트 제안

가이드 문서, memento --help, memento schema, AGENTS.md/.cursor 규칙.

---

## 5. 환경 설정(DB·기타) 제공 방식

우선순위: CLI 글로벌 옵션 > 환경변수 > .env(탐색: --env-file, MEMENTO_CONFIG_DIR, cwd, ~/.memento/.env). API 키는 환경변수/.env만. (상세: [원본 design](../../../design/memento-cli-for-ai-review.md) §5.)

---

## 6. 기존 설계와의 정합성

- **recall 컨텍스트 절약** ([recall-context-saving-ideas.md](../../../design/recall-context-saving-ideas.md)): **아직 미정.** 위 문서는 검토용 아이디어이며, 확정되면 CLI에서도 동일하게 적용 가능.
- **MCP serverUseInstructions** ([mcp-server-instructions.md](../../../guides/ko/mcp-server-instructions.md)): CLI용 "사용 지침"은 같은 내용을 작업 전/후, 앵커 관점으로 재구성.

---

## 7. 요약

| 항목 | 내용 |
|------|------|
| **CLI 형태** | 서브커맨드형, stdout=JSON, stderr=로그/에러, exit code로 성공/실패. |
| **환경 설정** | CLI 옵션 > 환경변수 > .env(~/.memento/.env). API 키는 환경변수/.env만. |
| **AI용 제공 정보** | 명령 목록, 스키마, 워크플로, 예제, 설정 방법. |
| **문서** | Memento CLI for AI 가이드, --help/schema, 설정 요약, 시스템 프롬프트 지침. |

**원본**: [docs/design/memento-cli-for-ai-review.md](../../../design/memento-cli-for-ai-review.md)
