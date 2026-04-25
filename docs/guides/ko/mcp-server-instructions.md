# MCP serverUseInstructions / Server Instructions

Cursor IDE에서 MCP 서버 사용 시 **serverUseInstructions** 개념과 Memento·다른 MCP에서의 활용 방법을 정리한 문서입니다.

---

## 1. serverUseInstructions란?

### 정의

**serverUseInstructions**는 MCP 프로토콜의 **InitializeResult**에 포함되는 **선택(optional) 문자열 필드**인 `instructions`가, Cursor 등 클라이언트에 전달된 뒤 **“이 MCP를 어떻게 사용해야 하는지”** AI에게 안내하는 데 쓰일 때 붙는 이름입니다.

- **프로토콜**: `InitializeResult.instructions` (optional)
- **역할**: LLM에게 해당 MCP 사용법을 미리 알려 주는 “사용 설명서”
- **동작**: MCP 서버 초기화 시 클라이언트가 `initialize` 응답에서 `instructions`를 받으면, 이를 시스템 프롬프트/컨텍스트에 포함해 **serverUseInstructions**로 활용할 수 있음

### 유무에 따른 차이

| 구분 | instructions 있음 | instructions 없음 |
|------|-------------------|--------------------|
| **예시** | user-serena, cursor-ide-browser, Memento(구현 후) | 이전 Memento, user-sequential-thinking 등 |
| **시스템 메시지** | 사용법 설명이 상세히 포함됨 | 도구 목록·description만 포함됨 |
| **AI 활용** | 미리 사용법을 알고 적극 활용 | 도구 설명만 보고 추론하여 사용 |

---

## 2. 구현 방식 (Memento 기준)

### MCP 프로토콜 측

- **스펙**: InitializeResult에 선택 필드 `instructions: string` 존재.
- **클라이언트 동작**: `initialize` 응답의 `instructions`를 받으면, 이를 그대로 또는 가공해 AI 컨텍스트(예: serverUseInstructions)에 넣을 수 있음.

### 서버 구현 (@modelcontextprotocol/sdk)

Node.js용 **@modelcontextprotocol/sdk**의 `Server` 클래스는 이미 `instructions`를 지원합니다.

- **생성자**: `new Server(serverInfo, { capabilities, instructions })`
- **내부**: `options.instructions`를 `_instructions`에 저장하고, `_oninitialize()`에서 InitializeResult에 `...(this._instructions && { instructions: this._instructions })` 로 넣어 반환함.

따라서 **Memento MCP 서버**에서는 다음만 하면 됩니다.

1. **Server 생성 시** 두 번째 인자에 `instructions` 문자열 전달.
2. 서버가 `initialize` 요청에 응답할 때 SDK가 자동으로 `result.instructions`에 해당 문자열을 포함.
3. Cursor(또는 다른 클라이언트)가 이 값을 받아 serverUseInstructions 등으로 사용.

### Memento에서 적용한 코드

- **파일**: `packages/memento-server/src/server/index.ts`
- **내용**:
  - 상수 `MEMENTO_SERVER_INSTRUCTIONS`에 “작업 전 recall/memory_injection, 작업 후 remember, 타입·태그 권장” 등 사용 지침을 문자열로 정의.
  - `new Server(serverInfo, { capabilities, instructions: MEMENTO_SERVER_INSTRUCTIONS })` 로 전달.

이렇게 하면 Cursor가 Memento MCP를 초기화할 때 `instructions`를 받고, 이를 **serverUseInstructions**로 포함시킬 수 있습니다.

---

## 3. Cursor 쪽 동작 (정리)

- **시스템 메시지의 MCP 목록**: Cursor가 자동 생성하며, `instructions`가 있는 MCP는 상세 설명과 함께 노출될 수 있음.
- **mcps 폴더**: 일부 클라이언트는 `initialize` 응답의 `instructions`를 프로젝트별 `mcps/<server>/INSTRUCTIONS.md` 등으로 저장해 두고, 이를 serverUseInstructions로 사용할 수 있음. (동작은 Cursor 버전/설정에 따름)
- **결론**: 서버에서 **InitializeResult.instructions**를 채워 주는 것이 핵심이며, Memento는 위 방식으로 이미 채우고 있음.

---

## 4. 다른 MCP 서버(Sequential Thinking 등)에서 하고 싶을 때

- 해당 MCP 서버 **패키지**에서 `initialize` 응답을 만드는 부분을 찾는다.
- Node SDK 사용 시: `Server` 생성 시 `{ instructions: '...' }` 추가.
- 다른 언어/직접 구현 시: InitializeResult 객체에 `instructions` 필드를 문자열로 넣어 반환하면 됨.

---

## 5. 참고 자료

- MCP 프로토콜: InitializeResult의 `instructions` 필드  
  - 예: https://modelcontextprotocol.io/specification/  
  - Server Instructions 소개: https://modelcontextprotocol.info/tags/server-instructions/
- Cursor MCP 설정: `~/.cursor/mcp.json` 또는 프로젝트 `.cursor/mcp.json`, Settings → Tools & MCP
- mcps 폴더: `~/.cursor/projects/<project-id>/mcps/` (Cursor가 MCP 메타데이터·지침을 둘 수 있는 위치)
- Memento 사용 규칙: 저장소 루트 [DEVELOPMENT_RULES.md](../../../DEVELOPMENT_RULES.md)의 «Memento MCP» 절(에이전트 한 줄 요약은 [AGENTS.md](../../../AGENTS.md))
