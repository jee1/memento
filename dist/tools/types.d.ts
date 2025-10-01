/**
 * MCP Tools 공통 타입 정의
 */
import { z } from 'zod';
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: any;
    handler: ToolHandler;
}
export interface ToolContext {
    db: any;
    services: {
        searchEngine?: any;
        hybridSearchEngine?: any;
        embeddingService?: any;
        forgettingPolicyService?: any;
        performanceMonitor?: any;
        databaseOptimizer?: any;
        errorLoggingService?: any;
        performanceAlertService?: any;
        performanceMonitoringIntegration?: any;
    };
}
export type ToolHandler = (params: any, context: ToolContext) => Promise<any>;
export interface ToolResult {
    content: Array<{
        type: 'text';
        text: string;
    }>;
}
export interface ToolError {
    error: string;
    message?: string;
    details?: string;
}
/**
 * 공통 스키마 정의
 */
export declare const CommonSchemas: {
    MemoryId: z.ZodString;
    Content: z.ZodString;
    Query: z.ZodString;
    MemoryType: z.ZodEnum<["working", "episodic", "semantic", "procedural"]>;
    PrivacyScope: z.ZodEnum<["private", "team", "public"]>;
    Importance: z.ZodNumber;
    Limit: z.ZodDefault<z.ZodNumber>;
    Tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    Source: z.ZodOptional<z.ZodString>;
    HardDelete: z.ZodDefault<z.ZodBoolean>;
    DryRun: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    Analyze: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    CreateIndexes: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
};
//# sourceMappingURL=types.d.ts.map