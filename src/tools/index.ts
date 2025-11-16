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
import { GetMemoryNeighborsTool } from './get-memory-neighbors-tool.js';
import { SetAnchorTool } from './set-anchor-tool.js';
import { GetAnchorTool } from './get-anchor-tool.js';
import { SearchLocalTool } from './search-local-tool.js';
import { ClearAnchorTool } from './clear-anchor-tool.js';
import { RestoreAnchorsTool } from './restore-anchors-tool.js';
// 관계 엔진 도구들
import { ExtractRelationsTool } from './extract-relations-tool.js';
import { GetRelationsTool } from './get-relations-tool.js';
import { AddRelationTool } from './add-relation-tool.js';
import { RemoveRelationTool } from './remove-relation-tool.js';
import { VisualizeRelationsTool } from './visualize-relations-tool.js';

/**
 * 핵심 도구 인스턴스 생성 (17개: 기존 7개 + 앵커 5개 + 관계 엔진 5개)
 */
const coreTools = [
  new RememberTool(),
  new RecallTool(),
  new ForgetTool(),
  new PinTool(),
  new UnpinTool(),
  new MemoryInjectionPrompt(),
  new GetMemoryNeighborsTool(),
  // 앵커 시스템 도구들
  new SetAnchorTool(),
  new GetAnchorTool(),
  new SearchLocalTool(),
  new ClearAnchorTool(),
  new RestoreAnchorsTool(),
  // 관계 엔진 도구들
  new ExtractRelationsTool(),
  new GetRelationsTool(),
  new AddRelationTool(),
  new RemoveRelationTool(),
  new VisualizeRelationsTool(),
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
  GetMemoryNeighborsTool,
  // 앵커 시스템 도구들
  SetAnchorTool,
  GetAnchorTool,
  SearchLocalTool,
  ClearAnchorTool,
  RestoreAnchorsTool,
  // 관계 엔진 도구들
  ExtractRelationsTool,
  GetRelationsTool,
  AddRelationTool,
  RemoveRelationTool,
  VisualizeRelationsTool,
};

