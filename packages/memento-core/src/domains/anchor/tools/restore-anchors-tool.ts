/**
 * Restore Anchors Tool - 앵커 복원 도구
 * 데이터베이스에서 앵커 상태를 메모리 캐시로 복원
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';

const RestoreAnchorsSchema = z.object({
  agent_id: z.string().optional()
});

export class RestoreAnchorsTool extends BaseTool {
  constructor() {
    super(
      'restore_anchors',
      '데이터베이스에서 앵커 상태를 메모리 캐시로 복원합니다',
      {
        type: 'object',
        properties: {
          agent_id: {
            type: 'string',
            description: '복원할 에이전트 ID (지정하지 않으면 모든 에이전트의 앵커 복원)',
            default: undefined
          }
        },
        required: []
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      // 파라미터 검증
      const { agent_id } = RestoreAnchorsSchema.parse(params);
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);
      
      // AnchorManager 서비스 확인
      this.validateService(context.services.anchorManager, '앵커 관리자');
      
      // 앵커 복원
      // 현재 restoreCacheFromDB는 모든 agent_id를 복원하므로
      // agent_id 파라미터는 무시됩니다 (향후 특정 agent_id만 복원하는 기능 추가 가능)
      await context.services.anchorManager!.restoreCacheFromDB(context.db!);
      
      // 복원된 앵커 정보 조회
      const restoredAnchors: any = {};
      
      if (agent_id) {
        // 특정 agent_id의 앵커만 조회
        const anchors = await context.services.anchorManager!.getAnchor(agent_id);
        if (Array.isArray(anchors)) {
          restoredAnchors[agent_id] = {
            A: anchors.find(a => a.slot === 'A') || null,
            B: anchors.find(a => a.slot === 'B') || null,
            C: anchors.find(a => a.slot === 'C') || null
          };
        } else if (anchors) {
          restoredAnchors[agent_id] = {
            A: anchors.slot === 'A' ? anchors : null,
            B: anchors.slot === 'B' ? anchors : null,
            C: anchors.slot === 'C' ? anchors : null
          };
        } else {
          restoredAnchors[agent_id] = {
            A: null,
            B: null,
            C: null
          };
        }
      } else {
        // 모든 agent_id의 앵커 조회
        // DB에서 직접 조회하여 agent_id 목록 가져오기
        const agentIds = context.db!.prepare(`
          SELECT DISTINCT agent_id FROM anchor
        `).all() as Array<{ agent_id: string }>;
        
        for (const { agent_id: id } of agentIds) {
          const anchors = await context.services.anchorManager!.getAnchor(id);
          if (Array.isArray(anchors)) {
            restoredAnchors[id] = {
              A: anchors.find(a => a.slot === 'A') || null,
              B: anchors.find(a => a.slot === 'B') || null,
              C: anchors.find(a => a.slot === 'C') || null
            };
          } else if (anchors) {
            restoredAnchors[id] = {
              A: anchors.slot === 'A' ? anchors : null,
              B: anchors.slot === 'B' ? anchors : null,
              C: anchors.slot === 'C' ? anchors : null
            };
          } else {
            restoredAnchors[id] = {
              A: null,
              B: null,
              C: null
            };
          }
        }
      }
      
      const agentCount = Object.keys(restoredAnchors).length;
      const totalAnchors = Object.values(restoredAnchors).reduce((sum: number, anchors: any) => {
        return sum + (anchors.A ? 1 : 0) + (anchors.B ? 1 : 0) + (anchors.C ? 1 : 0);
      }, 0);
      
      return this.createSuccessResult({
        success: true,
        restored_anchors: restoredAnchors,
        agent_count: agentCount,
        total_anchors: totalAnchors,
        message: agent_id 
          ? `앵커가 복원되었습니다: ${agent_id} (${totalAnchors}개 슬롯)`
          : `모든 앵커가 복원되었습니다: ${agentCount}개 에이전트, ${totalAnchors}개 슬롯`
      });
    } catch (error) {
      this.logError(error as Error, '앵커 복원 실패', { params });
      
      if (error instanceof z.ZodError) {
        throw new Error(`입력 검증 실패: ${error.errors.map(e => e.message).join(', ')}`);
      }
      
      throw error;
    }
  }
}

