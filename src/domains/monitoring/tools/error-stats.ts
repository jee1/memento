/**
 * 에러 통계 도구
 * 에러 로깅 서비스의 통계 정보를 조회하는 MCP 도구
 */

import { z } from 'zod';
import type { ToolContext } from './types.js';

export const errorStatsTool = {
  name: 'error_stats',
  description: '에러 통계 및 로그 정보를 조회합니다',
  inputSchema: {
    type: 'object',
    properties: {
      hours: {
        type: 'number',
        minimum: 1,
        maximum: 168,
        default: 24,
        description: '조회할 시간 범위 (시간 단위, 1-168)'
      },
      severity: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: '심각도 필터'
      },
      category: {
        type: 'string',
        enum: ['database', 'network', 'validation', 'authentication', 'performance', 'memory', 'search', 'embedding', 'cache', 'unknown'],
        description: '카테고리 필터'
      },
      includeResolved: {
        type: 'boolean',
        default: false,
        description: '해결된 에러 포함 여부'
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        default: 50,
        description: '결과 제한 수'
      }
    },
    required: []
  }
};

export async function executeErrorStats(args: any, context: ToolContext) {
  const { hours, severity, category, includeResolved, limit } = args;
  
  try {
    // 에러 로깅 서비스가 없으면 기본 응답
    if (!context.services.errorLoggingService) {
      return {
        success: false,
        error: 'Error logging service not available',
        stats: {
          totalErrors: 0,
          errorsBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
          errorsByCategory: { database: 0, network: 0, validation: 0, authentication: 0, performance: 0, memory: 0, search: 0, embedding: 0, cache: 0, unknown: 0 },
          errorsByHour: {},
          averageResolutionTime: 0,
          criticalErrors: 0,
          recentErrors: []
        }
      };
    }

    const stats = context.services.errorLoggingService.getErrorStats(hours);
    const alerts = context.services.errorLoggingService.getActiveAlerts();
    
    // 필터링된 에러 검색
    const searchFilters: any = {};
    if (severity) searchFilters.severity = severity;
    if (category) searchFilters.category = category;
    if (includeResolved !== undefined) searchFilters.resolved = includeResolved;
    searchFilters.limit = limit;
    
    const filteredErrors = context.services.errorLoggingService.searchErrors(searchFilters);

    return {
      success: true,
      stats: {
        ...stats,
        filteredErrors: filteredErrors.map((error: any) => ({
          id: error.id,
          timestamp: error.timestamp.toISOString(),
          severity: error.severity,
          category: error.category,
          message: error.message,
          component: error.context.component,
          resolved: error.resolved,
          resolvedAt: error.resolvedAt?.toISOString()
        }))
      },
      alerts: alerts.map((alert: any) => ({
        id: alert.id,
        errorId: alert.errorId,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp.toISOString(),
        acknowledged: alert.acknowledged
      })),
      summary: {
        totalErrors: stats.totalErrors,
        criticalErrors: stats.criticalErrors,
        activeAlerts: alerts.length,
        averageResolutionTime: Math.round(stats.averageResolutionTime / 1000) // 초 단위로 변환
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stats: null
    };
  }
}
