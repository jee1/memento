# MCP serverUseInstructions 가이드

MCP 클라이언트(예: Cursor)가 서버를 초기화할 때, 서버는 `InitializeResult`에 `instructions` 필드를 포함해 응답할 수 있습니다. 이 필드에 담긴 문자열이 바로 **serverUseInstructions**로, AI가 "이 MCP를 어떻게 사용해야 하는지"를 미리 알 수 있도록 하는 사용 설명서 역할을 합니다.

## serverUseInstructions란

MCP 프로토콜 명세에서 `InitializeResult.instructions`는 선택(optional) 문자열 필드입니다. 클라이언트가 이 값을 받으면 시스템 프롬프트나 컨텍스트에 포함해 AI에게 해당 서버의 사용법을 안내할 수 있습니다.

이 필드가 있는 서버와 없는 서버를 비교하면 차이가 명확합니다. `instructions`가 있으면 AI는 초기화 시점에 사용법 설명을 받기 때문에 도구 목록의 description만 보고 추론하는 것보다 훨씬 정확하게 서버를 활용합니다. 반대로 없으면 AI는 각 도구의 설명과 스키마만 보고 사용 패턴을 스스로 유추해야 합니다.

## Memento에서 구현된 방식

문구는 `packages/memento-server/src/server/mcp-instructions.ts` 의 `MEMENTO_SERVER_INSTRUCTIONS` 하나입니다. 세 접속 경로가 같은 값을 보냅니다.

| 접속 경로 | 보내는 곳 |
|---|---|
| stdio | `InitializeResult`(옛 방식), `server/discover`(2026-07-28) |
| HTTP `/mcp`, 옛 방식 | `initialize` 응답 |
| HTTP `/mcp`, 2026-07-28 | `server/discover` 응답 |

내용은 작업 전 `memory_injection` 또는 `recall`, 작업 뒤 `remember`, 쓴 기억에 `feedback`, 저장 형식의 핵심입니다. 1,000자 상한을 시험이 지킵니다. `README.md` 의 붙여 넣기 블록도 같은 글이어야 하며 시험이 대조합니다.

## 다른 MCP 서버에 적용하는 방법

Node.js `@modelcontextprotocol/sdk` 기반 서버라면 `Server` 생성 시 옵션 객체에 `instructions` 필드를 추가하는 것만으로 충분합니다. 다른 언어나 SDK를 직접 구현하는 경우에는 `initialize` 요청에 대한 응답 객체에 `instructions: string` 필드를 넣어 반환하면 됩니다.

## 클라이언트의 동작 (2026-11-28 문서 확인)

`instructions` 를 모델에 넣을지는 클라이언트가 정합니다. Claude Code 문서와 Gemini CLI 소스는 넣는다고 하고, Codex 문서는 읽는다고 적습니다(앞 512자 권장). Cursor 문서에는 설명이 없습니다. 넣지 않는 클라이언트에는 README 의 블록을 프로젝트 지침에 붙여 넣으세요.

## 참고 자료

- MCP 프로토콜 명세: https://modelcontextprotocol.io/specification/ (InitializeResult의 `instructions` 필드)
- Server Instructions 소개: https://modelcontextprotocol.info/tags/server-instructions/
- Cursor MCP 설정: `~/.cursor/mcp.json` 또는 프로젝트 `.cursor/mcp.json` (Settings → Tools & MCP)
- 붙여 넣기 블록: 저장소 루트 [README.md](../../../README.md)
