/**
 * Procedural Diff Tool - 두 procedural 메모리의 구조화 diff 조회 (Issue #57 Phase 2)
 */

import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { computeProceduralDiff } from './procedural-memory-diff.js';

export class ProceduralDiffTool extends BaseTool {
  constructor() {
    super(
      'procedural_diff',
      '두 procedural 메모리(버전) 간 필드별 차이를 구조화된 형태로 반환합니다.',
      {
        type: 'object',
        properties: {
          left_id: {
            type: 'string',
            description: '비교할 첫 번째 메모리 ID (procedural)',
          },
          right_id: {
            type: 'string',
            description: '비교할 두 번째 메모리 ID (procedural)',
          },
        },
        required: ['left_id', 'right_id'],
      }
    );
  }

  /**
   * Given: left_id, right_id, context(db).
   * When: handle 호출.
   * Then: ProceduralDiffResult 반환. id 없거나 procedural이 아니면 400 에러.
   */
  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { left_id, right_id } = params as { left_id?: string; right_id?: string };
    if (!left_id || !right_id) {
      return this.createErrorResult('invalid_params', 'left_id와 right_id는 필수입니다.');
    }
    if (!context.db) {
      return this.createErrorResult('database_unavailable', '데이터베이스를 사용할 수 없습니다.');
    }

    const diff = computeProceduralDiff(context.db, left_id, right_id);
    if (diff === null) {
      return this.createErrorResult(
        'not_found_or_not_procedural',
        '두 ID 중 하나가 없거나 procedural 타입이 아닙니다.'
      );
    }
    return this.createSuccessResult(diff);
  }
}
