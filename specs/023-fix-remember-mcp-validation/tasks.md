# Tasks: MCP remember 검증 오류 처리

**Input**: `specs/023-fix-remember-mcp-validation/` (spec.md, plan.md)  
**Issue**: #444

## Phase 1: Core fix

- [ ] T001 [US1] `mcp-tool-call-error.ts` — `mapToolExecutionErrorToJsonRpc(error)` 구현 (ZodError → -32602, Unknown tool → -32601, else null)
- [ ] T002 [US1] `mcp-tool-call-error.spec.ts` — Vitest 단위 테스트
- [ ] T003 [US1] `mcp.routes.ts` — `tools/call`에서 executeTool try/catch, mapped 시 warn + createJsonRpcError, unmapped re-throw

## Phase 2: Integration & verification

- [ ] T004 [US1] `mcp.routes.streamable-http.spec.ts` — ZodError 시 -32602 및 ERROR 로그 미발생 테스트 (가능 시)
- [ ] T005 [POLISH] `npm run lint`, `npm run type-check`, `npm test` 통과
- [ ] T006 [POLISH] graphify 코드 그래프 재빌드

## Dependencies

T001 → T002 → T003 → T004 → T005 → T006
