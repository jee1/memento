# memento-server

`@memento/core`를 사용하는 **MCP(stdio) 서버**와 **HTTP(+ 관리 API)** 서버 패키지입니다.

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

[DEVELOPMENT_RULES.md](../../DEVELOPMENT_RULES.md), [AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md), [docs/README.md](../../docs/README.md)
