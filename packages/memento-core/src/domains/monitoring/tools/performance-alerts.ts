/**
 * 성능 알림 도구
 * 성능 알림 조회, 해결, 통계 확인을 위한 MCP 도구
 */

import type { ToolContext } from '../../../tools/types.js';
import type { PerformanceAlert } from '../services/performance-monitor.js';

const PUBLIC_ALERT_TYPES = [
  'response_time',
  'memory_usage',
  'error_rate',
  'throughput',
  'database_performance',
  'cache_performance',
  'cpu_usage',
] as const;

type PublicAlertType = typeof PUBLIC_ALERT_TYPES[number];

const INTERNAL_TO_PUBLIC_TYPE: Record<PerformanceAlert['type'], PublicAlertType> = {
  memory: 'memory_usage',
  cpu: 'cpu_usage',
  database: 'database_performance',
  query: 'response_time',
};

const PUBLIC_TO_INTERNAL_TYPE: Partial<Record<PublicAlertType, PerformanceAlert['type']>> = {
  memory_usage: 'memory',
  cpu_usage: 'cpu',
  database_performance: 'database',
  response_time: 'query',
};

const DEFAULT_METRIC: Record<PerformanceAlert['type'], string> = {
  memory: 'memory_usage_percent',
  cpu: 'cpu_usage_percent',
  database: 'database_size_mb',
  query: 'query_time_ms',
};

export const performanceAlertsTool = {
  name: 'performance_alerts',
  description: '성능 알림 정보를 조회하고 관리합니다',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['stats', 'list', 'search', 'resolve'],
        default: 'stats',
        description: '수행할 작업'
      },
      hours: {
        type: 'number',
        minimum: 1,
        maximum: 168,
        default: 24,
        description: '조회할 시간 범위 (시간 단위)'
      },
      level: {
        type: 'string',
        enum: ['info', 'warning', 'critical'],
        description: '알림 레벨 필터'
      },
      type: {
        type: 'string',
        enum: PUBLIC_ALERT_TYPES,
        description: '알림 타입 필터'
      },
      resolved: {
        type: 'boolean',
        description: '해결된 알림 포함 여부'
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        default: 50,
        description: '결과 제한 수'
      },
      alertId: {
        type: 'string',
        description: '해결할 알림 ID (resolve 작업시)'
      },
      resolvedBy: {
        type: 'string',
        default: 'system',
        description: '해결 처리자'
      },
      resolution: {
        type: 'string',
        description: '해결 사유'
      }
    },
    required: []
  }
};

