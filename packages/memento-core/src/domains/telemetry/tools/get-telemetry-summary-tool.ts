/**
 * get_telemetry_summary MCP 도구 (specs/007-telemetry-cli-mcp)
 *
 * 에이전트가 자신의 검색 품질·메모리 품질 지표를 조회합니다.
 * ALS context에서 ownerId를 자동으로 추출합니다.
 */

import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import type { TelemetryPeriod } from '../types/telemetry.types.js';

const ALLOWED_PERIODS: TelemetryPeriod[] = ['24h', '7d', '30d'];

const GetTelemetrySummarySchema = {
  type: 'object' as const,
  properties: {
    period: {
      type: 'string',
      enum: ['24h', '7d', '30d'],
      description: '조회 기간 (기본값: 24h)',
    },
  },
  required: [],
};

export class GetTelemetrySummaryTool extends BaseTool {
  constructor() {
    super(
      'get_telemetry_summary',
      '현재 에이전트(또는 글로벌)의 검색 품질·메모리 품질 텔레메트리 지표를 반환합니다. period로 조회 기간(24h/7d/30d)을 선택할 수 있습니다.',
      GetTelemetrySummarySchema
    );
  }

  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    // period 파싱 및 유효성 검증
    const rawPeriod =
      params && typeof params === 'object' && !Array.isArray(params)
        ? (params as Record<string, unknown>).period
        : undefined;

    const period: TelemetryPeriod = (rawPeriod as TelemetryPeriod) ?? '24h';

    if (rawPeriod !== undefined && !ALLOWED_PERIODS.includes(rawPeriod as TelemetryPeriod)) {
      return this.createErrorResult('Invalid period. Allowed: 24h, 7d, 30d');
    }

    // ALS context에서 ownerId 추출
    const ownerId = context.services?.telemetryService?.getContext()?.ownerId ?? null;

    try {
      const telemetryService = context.services?.telemetryService;
      if (!telemetryService) {
        return this.createErrorResult('TelemetryService가 초기화되지 않았습니다');
      }

      const searchResult = telemetryService.getSearchQuality(period, ownerId);
      const memoryResult = telemetryService.getMemoryQuality(ownerId);
      const consolidationQuality = telemetryService.getConsolidationQuality(ownerId);

      const result = {
        period,
        owner_id: ownerId,
        search_quality: {
          search_count: searchResult.search_count,
          avg_latency_ms: searchResult.avg_latency_ms,
          p95_latency_ms: searchResult.p95_latency_ms,
          empty_retrieval_rate: searchResult.empty_retrieval_rate,
          avg_candidate_count: searchResult.avg_candidate_count,
          top_k_selected_rate: searchResult.top_k_selected_rate,
        },
        memory_quality: {
          total_memories: memoryResult.total_memories,
          type_distribution: memoryResult.type_distribution,
          duplicate_write_rate_24h: memoryResult.duplicate_write_rate_24h,
          relation_coverage_ratio: memoryResult.relation_coverage_ratio,
          orphan_memory_ratio: memoryResult.orphan_memory_ratio,
        },
        consolidation_quality: {
          episodic_consolidation_rate: consolidationQuality.episodic_consolidation_rate,
          triple_extraction_success_rate: consolidationQuality.triple_extraction_success_rate,
          cluster_processing_efficiency: consolidationQuality.cluster_processing_efficiency,
          recent_semantic_count_7d: consolidationQuality.recent_semantic_count_7d,
          pipeline_error_count: consolidationQuality.pipeline_error_count,
        },
        timestamp: new Date().toISOString(),
      };

      return this.createSuccessResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.createErrorResult(message);
    }
  }
}
