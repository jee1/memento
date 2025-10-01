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
/**
 * MCP 클라이언트용 도구 레지스트리 생성 및 등록
 */
export declare const toolRegistry: ToolRegistry;
/**
 * 도구 레지스트리 반환
 */
export declare function getToolRegistry(): ToolRegistry;
/**
 * 특정 도구 조회
 */
export declare function getTool(name: string): import("./types.js").ToolDefinition | undefined;
/**
 * 모든 도구 목록 반환
 */
export declare function getAllTools(): import("./types.js").ToolDefinition[];
/**
 * 도구 실행
 */
export declare function executeTool(name: string, params: any, context: any): Promise<any>;
export { RememberTool, RecallTool, ForgetTool, PinTool, UnpinTool, };
//# sourceMappingURL=index.d.ts.map