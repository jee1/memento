# @memento/core

도메인 로직, SQLite 스키마·마이그레이션, 하이브리드 검색, 임베딩, MCP 도구 구현을 담는 **라이브러리** 패키지입니다. MCP/HTTP 서버는 `memento-server`에서 이 패키지를 사용합니다.

## 스크립트

| 명령 | 설명 |
|------|------|
| `npm run build -w @memento/core` | TypeScript 빌드 |
| `npm run db:init -w @memento/core` | SQLite 스키마 초기화 |
| `npm run db:migrate -w @memento/core` | 대기 중인 마이그레이션 실행 |

## 진입점

- `createMementoCore`, `createToolContext`, `getToolRegistry`, `closeDatabase` — `src/index.ts`
- 서비스 조립 — `src/bootstrap.ts`

## 문서

저장소 루트의 [DEVELOPMENT_RULES.md](../../DEVELOPMENT_RULES.md)(개발 규칙), [AGENTS.md](../../AGENTS.md)(에이전트 요약), [CLAUDE.md](../../CLAUDE.md), [docs/README.md](../../docs/README.md)를 참고하세요.
