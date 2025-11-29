/**
 * MCP 클라이언트용 핵심 도구들
 * AI Agent가 사용하는 기본 메모리 관리 기능만 포함
 */

import { ToolRegistry } from './tool-registry.js';
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
import { RestoreAnchorsTool } from '../domains/anchor/tools/restore-anchors-tool.js';
import { MigrateEmbeddingsTool } from './migrate-embeddings-tool.js';
// 관계 엔진 도구들은 HTTP API로만 제공 (MCP에서 제거)
// 관계 추출은 remember 도구에서 자동으로 수행됨

/**
 * 핵심 도구 인스턴스 생성 (12개: 핵심 7개 + 앵커 5개)
 * 관계 엔진 도구 5개는 HTTP API로만 제공 (관리자용)
 */
const coreTools = [
  new RememberTool(),        // 자동으로 관계 추출 포함
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
  new MigrateEmbeddingsTool(),
  // 관계 엔진 도구들은 제거됨 (HTTP API로만 제공)
  // - extract_relations: remember에서 자동 실행
  // - get_relations, add_relation, remove_relation, visualize_relations: HTTP API로 제공
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
  MigrateEmbeddingsTool,
  // 관계 엔진 도구들은 HTTP API로만 제공되므로 export하지 않음
};

