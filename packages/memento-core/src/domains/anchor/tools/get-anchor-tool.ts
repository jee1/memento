/**
 * Get Anchor Tool - 앵커 조회 도구
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';

const GetAnchorSchema = z.object({
  slot: z.enum(['A', 'B', 'C']).optional(),
  agent_id: z.string().optional().default('default')
});

export class GetAnchorTool extends BaseTool {
  constructor() {
    super(
      'get_anchor',
      '현재 설정된 앵커를 조회합니다',
      {
        type: 'object',
        properties: {
          slot: {
            type: 'string',
            enum: ['A', 'B', 'C'],
            description: '조회할 슬롯 (지정하지 않으면 모든 슬롯 반환)'
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

  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    try {
      // 파라미터 검증
      const { slot, agent_id } = GetAnchorSchema.parse(params);
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);
      
      // AnchorManager 서비스 확인
      this.validateService(context.services.anchorManager, '앵커 관리자');
      
      // 앵커 조회
      const anchor = await context.services.anchorManager!.getAnchor(agent_id, slot);
      
      if (slot) {
        // 특정 슬롯 조회
        if (!anchor || Array.isArray(anchor)) {
          return this.createSuccessResult({
            agent_id,
            slot,
            anchor: null,
            message: `앵커가 설정되지 않았습니다: ${agent_id}/${slot}`
          });
        }
        
        return this.createSuccessResult({
          agent_id,
          slot,
          anchor: {
            memory_id: anchor.memory_id,
            created_at: anchor.created_at,
            updated_at: anchor.updated_at
          }
        });
      } else {
        // 모든 슬롯 조회
        if (!Array.isArray(anchor)) {
          // 단일 앵커 반환 (이상한 경우)
          return this.createSuccessResult({
            agent_id,
            anchors: {
              A: null,
              B: null,
              C: null
            }
          });
        }
        
        return this.createSuccessResult({
          agent_id,
          anchors: {
            A: anchor.find(a => a.slot === 'A') || null,
            B: anchor.find(a => a.slot === 'B') || null,
            C: anchor.find(a => a.slot === 'C') || null
          }
        });
      }
    } catch (error) {
      this.logError(error as Error, '앵커 조회 실패', { params });
      
      if (error instanceof z.ZodError) {
        throw new Error(`입력 검증 실패: ${error.errors.map(e => e.message).join(', ')}`);
      }
      
      throw error;
    }
  }
}

