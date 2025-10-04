/**
 * Pin Tool - 기억 고정 도구
 * 중요한 기억을 고정하여 삭제로부터 보호
 */

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';
import { CommonSchemas } from './types.js';
import { DatabaseUtils } from '../utils/database.js';

const PinSchema = z.object({
  id: CommonSchemas.MemoryId.optional(),
  reason: z.string().optional().describe('고정 사유'),
  priority: z.number().min(1).max(5).optional().describe('우선순위 (1-5)'),
  batch: z.array(z.string()).optional().describe('배치 고정할 ID 목록')
}).refine((data) => data.id || data.batch, {
  message: "id 또는 batch 중 하나는 필수입니다"
});

export class PinTool extends BaseTool {
  constructor() {
    super(
      'pin',
      '기억을 고정합니다',
      {
        type: 'object',
        properties: {
          id: { 
            type: 'string', 
            description: '고정할 기억의 ID (배치 고정시 무시됨)',
            pattern: '^mem_[a-zA-Z0-9_]+$'
          },
          reason: {
            type: 'string',
            description: '고정 사유',
            maxLength: 500
          },
          priority: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            description: '우선순위 (1-5)',
            default: 3
          },
          batch: {
            type: 'array',
            items: { 
              type: 'string',
              pattern: '^mem_[a-zA-Z0-9_]+$'
            },
            description: '배치 고정할 ID 목록',
            maxItems: 100
          }
        },
        required: ['id']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    const { id, reason, priority = 3, batch } = PinSchema.parse(params);
    
    // 데이터베이스 연결 확인
    this.validateDatabase(context);
    
    // 배치 고정 처리
    if (batch && batch.length > 0) {
      return await this.handleBatchPin(batch, reason, priority, context);
    }
    
    // 단일 고정 처리
    return await this.handleSinglePin(id, reason, priority, context);
  }

  /**
   * 단일 기억 고정
   */
  private async handleSinglePin(
    id: string, 
    reason: string | undefined, 
    priority: number, 
    context: ToolContext
  ): Promise<ToolResult> {
    try {
      // 기억 존재 확인
      const memory = await this.getMemoryById(id, context);
      if (!memory) {
        throw new Error(`Memory with ID ${id} not found`);
      }
      
      // 이미 고정된 기억 확인
      if (memory.pinned) {
        return this.createSuccessResult({
          memory_id: id,
          message: `기억이 이미 고정되어 있습니다: ${id}`,
          already_pinned: true
        });
      }
      
      // 고정 로그 기록
      await this.logPinAction(id, reason, priority, context);
      
      // 트랜잭션으로 고정 실행
      await DatabaseUtils.runTransaction(context.db!, async () => {
        const result = await DatabaseUtils.run(
          context.db!, 
          'UPDATE memory_item SET pinned = TRUE, last_accessed = CURRENT_TIMESTAMP WHERE id = ?', 
          [id]
        );
        
        if (result.changes === 0) {
          throw new Error(`Memory with ID ${id} not found`);
        }
        
        return result;
      });
      
      return this.createSuccessResult({
        memory_id: id,
        message: `기억이 고정되었습니다: ${id}`,
        reason: reason || 'No reason provided',
        priority,
        pinned_at: new Date().toISOString()
      });
      
    } catch (error) {
      // 데이터베이스 락 문제 처리
      if ((error as any).code === 'SQLITE_BUSY') {
        await this.handleDatabaseLock(context);
      }
      throw error;
    }
  }

  /**
   * 배치 고정 처리
   */
  private async handleBatchPin(
    ids: string[], 
    reason: string | undefined, 
    priority: number, 
    context: ToolContext
  ): Promise<ToolResult> {
    const results = {
      successful: [] as string[],
      failed: [] as Array<{id: string, error: string}>,
      already_pinned: [] as string[],
      total: ids.length
    };
    
    for (const id of ids) {
      try {
        const memory = await this.getMemoryById(id, context);
        if (!memory) {
          results.failed.push({ id, error: 'Memory not found' });
          continue;
        }
        
        if (memory.pinned) {
          results.already_pinned.push(id);
          continue;
        }
        
        await this.handleSinglePin(id, reason, priority, context);
        results.successful.push(id);
      } catch (error) {
        results.failed.push({
          id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return this.createSuccessResult({
      batch_result: results,
      message: `배치 고정 완료: ${results.successful.length}/${results.total} 성공`,
      reason: reason || 'Batch pinning',
      priority
    });
  }

  /**
   * 기억 조회
   */
  private async getMemoryById(id: string, context: ToolContext): Promise<any> {
    return await DatabaseUtils.get(
      context.db!, 
      'SELECT * FROM memory_item WHERE id = ?', 
      [id]
    );
  }

  /**
   * 고정 로그 기록
   */
  private async logPinAction(
    id: string, 
    reason: string | undefined, 
    priority: number, 
    context: ToolContext
  ): Promise<void> {
    try {
      await DatabaseUtils.run(
        context.db!,
        `INSERT INTO feedback_event (memory_id, event, score, created_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, 'helpful', priority]
      );
    } catch (error) {
      console.warn('고정 로그 기록 실패:', error);
    }
  }

  /**
   * 데이터베이스 락 처리
   */
  private async handleDatabaseLock(context: ToolContext): Promise<void> {
    try {
      await DatabaseUtils.checkpointWAL(context.db);
      console.log('WAL 체크포인트 완료');
    } catch (error) {
      console.warn('WAL 체크포인트 실패:', error);
    }
  }

  /**
   * 고정된 기억 목록 조회
   */
  async getPinnedMemories(context: ToolContext, limit: number = 50): Promise<any[]> {
    this.validateDatabase(context);
    
    return await DatabaseUtils.all(
      context.db!,
      `SELECT id, content, type, importance, created_at, last_accessed 
       FROM memory_item 
       WHERE pinned = TRUE 
       ORDER BY importance DESC, created_at DESC 
       LIMIT ?`,
      [limit]
    );
  }

  /**
   * 고정 통계 조회
   */
  async getPinStats(context: ToolContext): Promise<any> {
    this.validateDatabase(context);
    
    const stats = await DatabaseUtils.get(
      context.db!,
      `SELECT 
         COUNT(*) as total_memories,
         COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_count,
         COUNT(CASE WHEN pinned = FALSE THEN 1 END) as unpinned_count,
         AVG(importance) as avg_importance
       FROM memory_item`
    );
    
    const recentPins = await DatabaseUtils.all(
      context.db!,
      `SELECT memory_id, event, score, created_at 
       FROM feedback_event 
       WHERE event = 'pinned' 
       ORDER BY created_at DESC 
       LIMIT 10`
    );
    
    return {
      ...stats,
      recent_pins: recentPins
    };
  }
}