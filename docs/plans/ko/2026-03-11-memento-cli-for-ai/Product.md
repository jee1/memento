# Memento CLI for AI — Product (Memory Bank)

SDD **Plan** 단계의 **Memory Bank** 문서 3/3. 비즈니스 맥락과 기존 기능과의 유기적 연관성을 정리한다.  
**기준 명세**: [specs/ko/2026-03-11-memento-cli-for-ai-spec.md](../../specs/ko/2026-03-11-memento-cli-for-ai-spec.md)

---

## 1. 비즈니스 맥락

### 1.1 문제

- Memento는 **MCP 서버**로 제공되며, Cursor 등에서 MCP 클라이언트가 recall, remember, forget 등 도구를 호출한다.
- AI가 **MCP 없이 터미널만** 쓰는 환경(일부 CLI 에이전트, 스크립트, 다른 IDE)에서는 Memento를 직접 쓸 수 없다.

### 1.2 목표

- **CLI 형태**로 동일한 기능을 노출하여, AI가 `memento recall ...`, `memento remember ...`처럼 셸 명령으로 기억을 조회·저장할 수 있게 한다.
- stdout=JSON, stderr=에러, exit code로 성공/실패를 구분해 **AI·스크립트 파싱이 용이**하게 한다.
- 설정은 `~/.memento/.env` 및 글로벌 옵션으로 **cwd에 무관**하게 사용 가능하게 한다.

### 1.3 사용자

- **1차**: CLI로 Memento를 호출하는 **AI 에이전트**(Cursor 규칙, 터미널 전용 에이전트 등).
- **2차**: 스크립트·자동화에서 기억 조회/저장이 필요한 **개발자**.

---

## 2. 기존 기능과의 유기적 연관

### 2.1 동일 도구·동일 데이터

- CLI가 호출하는 **도구 집합**은 MCP/HTTP 서버와 **동일**하다. `getToolRegistry()`, `executeTool(name, params, context)`를 재사용.
- **저장소**도 동일한 SQLite DB. `--db-path` 또는 `DB_PATH`/`~/.memento/.env`로 같은 DB를 가리키면, MCP에서 저장한 기억을 CLI recall로 조회할 수 있고 그 반대도 가능.

### 2.2 제공 채널 정리

| 채널 | 진입점 | 사용처 |
|------|--------|--------|
| **MCP (stdio)** | memento-mcp-server, memento-mcp | Cursor 등 MCP 클라이언트 |
| **HTTP/SSE** | memento-dev | 웹/원격 클라이언트 |
| **CLI** | **memento** | 터미널·AI·스크립트(한 번 실행 후 종료) |

- “한 번 실행하고 stdout만 받고 끝나는” 도구 형태는 **CLI 도입 전에는 없었음**. CLI가 그 공백을 채운다.

### 2.3 설정 체인과의 일관성

- **환경 변수·.env**: core가 읽는 `DB_PATH`, API 키 등과 동일한 변수 사용. CLI는 **core import 전**에 .env만 탐색·로드하여, core 설정이 이미 반영된 상태로 기동.
- **설정 우선순위**: CLI 글로벌 옵션 → 환경 변수 → .env(탐색 순서) → core ENV_DEFAULTS. 기존 서버와 동일한 우선순위 체인을 유지.

### 2.4 문서·에이전트 규칙

- **AGENTS.md** / Cursor 규칙: “작업 전 recall·memory_injection, 작업 후 remember. 설정은 DB_PATH 또는 ~/.memento/.env.” — CLI 사용 시나리오를 전제로 한 워크플로.
- **가이드**: [docs/guides/ko/memento-cli-for-ai.md](../../guides/ko/memento-cli-for-ai.md) — 명령 목록, 워크플로, 설정 방법, 예제. MCP 가이드와 나란히 CLI 전용 사용법을 제공.

---

## 3. 범위(명세 기준)

- **In scope**: packages/memento-server에 CLI 진입점·서브커맨드(recall, remember, forget, memory_injection), 글로벌 옵션, .env 탐색, AI·개발자용 가이드, REQ-IO-4(출력은 응답값만, 로그 억제).
- **Out of scope**: MCP/HTTP 동작 변경, 별도 npm 패키지 분리. Phase 1 이후 서브커맨드(pin, unpin, set_anchor 등)는 동일 패턴으로 확장 가능하나 이번 계획에서는 최소 집합만 필수 구현.

---

## 4. 성공 정의

- AI가 **MCP 없이** `memento recall --query "..."`, `memento remember --content "..."` 등으로 기억 조회·저장 가능.
- 성공 시 **stdout에 JSON만** 출력되고, **stderr에는 일상 로그가 없음**(REQ-IO-4, AC8). 실패 시에만 stderr에 에러 메시지.
- `memento --db-path <path>`, `~/.memento/.env` 등으로 cwd 무관하게 동일 설정 사용 가능(AC5, AC6).

---

*이 문서는 Plan 단계의 제품 헌칙으로, 목표·범위·기존 기능 연관 변경 시 이 문서를 먼저 갱신한다.*
