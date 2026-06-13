# Implementation Plan: MCP remember 검증 오류 처리

**Branch**: `023-fix-remember-mcp-validation` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)  
**Input**: GitHub Issue #444

## Summary

`packages/memento-server/src/server/routes/mcp.routes.ts`의 `processMcpMessage`에서 `tools/call` 시 `executeTool`이 throw하는 `ZodError`(예: `remember` without `content`)가 outer catch까지 전파되어 `MCP streamable_http processing failed` ERROR가 기록된다. 도구 실행 오류를 JSON-RPC 클라이언트 오류로 매핑하는 유틸 `mapToolExecutionErrorToJsonRpc`를 추가하고, `tools/call` 분기에서 매핑 가능한 오류는 WARN + `-32602`/`-32601`로 응답한다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥ 24, ES modules  
**Primary Dependencies**: `zod`, `@memento/core`, Express 5.x, Vitest  
**Storage**: N/A (스키마 변경 없음)  
**Testing**: Vitest co-located specs  
**Target Platform**: memento-server HTTP MCP (streamable HTTP `/mcp`)  
**Constraints**: MCP backward compatibility — 오류 code/message만 정정; 성공 응답 형식 불변

## Project Structure

```text
specs/023-fix-remember-mcp-validation/
├── spec.md
├── plan.md
└── tasks.md

packages/memento-server/src/server/
├── utils/
│   ├── mcp-tool-call-error.ts       # [신규] mapToolExecutionErrorToJsonRpc
│   └── mcp-tool-call-error.spec.ts  # [신규] Vitest
├── routes/
│   └── mcp.routes.ts                # [수정] tools/call try/catch
└── mcp.routes.streamable-http.spec.ts  # [선택] 통합 테스트
```

## Implementation Notes

| Error type | JSON-RPC code | message | data |
|------------|---------------|---------|------|
| `z.ZodError` | -32602 | Invalid params | `error.flatten()` |
| `Error` matching `Unknown tool:` | -32601 | Method not found | error.message |
| Other | — | re-throw | outer catch → -32603 |

## Constitution Check

| Gate | Status |
|------|--------|
| Test-First | mapper unit tests + optional streamable-http test |
| Backward Compatibility | 성공 경로 불변; 클라이언트 오류 code 정확화 |
| Schema Discipline | DB/스키마 변경 없음 |
| Quality Gates | lint, type-check, test |
