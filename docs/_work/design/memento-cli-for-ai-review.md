# Memento CLI for AI 검토

AI가 Memento를 사용하기 쉽도록 CLI 형태로 제공하는 방안과, AI에게 제공해야 할 정보를 검토한 문서입니다.

---

## 1. 배경 및 목적

### 현재 상태

- Memento는 **MCP 서버**로 제공되며, Cursor 등에서 MCP 클라이언트가 도구(recall, remember, forget 등)를 호출한다.
- AI가 MCP 없이 **터미널만** 사용하는 환경(일부 CLI 에이전트, 스크립트, 다른 IDE)에서는 Memento를 직접 호출할 수 없다.

### 목적

- **CLI 형태**로 동일한 기능을 노출하여, AI가 `memento recall ...`, `memento remember ...`처럼 셸 명령으로 기억을 조회·저장할 수 있게 한다. 다른 프로젝트에서 설치 여부가 불명확할 때는 `npm exec --package memento-mcp-server -- memento ...` 형태를 기본 예시로 사용한다.
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

현재는 **CLI 모드가 없어** “한 번 실행하고 stdout만 받고 끝나는” 도구 형태는 없다. 그래서 npx로 “CLI처럼” 쓰려면 CLI 진입점(`memento` bin)을 추가해야 한다.

#### CLI 도입 후 제안: 단일 진입점 + 서브커맨드

모드를 **명령 하나로** 드러내려면, 하나의 bin `memento`에서 서브커맨드로 나누는 방식을 권장한다.

| 명령 | 동작 |
|------|------|
| `npx memento-mcp-server mcp` 또는 `npm exec --package memento-mcp-server -- memento mcp` | stdio MCP 서버 기동 (기존 index.js 로직). |
| `npm exec --package memento-mcp-server -- memento http` | HTTP 서버 기동 (기존 http-server 로직). |
| `npm exec --package memento-mcp-server -- memento recall ...` / `... remember ...` 등 | **CLI 모드** — 한 번 실행 후 stdout에 JSON 출력하고 종료. |

이렇게 하면 “지금이 CLI인지, stdio인지, HTTP인지”는 **실행한 서브커맨드**만 보면 알 수 있다.  
(기존처럼 bin을 여러 개 두는 방식도 유지할 수 있다: `memento-mcp-server` → stdio, `memento-dev` → http, `memento` → CLI.)

#### CLI + npx: 다운로드/캐시 이슈

**질문:** CLI를 `npm exec --package memento-mcp-server -- memento recall ...`처럼 매 명령마다 실행하면, 매번 패키지를 다운로드하나?

**동작:** npx는 tarball을 **npm 캐시에 저장**하므로 매 실행마다 전부 재다운로드하는 것은 아니다. 다만 매 실행마다 캐시 풀기·메타데이터 확인 등 **npx 오버헤드**가 있어, CLI를 반복 호출(예: AI가 recall/remember 다수 호출)할 때는 지연이 누적된다.

**권장:** CLI를 자주 쓸 때는 **글로벌 설치** (`npm install -g memento-mcp-server` 후 `memento recall ...`) 또는 **프로젝트 로컬 의존성**으로 두고 `npm exec -- memento recall ...`(로컬 node_modules 사용)을 권장한다. 설치 여부가 불명확한 문서 예시는 `npm exec --package memento-mcp-server -- memento ...`를 기본으로 둔다.

#### 문서·AI 안내 시

- README·설치 가이드에 **“npx로 실행 시 모드별 사용법”** 표를 두고,  
  - MCP(Cursor)용: `npx memento-mcp-server` 또는 `npm exec --package memento-mcp-server -- memento mcp`  
  - HTTP 서버용: `npx memento-dev` 또는 `npm exec --package memento-mcp-server -- memento http`  
  - CLI(도구 호출)용: `npm exec --package memento-mcp-server -- memento recall ...`  
  로 정리하면, 사용자·AI 모두 “어떤 명령이 어떤 모드인지” 한눈에 알 수 있다.

---

## 3. AI에게 제공해야 할 정보

