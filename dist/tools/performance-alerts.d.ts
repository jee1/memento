/**
 * 성능 알림 도구
 * 성능 알림 조회, 해결, 통계 확인을 위한 MCP 도구
 */
import type { ToolContext } from './types.js';
export declare const performanceAlertsTool: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            action: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            hours: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
            level: {
                type: string;
                enum: string[];
                description: string;
            };
            type: {
                type: string;
                enum: string[];
                description: string;
            };
            resolved: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
            alertId: {
                type: string;
                description: string;
            };
            resolvedBy: {
                type: string;
                default: string;
                description: string;
            };
            resolution: {
                type: string;
                description: string;
            };
        };
        required: never[];
    };
};
export declare function executePerformanceAlerts(args: any, context: ToolContext): Promise<{
    success: boolean;
    stats: any;
    summary: {
        totalAlerts: any;
        activeAlerts: any;
        criticalAlerts: any;
        averageResolutionTime: number;
    };
} | {
    success: boolean;
    activeAlerts: any;
    recentAlerts: any;
} | {
    success: boolean;
    alerts: any;
    total: any;
} | {
    success: boolean;
    error: string;
    alertId?: undefined;
    message?: undefined;
    resolvedBy?: undefined;
    resolution?: undefined;
    resolvedAt?: undefined;
} | {
    success: boolean;
    error: string;
    alertId: string;
    message?: undefined;
    resolvedBy?: undefined;
    resolution?: undefined;
    resolvedAt?: undefined;
} | {
    success: boolean;
    message: string;
    alertId: string;
    resolvedBy: string;
    resolution: string | undefined;
    resolvedAt: string;
    error?: undefined;
} | {
    success: boolean;
    error: string;
    stats: {
        totalAlerts: number;
        alertsByLevel: {
            info: number;
            warning: number;
            critical: number;
        };
        alertsByType: {
            response_time: number;
            memory_usage: number;
            error_rate: number;
            throughput: number;
            database_performance: number;
            cache_performance: number;
        };
        recentAlerts: never[];
        averageResolutionTime: number;
        activeAlerts: number;
    };
}>;
//# sourceMappingURL=performance-alerts.d.ts.map