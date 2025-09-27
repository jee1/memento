/**
 * 성능 알림 도구
 * 성능 알림 조회, 해결, 통계 확인을 위한 MCP 도구
 */

import { z } from 'zod';
import type { ToolContext } from './types.js';

export const performanceAlertsTool = {
  name: 'performance_alerts',
  description: '성능 알림 정보를 조회하고 관리합니다',
  inputSchema: z.object({
    action: z.enum(['stats', 'list', 'search', 'resolve']).default('stats').describe('수행할 작업'),
    hours: z.number().min(1).max(168).default(24).describe('조회할 시간 범위 (시간 단위)'),
    level: z.enum(['info', 'warning', 'critical']).optional().describe('알림 레벨 필터'),
    type: z.enum(['response_time', 'memory_usage', 'error_rate', 'throughput', 'database_performance', 'cache_performance']).optional().describe('알림 타입 필터'),
    resolved: z.boolean().optional().describe('해결된 알림 포함 여부'),
    limit: z.number().min(1).max(100).default(50).describe('결과 제한 수'),
    alertId: z.string().optional().describe('해결할 알림 ID (resolve 작업시)'),
    resolvedBy: z.string().default('system').describe('해결 처리자'),
    resolution: z.string().optional().describe('해결 사유')
  })
};

export async function executePerformanceAlerts(args: any, context: ToolContext) {
  const { action, hours, level, type, resolved, limit, alertId, resolvedBy, resolution } = args;
  
  try {
    // 성능 알림 서비스가 없으면 기본 응답
    if (!context.services.performanceAlertService) {
      return {
        success: false,
        error: 'Performance alert service not available',
        stats: {
          totalAlerts: 0,
          alertsByLevel: { info: 0, warning: 0, critical: 0 },
          alertsByType: { response_time: 0, memory_usage: 0, error_rate: 0, throughput: 0, database_performance: 0, cache_performance: 0 },
          recentAlerts: [],
          averageResolutionTime: 0,
          activeAlerts: 0
        }
      };
    }

    switch (action) {
      case 'stats':
        return await handleStats(context, hours);
      
      case 'list':
        return await handleList(context, hours, limit);
      
      case 'search':
        return await handleSearch(context, { level, type, resolved, hours, limit });
      
      case 'resolve':
        return await handleResolve(context, alertId, resolvedBy, resolution);
      
      default:
        return {
          success: false,
          error: `Unknown action: ${action}`
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function handleStats(context: ToolContext, hours: number) {
  const stats = context.services.performanceAlertService.getAlertStats(hours);
  
  return {
    success: true,
    stats: {
      ...stats,
      recentAlerts: stats.recentAlerts.map((alert: any) => ({
        id: alert.id,
        timestamp: alert.timestamp.toISOString(),
        level: alert.level,
        type: alert.type,
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
        message: alert.message,
        resolved: alert.resolved,
        resolvedAt: alert.resolvedAt?.toISOString()
      }))
    },
    summary: {
      totalAlerts: stats.totalAlerts,
      activeAlerts: stats.activeAlerts,
      criticalAlerts: stats.alertsByLevel.critical,
      averageResolutionTime: Math.round(stats.averageResolutionTime / 1000) // 초 단위로 변환
    }
  };
}

async function handleList(context: ToolContext, hours: number, limit: number) {
  const activeAlerts = context.services.performanceAlertService.getActiveAlerts();
  const recentAlerts = context.services.performanceAlertService.searchAlerts({
    startDate: new Date(Date.now() - hours * 60 * 60 * 1000),
    limit
  });

  return {
    success: true,
    activeAlerts: activeAlerts.map((alert: any) => ({
      id: alert.id,
      timestamp: alert.timestamp.toISOString(),
      level: alert.level,
      type: alert.type,
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold,
      message: alert.message,
      context: alert.context
    })),
    recentAlerts: recentAlerts.map((alert: any) => ({
      id: alert.id,
      timestamp: alert.timestamp.toISOString(),
      level: alert.level,
      type: alert.type,
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold,
      message: alert.message,
      resolved: alert.resolved,
      resolvedAt: alert.resolvedAt?.toISOString()
    }))
  };
}

async function handleSearch(context: ToolContext, filters: any) {
  const alerts = context.services.performanceAlertService.searchAlerts(filters);

  return {
    success: true,
    alerts: alerts.map((alert: any) => ({
      id: alert.id,
      timestamp: alert.timestamp.toISOString(),
      level: alert.level,
      type: alert.type,
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold,
      message: alert.message,
      context: alert.context,
      resolved: alert.resolved,
      resolvedAt: alert.resolvedAt?.toISOString()
    })),
    total: alerts.length
  };
}

async function handleResolve(context: ToolContext, alertId: string | undefined, resolvedBy: string, resolution?: string) {
  if (!alertId) {
    return {
      success: false,
      error: 'Alert ID is required for resolve action'
    };
  }

  const success = context.services.performanceAlertService.resolveAlert(alertId, resolvedBy, resolution);
  
  if (!success) {
    return {
      success: false,
      error: 'Alert not found or already resolved',
      alertId
    };
  }

  return {
    success: true,
    message: `Alert ${alertId} has been resolved by ${resolvedBy}`,
    alertId,
    resolvedBy,
    resolution,
    resolvedAt: new Date().toISOString()
  };
}
