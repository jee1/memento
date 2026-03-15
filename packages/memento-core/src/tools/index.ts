/**
 * @memento/core - 도구 레지스트리 및 핵심 도구 등록
 * 서버/앱에서 getToolRegistry()로 동일 인스턴스 사용
 */

import { ToolRegistry } from './tool-registry.js';
import type { ToolContext } from './types.js';
import { RememberTool } from '../domains/memory/tools/remember-tool.js';
import { RecallTool } from '../domains/memory/tools/recall-tool.js';
import { ForgetTool } from '../domains/memory/tools/forget-tool.js';
import { PinTool } from '../domains/memory/tools/pin-tool.js';
import { UnpinTool } from '../domains/memory/tools/unpin-tool.js';
import { MemoryInjectionPrompt } from '../domains/memory/tools/memory-injection-prompt.js';
import { GetMemoryNeighborsTool } from '../domains/memory/tools/get-memory-neighbors-tool.js';
import { SetAnchorTool } from '../domains/anchor/tools/set-anchor-tool.js';
import { GetAnchorTool } from '../domains/anchor/tools/get-anchor-tool.js';
import { SearchLocalTool } from '../domains/anchor/tools/search-local-tool.js';
import { ClearAnchorTool } from '../domains/anchor/tools/clear-anchor-tool.js';
import { ProceduralDiffTool } from '../domains/memory/tools/procedural-diff-tool.js';
import { ProceduralRollbackTool } from '../domains/memory/tools/procedural-rollback-tool.js';
import { RememberProcedureTool } from '../domains/memory/tools/remember-procedure-tool.js';
import { GetIntrospectionSummaryTool } from '../domains/memory/tools/get-introspection-summary-tool.js';

const coreTools = [
  new RememberTool(),
  new RecallTool(),
  new ForgetTool(),
  new PinTool(),
  new UnpinTool(),
  new MemoryInjectionPrompt(),
  new GetMemoryNeighborsTool(),
  new SetAnchorTool(),
  new GetAnchorTool(),
  new SearchLocalTool(),
  new ClearAnchorTool(),
  new ProceduralDiffTool(),
  new ProceduralRollbackTool(),
  new RememberProcedureTool(),
  new GetIntrospectionSummaryTool()
];

export const toolRegistry = new ToolRegistry({
  enableLogging: false,
  enableMetrics: true,
  maxExecutionTime: 30000,
  enableCaching: false,
  cacheSize: 100
});

toolRegistry.registerAll(coreTools.map(tool => tool.getDefinition()));

export function getToolRegistry(): ToolRegistry {
  return toolRegistry;
}

export function getTool(name: string) {
  return toolRegistry.get(name);
}

export function getAllTools() {
  return toolRegistry.getAll();
}

export async function executeTool(name: string, params: unknown, context: ToolContext) {
  return await toolRegistry.execute(name, params, context);
}
