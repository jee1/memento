# MCP serverUseInstructions 가이드

MCP 클라이언트(예: Cursor)가 서버를 초기화할 때, 서버는 `InitializeResult`에 `instructions` 필드를 포함해 응답할 수 있습니다. 이 필드에 담긴 문자열이 바로 **serverUseInstructions**로, AI가 "이 MCP를 어떻게 사용해야 하는지"를 미리 알 수 있도록 하는 사용 설명서 역할을 합니다.

## serverUseInstructions란

MCP 프로토콜 명세에서 `InitializeResult.instructions`는 선택(optional) 문자열 필드입니다. 클라이언트가 이 값을 받으면 시스템 프롬프트나 컨텍스트에 포함해 AI에게 해당 서버의 사용법을 안내할 수 있습니다.

이 필드가 있는 서버와 없는 서버를 비교하면 차이가 명확합니다. `instructions`가 있으면 AI는 초기화 시점에 사용법 설명을 받기 때문에 도구 목록의 description만 보고 추론하는 것보다 훨씬 정확하게 서버를 활용합니다. 반대로 없으면 AI는 각 도구의 설명과 스키마만 보고 사용 패턴을 스스로 유추해야 합니다.

## Memento에서 구현된 방식

Memento는 Node.js용 `@modelcontextprotocol/sdk`의 `Server` 클래스를 사용합니다. 이 클래스의 생성자는 두 번째 인자에 `instructions` 문자열을 받으며, `initialize` 요청에 응답할 때 SDK가 자동으로 `InitializeResult`에 해당 값을 포함시킵니다.

```typescript
// packages/memento-server/src/server/index.ts
new Server(serverInfo, {
  capabilities,
  instructions: MEMENTO_SERVER_INSTRUCTIONS
})
```

`MEMENTO_SERVER_INSTRUCTIONS` 상수에는 "작업 전 `recall`/`memory_injection`으로 관련 기억 조회, 작업 후 `remember`로 저장, 타입과 태그 권장" 등 Memento 사용 지침이 담겨 있습니다. Cursor는 MCP 서버를 초기화할 때 이 문자열을 받아 serverUseInstructions로 활용합니다.

## 다른 MCP 서버에 적용하는 방법

Node.js `@modelcontextprotocol/sdk` 기반 서버라면 `Server` 생성 시 옵션 객체에 `instructions` 필드를 추가하는 것만으로 충분합니다. 다른 언어나 SDK를 직접 구현하는 경우에는 `initialize` 요청에 대한 응답 객체에 `instructions: string` 필드를 넣어 반환하면 됩니다.

## Cursor의 동작 방식

Cursor는 MCP 서버를 초기화할 때 `initialize` 응답에서 `instructions`를 읽어 시스템 메시지에 포함시킵니다. 이렇게 하면 AI가 해당 MCP 서버를 어떻게 활용해야 하는지 세션 시작 시점에 이미 알고 있는 상태가 됩니다.

일부 Cursor 버전에서는 `~/.cursor/projects/<project-id>/mcps/<server>/INSTRUCTIONS.md` 경로에 `instructions`를 저장해 두고 참조하기도 합니다. 동작 방식은 Cursor 버전과 설정에 따라 다를 수 있습니다.

## 참고 자료

- MCP 프로토콜 명세: https://modelcontextprotocol.io/specification/ (InitializeResult의 `instructions` 필드)
- Server Instructions 소개: https://modelcontextprotocol.info/tags/server-instructions/
- Cursor MCP 설정: `~/.cursor/mcp.json` 또는 프로젝트 `.cursor/mcp.json` (Settings → Tools & MCP)
- Memento 사용 규칙: 저장소 루트 [AGENTS.md](../../../AGENTS.md)의 "Memento MCP 사용" 섹션
