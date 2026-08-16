# @memento/core

Memento의 **심장**에 해당하는 라이브러리입니다. 기억 저장·검색·망각·앵커·관계·절차 메모리 같은 도메인 로직과 SQLite 스키마, 하이브리드 검색, 임베딩, MCP 도구 구현이 모두 여기에 있습니다. MCP/HTTP로 노출하는 실행 파일은 `memento-server`가 담당하고, 이 패키지는 그 아래에서 재사용되는 코어입니다.

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

**MCP 도구**: 등록 22개 — `src/tools/index.ts`의 `coreTools` 배열과 동기화합니다. `tools/list` 기본 노출은 같은 파일의 `CORE_TOOLSET` 4개이며, `getExposedTools()`가 `MEMENTO_TOOLSET`에 따라 필터링합니다 (#769).
