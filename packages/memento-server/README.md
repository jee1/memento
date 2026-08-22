# memento-server

`@memento/core` 위에 **MCP(stdio)** 와 **HTTP(+ 관리 API)** 를 올린 실행 패키지입니다. Cursor에 stdio로 붙이거나, 여러 에이전트가 HTTP로 같은 DB를 공유하게 할 때 이 패키지를 띄웁니다.

## 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev -w memento-server` | MCP 서버 (watch) |
| `npm run dev:http -w memento-server` | HTTP 서버 (watch) |
| `npm run build -w memento-server` | 빌드 |
| `npm run start -w memento-server` | 빌드 산출물로 MCP 서버 실행 |
| `npm run start:http -w memento-server` | 빌드 산출물로 HTTP 서버 실행 |

루트에서 `npm run dev` / `npm run dev:http`를 쓰면 위 워크스페이스 스크립트가 호출됩니다.

## 진입점

- MCP — `src/server/index.ts`
- HTTP — `src/server/http-server.ts`
- CLI — `src/cli.ts`

## 문서

[AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md), [docs/README.md](../../docs/README.md)

기본 HTTP 포트는 `9001` (`MCP_SERVER_PORT` / `PORT`, `env.example` 참고).
