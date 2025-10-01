/**
 * 기본 도구 클래스
 * 모든 MCP 도구의 기본 구조를 제공
 */
import type { ToolDefinition, ToolContext, ToolResult, ToolError } from './types.js';
export declare abstract class BaseTool {
    protected name: string;
    protected description: string;
    protected inputSchema: any;
    constructor(name: string, description: string, inputSchema: any);
    /**
     * 도구 정의 반환
     */
    getDefinition(): ToolDefinition;
    /**
     * 도구 실행 (추상 메서드)
     */
    abstract handle(params: any, context: ToolContext): Promise<ToolResult>;
    /**
     * 성공 결과 생성
     */
    protected createSuccessResult(data: any): ToolResult;
    /**
     * 에러 결과 생성
     */
    protected createErrorResult(error: string, message?: string, details?: string): ToolError;
    /**
     * 데이터베이스 연결 확인
     */
    protected validateDatabase(context: ToolContext): void;
    /**
     * 서비스 확인
     */
    protected validateService(service: any, serviceName: string): void;
}
//# sourceMappingURL=base-tool.d.ts.map