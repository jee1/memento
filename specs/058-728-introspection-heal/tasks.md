# Tasks: Issue #728 introspection heal

- [x] `EmbeddingReindexService.reindexByIds()` + spec 테스트 (5 cases)
- [x] `IntrospectionHealingService` (분류 + apply 쓰기) + spec 테스트 (dry-run no-op 포함, 4 cases)
- [x] `IntrospectionHealTool` (BaseTool, MCP 미등록) — `packages/memento-core/src/index.ts`에서 export + tool-level spec (3 cases)
- [x] `admin-tools.routes.ts`에 `POST /introspection/heal` 추가
- [x] `docs/agents/commands.md` env 플래그 3개 + curl 예시, `env.example` 주석 추가
- [x] lint(0 errors) · type-check(clean) · 관련 도메인 테스트(memory/embedding/forgetting: 910 passed) · memento-server(544 passed) 전체 통과
