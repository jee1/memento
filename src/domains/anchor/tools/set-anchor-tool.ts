/**
 * Set Anchor Tool - 앵커 설정 도구
 */

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';

const SetAnchorSchema = z.object({
  memory_id: z.string().min(1, 'Memory ID cannot be empty'),
  slot: z.enum(['A', 'B', 'C'], {
    errorMap: () => ({ message: 'Slot must be A, B, or C' })
  }),
  agent_id: z.string().optional().default('default')
});

export class SetAnchorTool extends BaseTool {
  constructor() {
    super(
      'set_anchor',
      '특정 메모리를 앵커로 설정합니다',
      {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: '앵커로 설정할 메모리 ID'
          },
          slot: {
            type: 'string',
            enum: ['A', 'B', 'C'],
            description: '앵커 슬롯 (A: 즉시 컨텍스트, B: 보조 컨텍스트, C: 확장 컨텍스트)'
          },
          agent_id: {
            type: 'string',
            description: '에이전트 ID (기본값: "default")',
            default: 'default'
          }
        },
        required: ['memory_id', 'slot']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      // 파라미터 검증
      const { memory_id, slot, agent_id } = SetAnchorSchema.parse(params);
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);
      
      // AnchorManager 서비스 확인
      this.validateService(context.services.anchorManager, '앵커 관리자');
      
      // 메모리 존재 확인
      const memory = context.db!.prepare(`
        SELECT id FROM memory_item WHERE id = ?
      `).get(memory_id) as { id: string } | undefined;
      
      if (!memory) {
        throw new Error(`메모리를 찾을 수 없습니다: ${memory_id}`);
      }
      
      // 앵커 설정
      await context.services.anchorManager!.setAnchor(agent_id, memory_id, slot);
      
      return this.createSuccessResult({
        success: true,
        agent_id,
        slot,
        memory_id,
        message: `앵커가 설정되었습니다: ${agent_id}/${slot} -> ${memory_id}`
      });
    } catch (error) {
      this.logError(error as Error, '앵커 설정 실패', { params });
      
      if (error instanceof z.ZodError) {
        throw new Error(`입력 검증 실패: ${error.errors.map(e => e.message).join(', ')}`);
      }
      
      throw error;
    }
  }
}

