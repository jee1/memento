/**
 * MCP 클라이언트용 핵심 도구들
 * AI Agent가 사용하는 기본 메모리 관리 기능만 포함
 */

import { ToolRegistry } from './tool-registry.js';
import { RememberTool } from './remember-tool.js';
import { RecallTool } from './recall-tool.js';
import { ForgetTool } from './forget-tool.js';
import { PinTool } from './pin-tool.js';
import { UnpinTool } from './unpin-tool.js';
import { MemoryInjectionPrompt } from './memory-injection-prompt.js';

/**
 * 핵심 도구 인스턴스 생성 (6개)
 */
const coreTools = [
  new RememberTool(),
  new RecallTool(),
  new ForgetTool(),
  new PinTool(),
  new UnpinTool(),
  new MemoryInjectionPrompt(),
];

/**
 * MCP 클라이언트용 도구 레지스트리 생성 및 등록
 */
export const toolRegistry = new ToolRegistry();

// 핵심 도구들만 등록
toolRegistry.registerAll(coreTools.map(tool => tool.getDefinition()));

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

// 핵심 도구들만 export
export {
  RememberTool,
  RecallTool,
  ForgetTool,
  PinTool,
  UnpinTool,
  MemoryInjectionPrompt,
};

