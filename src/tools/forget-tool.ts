/**
 * Forget Tool - 기억 삭제 도구
 */

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';
import { CommonSchemas } from './types.js';
import { DatabaseUtils } from '../utils/database.js';

const ForgetSchema = z.object({
  id: CommonSchemas.MemoryId,
  hard: CommonSchemas.HardDelete,
});

export class ForgetTool extends BaseTool {
  constructor() {
    super(
      'forget',
      '기억을 삭제합니다',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: '삭제할 기억의 ID' },
          hard: { type: 'boolean', description: '완전 삭제 여부', default: false }
        },
        required: ['id']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    const { id, hard } = ForgetSchema.parse(params);
    
    // 데이터베이스 연결 확인
    this.validateDatabase(context);
    
    try {
      // 개선된 트랜잭션 재시도 로직 사용
      const result = await DatabaseUtils.runTransaction(context.db!, async () => {
        if (hard) {
          // 하드 삭제
          const deleteResult = await DatabaseUtils.run(context.db!, 'DELETE FROM memory_item WHERE id = ?', [id]);
          
          if (deleteResult.changes === 0) {
            throw new Error(`Memory with ID ${id} not found`);
          }
          
          return { type: 'hard', changes: deleteResult.changes };
        } else {
          // 소프트 삭제 (pinned 해제 후 TTL에 의해 삭제)
          const updateResult = await DatabaseUtils.run(context.db!, 'UPDATE memory_item SET pinned = FALSE WHERE id = ?', [id]);
          
          if (updateResult.changes === 0) {
            throw new Error(`Memory with ID ${id} not found`);
          }
          
          return { type: 'soft', changes: updateResult.changes };
        }
      });
      
      // 임베딩도 삭제 (하드 삭제인 경우)
      if (hard && context.services.embeddingService?.isAvailable()) {
        try {
          await context.services.embeddingService.deleteEmbedding(context.db, id);
        } catch (embeddingError) {
          console.warn(`⚠️ 임베딩 삭제 실패 (${id}):`, embeddingError);
        }
      }
      
      return this.createSuccessResult({
        memory_id: id,
        message: hard ? `기억이 완전히 삭제되었습니다: ${id}` : `기억이 삭제 대상으로 표시되었습니다: ${id}`
      });
    } catch (error) {
      // 데이터베이스 락 문제인 경우 WAL 체크포인트 시도
      if ((error as any).code === 'SQLITE_BUSY') {
        try {
          await DatabaseUtils.checkpointWAL(context.db);
        } catch (checkpointError) {
          // WAL 체크포인트 실패
        }
      }
      throw error;
    }
  }
}