CLI를 쓰는 AI가 “무엇을 쓸 수 있고, 어떻게 써야 하는지” 알 수 있도록 아래를 문서·스키마·도구 설명으로 제공하는 것이 좋다.

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

이 표는 “Memento CLI for AI” 문서 상단이나 `memento --help` 요약에 넣을 수 있다.

### 3.2 각 명령의 인자 스키마

- **출처**: MCP 도구 descriptor(JSON Schema)와 동일하게 유지하는 것이 좋다. CLI는 옵션을 JSON으로 조합해 `executeTool(name, params, context)`에 넘기면 된다.
- **제공 형태**:
  - **문서**: 마크다운/HTML로 “필수/선택 인자, 타입, 기본값, 설명” 정리.
  - **기계용**: `memento schema recall` 또는 `memento schema --json`으로 전체 스키마를 stdout에 출력하면, AI가 동적으로 인자 구성을 참고할 수 있다.

핵심 도구만 예시로 요약하면 다음과 같다.

- **recall**: `query`, `type`, `memory_types`, `tags`, `limit`, `return_format`, `vector_weight`, `text_weight`, `time_from`, `time_to`, `pinned`, `owner_id` 등 (자세한 것은 MCP descriptor 참고).
- **remember**: `content`, `type`(episodic/semantic/procedural 등), `tags`, `importance`, `privacy_scope` 등.
- **memory_injection**: `query`, `token_budget`, (선택) `memory_types`, `tags` 등.

### 3.3 워크플로 가이드 (언제 어떤 명령을 쓸지)

AI용 사용 지침은 기존 MCP serverUseInstructions와 맞춘다.

| 시점 | 권장 동작 |
|------|-----------|
| **작업 전** | 관련 기억이 필요하면 `recall`(하이브리드 검색) 또는 `memory_injection`(쿼리 기반 맥락). 앵커가 있으면 `search_local`로 앵커 주변 검색. |
| **작업 후** | 결과를 남기려면 `remember`: 완료 기록은 episodic(태그 예: completed), 재사용 지식은 semantic(예: best-practice, knowledge), 절차는 procedural(예: procedure). 중복을 줄이기 위해 저장 전 `recall`로 유사 기억 확인. |
| **앵커** | 특정 기억을 기준으로 작업할 때 `set_anchor`로 설정 후 `search_local` 사용. 작업이 끝나면 필요 시 `clear_anchor`. |
| **일반 조회** | 목록/탐색이 목적이면 `recall`, “이 작업에 필요한 맥락만 요약해서”가 목적이면 `memory_injection` 우선. |

이 내용은 “Memento CLI for AI” 문서의 “Usage / Workflow” 섹션과, AI 시스템 프롬프트에 넣을 짧은 지침으로 사용할 수 있다.

### 3.4 예제 호출 및 샘플 출력

문서에 다음을 포함하면 AI가 패턴을 학습하기 쉽다.

- **예제 호출**  
  - `npm exec --package memento-mcp-server -- memento recall --query "Memento CLI 설계" --limit 5`  
  - `npm exec --package memento-mcp-server -- memento remember --content "CLI 검토 완료" --type episodic --tags completed,cli`  
  - `memento memory_injection --query "recall 결과 형식" --token_budget 500`
- **샘플 출력**  
  - 성공 시 stdout에 나올 JSON 형태(예: recall이면 `{ "items": [...], "total_count": N }` 등)를 1~2개 예시로 제시.
  - 실패 시 stderr 메시지와 exit code 예시.

---

## 4. 문서/아티팩트 제안

| 아티팩트 | 용도 |
|----------|------|
| **docs/guides/ko/memento-cli-for-ai.md** (및 en) | AI·개발자용 CLI 명령 목록, 스키마 요약, 워크플로, 예제. |
| **memento --help** / **memento &lt;cmd&gt; --help** | 서브커맨드별 옵션 요약. |
| **memento schema [command]** | 선택한 명령 또는 전체 도구의 인자 스키마를 JSON으로 출력 (AI가 동적으로 참고). |
| **AGENTS.md 또는 .cursor 규칙** | “CLI 사용 시: 작업 전 recall/memory_injection, 작업 후 remember” 등 짧은 지침 유지. |