export async function executePerformanceAlerts(args: Record<string, unknown>, context: ToolContext) {
  const action = args['action'] as string | undefined;
  const hours = args['hours'] as number | undefined;
  const level = args['level'] as string | undefined;
  const type = args['type'] as string | undefined;
  const resolved = args['resolved'] as boolean | undefined;
  const limit = args['limit'] as number | undefined;
  const alertId = args['alertId'] as string | undefined;
  const resolvedBy = args['resolvedBy'] as string | undefined;
  const resolution = args['resolution'] as string | undefined;
  
  try {
    // 성능 알림 서비스가 없으면 기본 응답
    if (!context.services.performanceMonitor) {
      return {
        success: false,
        error: 'Performance alert service not available',
        stats: {
          totalAlerts: 0,
          alertsByLevel: { info: 0, warning: 0, critical: 0 },
          alertsByType: createTypeBuckets(),
          recentAlerts: [],
          averageResolutionTime: 0,
          activeAlerts: 0
        }
      };
    }

    switch (action) {
      case 'stats':
        return await handleStats(context, hours ?? 24);

      case 'list':
        return await handleList(context, hours ?? 24, limit ?? 10);

      case 'search':
        return await handleSearch(context, { level, type, resolved, hours, limit });

      case 'resolve':
        return await handleResolve(context, alertId, resolvedBy ?? '', resolution);
      
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
  if (!context.services.performanceMonitor) {
    throw new Error('성능 알림 서비스가 초기화되지 않았습니다');
  }
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const alerts = context.services.performanceMonitor.getAllAlerts()
    .filter(alert => alert.timestamp.getTime() >= cutoff);
  const resolvedAlerts = alerts.filter(alert => alert.resolved && alert.resolvedAt);
  const alertsByLevel = {
    info: 0,
    warning: alerts.filter(alert => alert.severity === 'warning').length,
    critical: alerts.filter(alert => alert.severity === 'critical').length,
  };
  const alertsByType = createTypeBuckets();
  for (const alert of alerts) {
    alertsByType[INTERNAL_TO_PUBLIC_TYPE[alert.type]]++;
  }
  const recentAlerts = alerts
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 10);
  const averageResolutionTime = resolvedAlerts.length === 0
    ? 0
    : resolvedAlerts.reduce(
      (sum, alert) => sum + alert.resolvedAt!.getTime() - alert.timestamp.getTime(),
      0
    ) / resolvedAlerts.length;
  const stats = {
    totalAlerts: alerts.length,
    alertsByLevel,
    alertsByType,
    recentAlerts,
    averageResolutionTime,
    activeAlerts: alerts.filter(alert => !alert.resolved).length,
  };
  
  return {
    success: true,
    stats: {
      ...stats,
      recentAlerts: stats.recentAlerts.map(serializeRecentAlert)
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
  if (!context.services.performanceMonitor) {
    throw new Error('성능 알림 서비스가 초기화되지 않았습니다');
  }
  const activeAlerts = context.services.performanceMonitor.getActiveAlerts();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const recentAlerts = context.services.performanceMonitor.getAllAlerts()
    .filter(alert => alert.timestamp.getTime() >= cutoff)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);

  return {
    success: true,
    activeAlerts: activeAlerts.map(serializeActiveAlert),
    recentAlerts: recentAlerts.map(serializeRecentAlert)
  };
}

async function handleSearch(context: ToolContext, filters: Record<string, unknown>) {
  if (!context.services.performanceMonitor) {
    throw new Error('성능 알림 서비스가 초기화되지 않았습니다');
  }
  const cutoff = typeof filters.hours === 'number'
    ? Date.now() - filters.hours * 60 * 60 * 1000
    : undefined;
  const internalType = typeof filters.type === 'string'
    ? PUBLIC_TO_INTERNAL_TYPE[filters.type as PublicAlertType]
    : undefined;
  const hasUnsupportedType = filters.type !== undefined && internalType === undefined;
  const alerts = context.services.performanceMonitor.getAllAlerts()
    .filter(alert => filters.level === undefined || alert.severity === filters.level)
    .filter(alert => !hasUnsupportedType && (internalType === undefined || alert.type === internalType))
    .filter(alert => filters.resolved === undefined || alert.resolved === filters.resolved)
    .filter(alert => cutoff === undefined || alert.timestamp.getTime() >= cutoff)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, typeof filters.limit === 'number' ? filters.limit : undefined);

  return {
    success: true,
    alerts: alerts.map(serializeSearchAlert),
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

  if (!context.services.performanceMonitor) {
    throw new Error('성능 알림 서비스가 초기화되지 않았습니다');
  }

  const success = context.services.performanceMonitor.resolveAlert(alertId, resolvedBy, resolution);
  
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

function serializeBaseAlert(alert: PerformanceAlert) {
  return {
    id: alert.id,
    timestamp: alert.timestamp.toISOString(),
    level: alert.severity,
    type: INTERNAL_TO_PUBLIC_TYPE[alert.type],
    metric: alert.metric ?? DEFAULT_METRIC[alert.type],
    value: alert.value,
    threshold: alert.threshold,
    message: alert.message,
  };
}

function serializeActiveAlert(alert: PerformanceAlert) {
  return {
    ...serializeBaseAlert(alert),
    context: alert.context ?? {},
  };
}

function serializeRecentAlert(alert: PerformanceAlert) {
  return {
    ...serializeBaseAlert(alert),
    resolved: alert.resolved,
    resolvedAt: alert.resolvedAt?.toISOString(),
  };
}

function serializeSearchAlert(alert: PerformanceAlert) {
  return {
    ...serializeBaseAlert(alert),
    context: alert.context ?? {},
    resolved: alert.resolved,
    resolvedAt: alert.resolvedAt?.toISOString(),
  };
}

function createTypeBuckets(): Record<PublicAlertType, number> {
  return Object.fromEntries(PUBLIC_ALERT_TYPES.map(type => [type, 0])) as Record<PublicAlertType, number>;
}
