/**
 * Tools 모듈 인덱스
 * 모든 도구들을 등록하고 관리
 */

import { ToolRegistry } from './tool-registry.js';
import { RememberTool } from './remember-tool.js';
import { RecallTool } from './recall-tool.js';
import { ForgetTool } from './forget-tool.js';
import { PinTool } from './pin-tool.js';
import { UnpinTool } from './unpin-tool.js';
import { CleanupMemoryTool } from './cleanup-memory-tool.js';
import { ForgettingStatsTool } from './forgetting-stats-tool.js';
import { PerformanceStatsTool } from './performance-stats-tool.js';
import { DatabaseOptimizeTool } from './database-optimize-tool.js';
import { errorStatsTool, executeErrorStats } from './error-stats.js';
import { resolveErrorTool, executeResolveError } from './resolve-error.js';

/**
 * 모든 도구 인스턴스 생성
 */
const tools = [
  new RememberTool(),
  new RecallTool(),
  new ForgetTool(),
  new PinTool(),
  new UnpinTool(),
  new CleanupMemoryTool(),
  new ForgettingStatsTool(),
  new PerformanceStatsTool(),
  new DatabaseOptimizeTool(),
];

/**
 * 도구 레지스트리 생성 및 등록
 */
export const toolRegistry = new ToolRegistry();

// 모든 도구 등록
toolRegistry.registerAll(tools.map(tool => tool.getDefinition()));

// 에러 로깅 도구들 등록
toolRegistry.register({
  name: errorStatsTool.name,
  description: errorStatsTool.description,
  inputSchema: errorStatsTool.inputSchema,
  handler: executeErrorStats
});

toolRegistry.register({
  name: resolveErrorTool.name,
  description: resolveErrorTool.description,
  inputSchema: resolveErrorTool.inputSchema,
  handler: executeResolveError
});

/**
 * 도구 레지스트리 반환
 */
export function getToolRegistry(): ToolRegistry {
  return toolRegistry;
}

/**
 * 특정 도구 조회
 */
export function getTool(name: string) {
  return toolRegistry.get(name);
}

/**
 * 모든 도구 목록 반환
 */
export function getAllTools() {
  return toolRegistry.getAll();
}

/**
 * 도구 실행
 */
export async function executeTool(name: string, params: any, context: any) {
  return await toolRegistry.execute(name, params, context);
}

// 개별 도구들도 export (필요한 경우)
export {
  RememberTool,
  RecallTool,
  ForgetTool,
  PinTool,
  UnpinTool,
  CleanupMemoryTool,
  ForgettingStatsTool,
  PerformanceStatsTool,
  DatabaseOptimizeTool,
};

