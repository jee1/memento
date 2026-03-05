/**
 * Clear Anchor Tool - 앵커 제거 도구
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';

const ClearAnchorSchema = z.object({
  slot: z.enum(['A', 'B', 'C']).optional(),
  agent_id: z.string().optional().default('default')
});

export class ClearAnchorTool extends BaseTool {
  constructor() {
    super(
      'clear_anchor',
      '설정된 앵커를 제거합니다',
      {
        type: 'object',
        properties: {
          slot: {
            type: 'string',
            enum: ['A', 'B', 'C'],
            description: '제거할 슬롯 (지정하지 않으면 모든 슬롯 제거)'
          },
          agent_id: {
            type: 'string',
            description: '에이전트 ID (기본값: "default")',
            default: 'default'
          }
        },
        required: []
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      // 파라미터 검증
      const { slot, agent_id } = ClearAnchorSchema.parse(params);
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);
      
      // AnchorManager 서비스 확인
      this.validateService(context.services.anchorManager, '앵커 관리자');
      
      // 앵커 제거
      await context.services.anchorManager!.clearAnchor(agent_id, slot);
      
      if (slot) {
        return this.createSuccessResult({
          success: true,
          agent_id,
          slot,
          message: `앵커가 제거되었습니다: ${agent_id}/${slot}`
        });
      } else {
        return this.createSuccessResult({
          success: true,
          agent_id,
          message: `모든 앵커가 제거되었습니다: ${agent_id}`
        });
      }
    } catch (error) {
      this.logError(error as Error, '앵커 제거 실패', { params });
      
      if (error instanceof z.ZodError) {
        throw new Error(`입력 검증 실패: ${error.errors.map(e => e.message).join(', ')}`);
      }
      
      throw error;
    }
  }
}

