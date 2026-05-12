# @memento/core

도메인 로직, SQLite 스키마·마이그레이션, 하이브리드 검색, 임베딩, MCP 도구 구현을 담는 **라이브러리** 패키지입니다. MCP/HTTP 서버는 `memento-server`에서 이 패키지를 사용합니다.

## 스크립트

| 명령 | 설명 |
|------|------|
| `npm run build -w @memento/core` | TypeScript 빌드 |
| `npm run db:init -w @memento/core` | SQLite 스키마 초기화 |
| `npm run db:migrate -w @memento/core` | 대기 중인 마이그레이션 실행 |
| `npm run type-check -w @memento/core` | 타입 검사 (루트 `npm run type-check`에 포함) |
| `npm test` | 루트에서 전체 Vitest 스위트 (core 빌드는 `test:prepare`에서 선행) |

## 진입점

- `createMementoCore`, `createToolContext`, `getToolRegistry`, `closeDatabase` — `src/index.ts`
- 서비스 조립 — `src/bootstrap.ts`

## 문서

저장소 루트의 [AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md), [docs/README.md](../../docs/README.md)를 참고하세요.