---

## 5. 환경 설정(DB·기타) 제공 방식

CLI는 매 호출마다 새 프로세스로 실행되므로, **설정 소스**와 **우선순위**를 명확히 해 두어야 한다. AI가 어떤 cwd에서 실행하든 동일한 DB·임베딩 설정을 쓰도록 할 수 있다.

### 5.1 현재 설정 로드 방식 (core 기준)

- **packages/memento-core** `shared/config/index.ts`: `dotenv`로 `.env`를 로드한 뒤, `environment.ts`의 `resolveString`/`resolveNumber` 등으로 `mementoConfig`를 채운다.
- **DB 경로**: `DB_PATH` 환경 변수 또는 `.env`의 `DB_PATH`. 기본값은 `environment.ts`의 `DB_PATH: './data/memory.db'`.
- **HTTP 서버**: `createMementoCore({ dbPath: process.env.DB_PATH ?? mementoConfig.dbPath })`로 런타임에 환경 변수를 우선한다.
- **기타**: 임베딩·LLM은 `OPENAI_API_KEY`, `GEMINI_API_KEY`, `EMBEDDING_PROVIDER`, `LLM_PROVIDER` 등 (env.example 참고).

### 5.2 CLI에서의 설정 우선순위 제안

| 순위 | 소스 | 설명 |
|------|------|------|
| 1 | **CLI 글로벌 옵션** | `--db-path`, `--env-file` 등. 호출 시마다 명시 가능. |
| 2 | **환경 변수** | `DB_PATH`, `OPENAI_API_KEY` 등. 셸에서 `export` 또는 에이전트가 주입. |
| 3 | **.env 파일** | `--env-file`로 지정한 경로, 또는 아래 탐색 순서로 찾은 첫 `.env`. |
| 4 | **기본값** | `environment.ts`의 `ENV_DEFAULTS` (예: `DB_PATH=./data/memory.db`). |

**.env 탐색 순서 제안** (CLI 전용):

1. `--env-file`로 지정한 파일 (있을 경우).
2. `MEMENTO_CONFIG_DIR`이 설정되어 있으면 `$MEMENTO_CONFIG_DIR/.env`.
3. `process.cwd()`의 `.env`.
4. **`~/.memento/.env`** — CLI 환경에서 사용자별 기본 설정 위치. 이 경로에 `.env`를 두면 cwd와 무관하게 동일한 DB·API 키가 적용된다.

CLI에서는 **`~/.memento/` 하위에 설정 파일을 확인**하도록 하면, 전역 설치(npx/글로벌) 후에도 사용자가 한 곳만 설정해 두면 된다. AI가 “프로젝트 루트에 .env를 두고 `MEMENTO_CONFIG_DIR`만 설정”하거나, “`~/.memento/.env`에 공통 설정”을 두는 식으로 일관되게 쓸 수 있다.

