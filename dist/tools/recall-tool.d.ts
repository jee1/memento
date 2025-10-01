/**
 * Recall Tool - 기억 검색 도구
 */
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';
export declare class RecallTool extends BaseTool {
    constructor();
    handle(params: any, context: ToolContext): Promise<ToolResult>;
}
//# sourceMappingURL=recall-tool.d.ts.map