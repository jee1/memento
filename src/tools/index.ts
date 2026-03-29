/**
 * MCP/HTTP 호환 도구 진입점.
 * 레지스트리·실행은 @memento/core 단일 소스(FR-005: telemetryService.runWithContext + request_id).
 * 아래 클래스 export는 기존 src/test·스크립트가 src/domains 구현을 직접 참조할 때의 호환용.
 */

export { getToolRegistry, executeTool, resolveTelemetryOwnerId } from '@memento/core';

export { RememberTool } from '../domains/memory/tools/remember-tool.js';
export { RecallTool } from '../domains/memory/tools/recall-tool.js';
export { ForgetTool } from '../domains/memory/tools/forget-tool.js';
export { PinTool } from '../domains/memory/tools/pin-tool.js';
export { UnpinTool } from '../domains/memory/tools/unpin-tool.js';
export { MemoryInjectionPrompt } from '../domains/memory/tools/memory-injection-prompt.js';
export { GetMemoryNeighborsTool } from '../domains/memory/tools/get-memory-neighbors-tool.js';
export { SetAnchorTool } from '../domains/anchor/tools/set-anchor-tool.js';
export { GetAnchorTool } from '../domains/anchor/tools/get-anchor-tool.js';
export { SearchLocalTool } from '../domains/anchor/tools/search-local-tool.js';
export { ClearAnchorTool } from '../domains/anchor/tools/clear-anchor-tool.js';
export { ProceduralDiffTool } from '../domains/memory/tools/procedural-diff-tool.js';
export { ProceduralRollbackTool } from '../domains/memory/tools/procedural-rollback-tool.js';
export { RememberProcedureTool } from '../domains/memory/tools/remember-procedure-tool.js';
export { FeedbackTool } from '../domains/memory/tools/feedback-tool.js';
export { GetIntrospectionSummaryTool } from '../domains/memory/tools/get-introspection-summary-tool.js';
