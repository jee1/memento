/**
 * MCP 클라이언트용 핵심 도구들
 * AI Agent가 사용하는 기본 메모리 관리 기능만 포함
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
// 관계 엔진 도구들은 HTTP API로만 제공 (MCP에서 제거)
// 관계 추출은 remember 도구에서 자동으로 수행됨
// 관리/운영성 도구들은 HTTP API로만 제공 (Phase 5.3)
// - RestoreAnchorsTool: POST /admin/anchors/restore
// - MigrateEmbeddingsTool: POST /admin/embeddings/migrate
// - ConvertEpisodicToSemanticTool: POST /admin/memory/convert-episodic-to-semantic
// - GetMetaMemoryStatsTool: GET /admin/memory/meta-stats

/**
 * 핵심 도구 인스턴스 생성 (11개: 핵심 5개 + 고급 2개 + 앵커 4개)
 * 관리/운영성 도구 4개는 HTTP API로만 제공 (관리자용)
 * 관계 엔진 도구 5개는 HTTP API로만 제공 (관리자용)
 */
const coreTools = [
  // 핵심 메모리 관리 (5개)
  new RememberTool(),        // 자동으로 관계 추출 포함
  new RecallTool(),
  new ForgetTool(),
  new PinTool(),
  new UnpinTool(),
  // 고급 메모리 기능 (2개)
  new MemoryInjectionPrompt(),
  new GetMemoryNeighborsTool(),
  // 앵커 시스템 도구들 (4개)
  new SetAnchorTool(),
  new GetAnchorTool(),
  new SearchLocalTool(),
  new ClearAnchorTool(),
  // 관리/운영성 도구들은 HTTP API로만 제공
  // - RestoreAnchorsTool: POST /admin/anchors/restore
  // - MigrateEmbeddingsTool: POST /admin/embeddings/migrate
  // - ConvertEpisodicToSemanticTool: POST /admin/memory/convert-episodic-to-semantic
  // - GetMetaMemoryStatsTool: GET /admin/memory/meta-stats
  // 관계 엔진 도구들은 제거됨 (HTTP API로만 제공)
  // - extract_relations: remember에서 자동 실행
  // - get_relations, add_relation, remove_relation, visualize_relations: HTTP API로 제공
];

/**
 * MCP 클라이언트용 도구 레지스트리 생성 및 등록
 * MCP 프로토콜 준수: 모듈 로드 시점의 로그를 비활성화하여 stdout 오염 방지
 * 로깅은 서버 초기화 후 필요 시 활성화 가능
 */
export const toolRegistry = new ToolRegistry({
  enableLogging: false, // 모듈 로드 시점 로그 비활성화 (MCP 프로토콜 준수)
  enableMetrics: true,
  maxExecutionTime: 30000,
  enableCaching: false,
  cacheSize: 100
});

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
export async function executeTool(name: string, params: unknown, context: ToolContext) {
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
  // 관리/운영성 도구들은 HTTP API로만 제공되므로 export하지 않음
  // - RestoreAnchorsTool
  // - MigrateEmbeddingsTool
  // - ConvertEpisodicToSemanticTool
  // - GetMetaMemoryStatsTool
  // 관계 엔진 도구들은 HTTP API로만 제공되므로 export하지 않음
};

