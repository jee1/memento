/**
 * Get Introspection Summary Tool (Issue #21 Phase B)
 *
 * 캐시된 최근 메타-기억 인트로스펙션 스캔 결과(저신뢰·고실패 요약 및 ID 목록)를 반환합니다.
 * meta_memory_introspection job 실행 후에만 데이터가 채워집니다.
 */

import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext } from '../../../tools/types.js';

const GetIntrospectionSummarySchema = { type: 'object' as const, properties: {} };

export class GetIntrospectionSummaryTool extends BaseTool {
  constructor() {
    super(
      'get_introspection_summary',
      '기억 품질 인트로스펙션 요약을 반환합니다. 저신뢰·고실패 메모리 건수와 ID 목록, 스캔 시각을 제공합니다. recall 또는 get_meta_memory_stats 응답에 introspection_hint가 있을 때 상세 조회용으로 호출하세요.',
      GetIntrospectionSummarySchema
    );
  }

  async handle(_params: unknown, context: ToolContext): Promise<ReturnType<BaseTool['createSuccessResult']>> {
    const cached = context.services?.introspectionScanCache?.get();
    if (!cached) {
      return this.createSuccessResult({
        summary: '스캔 결과가 없습니다. meta_memory_introspection job이 실행된 후 다시 시도하세요.',
        lowConfidenceMemoryIds: [],
        highFailureMemoryIds: [],
        scanned_at: null
      });
    }
    return this.createSuccessResult({
      summary: cached.result.summary,
      lowConfidenceMemoryIds: cached.result.lowConfidenceMemoryIds,
      highFailureMemoryIds: cached.result.highFailureMemoryIds,
      scanned_at: cached.scanned_at
    });
  }
}