### 5.3 CLI 글로벌 옵션 제안

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--db-path <path>` | DB 파일 경로. `DB_PATH`보다 우선. | `memento --db-path ./data/my.db recall --query "..."` |
| `--env-file <path>` | 사용할 .env 파일 경로. | `memento --env-file /path/to/.env recall ...` |
| `--config-dir <dir>` | 설정 디렉터리 (해당 디렉터리의 `.env` 로드). `MEMENTO_CONFIG_DIR`과 동일 동작으로 구현 가능). | `memento --config-dir /project/root recall ...` |

- **API 키·비밀**: CLI 인자로 받지 않는다. **환경 변수** 또는 **.env**로만 제공하도록 문서화하여, 히스토리·로그에 남지 않게 한다.

### 5.4 AI에게 제공할 “설정 방법” 요약

CLI for AI 가이드 문서에 다음을 포함하면 좋다.

- **최소 설정**: DB만 쓰는 경우  
  - `export DB_PATH=./data/memory.db` 후 `npm exec --package memento-mcp-server -- memento recall ...`  
  - 또는 **`~/.memento/.env`**에 `DB_PATH=./data/memory.db` 두기 (CLI 기본 설정 위치).  
  - 또는 프로젝트 루트에 `.env`에 `DB_PATH=...` 두고, 해당 디렉터리에서 실행.
- **임베딩(OpenAI/Gemini) 사용 시**:  
  - `.env` 또는 환경 변수에 `OPENAI_API_KEY` 또는 `GEMINI_API_KEY`, `EMBEDDING_PROVIDER=openai`(또는 `gemini`) 설정.  
  - 참조: 루트 `env.example`.
- **여러 프로젝트/DB 구분**:  
  - `MEMENTO_CONFIG_DIR=/path/to/projectA npm exec --package memento-mcp-server -- memento recall ...`  
  - 또는 `npm exec --package memento-mcp-server -- memento --db-path /path/to/projectA/data/memory.db recall ...`.
- **설정 확인**: (구현 시) `memento config --show` 또는 `memento --version` 옆에 `memento config`로 현재 적용된 DB_PATH·EMBEDDING_PROVIDER 등만 읽기 전용으로 출력하면, AI가 “지금 어떤 DB를 쓰는지” 디버깅하기 쉽다.

### 5.5 구현 시 참고

- core의 `createMementoCore({ dbPath })`에 넘기는 `dbPath`는, CLI에서는 “우선순위 적용 후 한 번만 결정”하면 된다: `opts.dbPath ?? process.env.DB_PATH ?? mementoConfig.dbPath`.
- dotenv의 `config({ path: opts.envFile })` 또는 `config({ path: join(opts.configDir, '.env') })`를 CLI 진입 시점에 한 번 호출하면, 기존 `mementoConfig`가 그 값을 읽게 할 수 있다. (CLI 진입이 config 로드보다 먼저 실행되도록 진입점에서 dotenv 경로만 지정해 주면 됨.)
- **`~/.memento/`**: `os.homedir()` + `'.memento'`로 경로를 만들고, 해당 디렉터리의 `.env`가 있으면 위 탐색 순서 4번으로 로드한다. 디렉터리가 없으면 무시.

---

## 6. 기존 설계와의 정합성

- **recall 컨텍스트 절약** ([recall-context-saving-ideas.md](./recall-context-saving-ideas.md)): **아직 미정.** 위 문서는 검토용 아이디어이며, 확정되면 recall에 `max_tokens`/`token_budget` 도입, `list_only`+`get_memory`, `memory_injection` 우선 사용 등을 MCP와 동일하게 CLI에서도 적용할 수 있다.
- **MCP serverUseInstructions** ([docs/guides/ko/mcp-server-instructions.md](../../guides/ko/mcp-server-instructions.md)): CLI용 “사용 지침”은 같은 내용을 “작업 전/후, recall vs memory_injection, 앵커” 관점으로 재구성하면 된다.

---

## 7. 요약

| 항목 | 내용 |
|------|------|
| **CLI 형태** | 서브커맨드형 (`memento recall`, `memento remember` 등). 설치가 보장되지 않은 문서 예시는 `npm exec --package memento-mcp-server -- memento ...` 사용. stdout=JSON, stderr=로그/에러, exit code로 성공/실패. |
| **환경 설정** | 우선순위: CLI 글로벌 옵션 > 환경변수 > .env(탐색: --env-file, MEMENTO_CONFIG_DIR, cwd, **~/.memento/.env**). API 키는 환경변수/.env만 사용. |
| **AI용 제공 정보** | (1) 명령 목록·한 줄 설명, (2) 각 명령 인자 스키마(문서 + 선택적으로 `memento schema`), (3) 워크플로 가이드(작업 전/후, 앵커), (4) 예제 호출·샘플 출력, (5) **설정 방법**(DB_PATH, .env, MEMENTO_CONFIG_DIR, `memento config`). |
| **문서** | “Memento CLI for AI” 가이드 문서, `--help`/`memento schema`, **설정 방법 요약**, 시스템 프롬프트용 짧은 지침. |

다음 단계로는 `packages/memento-server`에 CLI 진입점을 추가하고, 위 표의 명령을 서브커맨드로 매핑한 뒤, `docs/guides/ko/memento-cli-for-ai.md` 초안을 작성하는 것을 제안한다.
