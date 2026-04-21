/**
 * Performance Stats Tool - 성능 통계 도구
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext,ToolResult } from '../../../tools/types.js';

const _PerformanceStatsSchema = z.object({});

export class PerformanceStatsTool extends BaseTool {
  constructor() {
    super(
      'performance_stats',
      '성능 통계를 조회합니다',
      {
        type: 'object',
        properties: {}
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    // 데이터베이스 연결 확인
    this.validateDatabase(context);
    
    // 성능 모니터 확인
    this.validateService(context.services.performanceMonitor, '성능 모니터');
    
    try {
      const metrics = await context.services.performanceMonitor.collectMetrics();
      // generateReport 메서드가 없으므로 metrics만 사용
      
      return this.createSuccessResult({
        metrics: {
          database: metrics.database,
          search: metrics.search,
          memory: metrics.memory,
          system: metrics.system
        },
        message: '성능 통계 조회 완료'
      });
    } catch (error) {
      throw new Error(`성능 통계 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
