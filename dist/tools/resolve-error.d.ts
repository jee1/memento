/**
 * 에러 해결 도구
 * 특정 에러를 해결된 상태로 표시하는 MCP 도구
 */
import type { ToolContext } from './types.js';
export declare const resolveErrorTool: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            errorId: {
                type: string;
                description: string;
            };
            resolvedBy: {
                type: string;
                default: string;
                description: string;
            };
            reason: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function executeResolveError(args: any, context: ToolContext): Promise<{
    success: boolean;
    error: string;
    errorId?: undefined;
    message?: undefined;
    resolvedBy?: undefined;
    reason?: undefined;
    resolvedAt?: undefined;
} | {
    success: boolean;
    error: string;
    errorId: any;
    message?: undefined;
    resolvedBy?: undefined;
    reason?: undefined;
    resolvedAt?: undefined;
} | {
    success: boolean;
    message: string;
    errorId: any;
    resolvedBy: any;
    reason: any;
    resolvedAt: string;
    error?: undefined;
}>;
//# sourceMappingURL=resolve-error.d.ts.map