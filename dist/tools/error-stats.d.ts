/**
 * 에러 통계 도구
 * 에러 로깅 서비스의 통계 정보를 조회하는 MCP 도구
 */
import type { ToolContext } from './types.js';
export declare const errorStatsTool: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            hours: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
            severity: {
                type: string;
                enum: string[];
                description: string;
            };
            category: {
                type: string;
                enum: string[];
                description: string;
            };
            includeResolved: {
                type: string;
                default: boolean;
                description: string;
            };
            limit: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
        };
        required: never[];
    };
};
export declare function executeErrorStats(args: any, context: ToolContext): Promise<{
    success: boolean;
    error: string;
    stats: {
        totalErrors: number;
        errorsBySeverity: {
            low: number;
            medium: number;
            high: number;
            critical: number;
        };
        errorsByCategory: {
            database: number;
            network: number;
            validation: number;
            authentication: number;
            performance: number;
            memory: number;
            search: number;
            embedding: number;
            cache: number;
            unknown: number;
        };
        errorsByHour: {};
        averageResolutionTime: number;
        criticalErrors: number;
        recentErrors: never[];
    };
    alerts?: undefined;
    summary?: undefined;
} | {
    success: boolean;
    stats: any;
    alerts: any;
    summary: {
        totalErrors: any;
        criticalErrors: any;
        activeAlerts: any;
        averageResolutionTime: number;
    };
    error?: undefined;
} | {
    success: boolean;
    error: string;
    stats: null;
    alerts?: undefined;
    summary?: undefined;
}>;
//# sourceMappingURL=error-stats.d.ts.map