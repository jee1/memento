# Tasks: Issue #728 introspection heal

- [ ] `EmbeddingReindexService.reindexByIds()` + spec 테스트
- [ ] `IntrospectionHealingService` (분류 + apply 쓰기) + spec 테스트 (dry-run no-op 포함)
- [ ] `IntrospectionHealTool` (BaseTool, MCP 미등록) — `packages/memento-core/src/index.ts`에서 export
- [ ] `admin-tools.routes.ts`에 `POST /introspection/heal` 추가 + 통합 테스트
- [ ] `docs/agents/commands.md` env 플래그 3개 + 사용 예시 문서화
- [ ] lint · type-check · test 전체 통과
