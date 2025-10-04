/**
 * Unpin Tool - 기억 고정 해제 도구
 * 고정된 기억의 고정을 해제하여 일반 관리 대상으로 변경
 */

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';
import { CommonSchemas } from './types.js';
import { DatabaseUtils } from '../utils/database.js';

const UnpinSchema = z.object({
  id: CommonSchemas.MemoryId.optional(),
  reason: z.string().optional().describe('고정 해제 사유'),
  batch: z.array(z.string()).optional().describe('배치 고정 해제할 ID 목록'),
  confirm: z.boolean().optional().describe('고정 해제 확인')
}).refine((data) => data.id || data.batch, {
  message: "id 또는 batch 중 하나는 필수입니다"
});

export class UnpinTool extends BaseTool {
  constructor() {
    super(
      'unpin',
      '기억 고정을 해제합니다',
      {
        type: 'object',
        properties: {
          id: { 
            type: 'string', 
            description: '고정 해제할 기억의 ID (배치 고정 해제시 무시됨)',
            pattern: '^mem_[a-zA-Z0-9_]+$'
          },
          reason: {
            type: 'string',
            description: '고정 해제 사유',
            maxLength: 500
          },
          batch: {
            type: 'array',
            items: { 
              type: 'string',
              pattern: '^mem_[a-zA-Z0-9_]+$'
            },
            description: '배치 고정 해제할 ID 목록',
            maxItems: 100
          },
          confirm: {
            type: 'boolean',
            description: '고정 해제 확인',
            default: false
          }
        },
        required: ['id']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    const { id, reason, batch, confirm = false } = UnpinSchema.parse(params);
    
    // 데이터베이스 연결 확인
    this.validateDatabase(context);
    
    // 배치 고정 해제 처리
    if (batch && batch.length > 0) {
      return await this.handleBatchUnpin(batch, reason, confirm, context);
    }
    
    // 단일 고정 해제 처리
    if (!id) {
      throw new Error('기억 ID가 필요합니다');
    }
    return await this.handleSingleUnpin(id, reason, confirm, context);
  }

  /**
   * 단일 기억 고정 해제
   */
  private async handleSingleUnpin(
    id: string, 
    reason: string | undefined, 
    confirm: boolean, 
    context: ToolContext
  ): Promise<ToolResult> {
    try {
      // 기억 존재 확인
      const memory = await this.getMemoryById(id, context);
      if (!memory) {
        throw new Error(`Memory with ID ${id} not found`);
      }
      
      // 이미 고정 해제된 기억 확인
      if (!memory.pinned) {
        return this.createSuccessResult({
          memory_id: id,
          message: `기억이 이미 고정 해제되어 있습니다: ${id}`,
          already_unpinned: true
        });
      }
      
      // 중요도가 높은 기억은 확인 필요
      if (memory.importance > 0.8 && !confirm) {
        throw new Error('높은 중요도의 기억은 confirm=true로 확인해야 합니다');
      }
      
      // 고정 해제 로그 기록
      await this.logUnpinAction(id, reason, context);
      
      // 트랜잭션으로 고정 해제 실행
      await DatabaseUtils.runTransaction(context.db!, async () => {
        const result = await DatabaseUtils.run(
          context.db!, 
          'UPDATE memory_item SET pinned = FALSE, last_accessed = CURRENT_TIMESTAMP WHERE id = ?', 
          [id]
        );
        
        if (result.changes === 0) {
          throw new Error(`Memory with ID ${id} not found`);
        }
        
        return result;
      });
      
      return this.createSuccessResult({
        memory_id: id,
        message: `기억 고정이 해제되었습니다: ${id}`,
        reason: reason || 'No reason provided',
        unpinned_at: new Date().toISOString(),
        importance: memory.importance
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
   * 배치 고정 해제 처리
   */
  private async handleBatchUnpin(
    ids: string[], 
    reason: string | undefined, 
    confirm: boolean, 
    context: ToolContext
  ): Promise<ToolResult> {
    const results = {
      successful: [] as string[],
      failed: [] as Array<{id: string, error: string}>,
      already_unpinned: [] as string[],
      requires_confirmation: [] as string[],
      total: ids.length
    };
    
    for (const id of ids) {
      try {
        const memory = await this.getMemoryById(id, context);
        if (!memory) {
          results.failed.push({ id, error: 'Memory not found' });
          continue;
        }
        
        if (!memory.pinned) {
          results.already_unpinned.push(id);
          continue;
        }
        
        // 중요도가 높은 기억은 확인 필요
        if (memory.importance > 0.8 && !confirm) {
          results.requires_confirmation.push(id);
          continue;
        }
        
        await this.handleSingleUnpin(id, reason, confirm, context);
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
      message: `배치 고정 해제 완료: ${results.successful.length}/${results.total} 성공`,
      reason: reason || 'Batch unpinning',
      requires_confirmation: results.requires_confirmation.length > 0
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
   * 고정 해제 로그 기록
   */
  private async logUnpinAction(
    id: string, 
    reason: string | undefined, 
    context: ToolContext
  ): Promise<void> {
    try {
      await DatabaseUtils.run(
        context.db!,
        `INSERT INTO feedback_event (memory_id, event, score, created_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, 'edited', 0]
      );
    } catch (error) {
      console.warn('고정 해제 로그 기록 실패:', error);
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
   * 고정 해제 가능한 기억 목록 조회
   */
  async getUnpinnableMemories(context: ToolContext, limit: number = 50): Promise<any[]> {
    this.validateDatabase(context);
    
    return await DatabaseUtils.all(
      context.db!,
      `SELECT id, content, type, importance, created_at, last_accessed 
       FROM memory_item 
       WHERE pinned = TRUE 
       ORDER BY importance ASC, created_at ASC 
       LIMIT ?`,
      [limit]
    );
  }

  /**
   * 고정 해제 통계 조회
   */
  async getUnpinStats(context: ToolContext): Promise<any> {
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
    
    const recentUnpins = await DatabaseUtils.all(
      context.db!,
      `SELECT memory_id, event, created_at 
       FROM feedback_event 
       WHERE event = 'unpinned' 
       ORDER BY created_at DESC 
       LIMIT 10`
    );
    
    return {
      ...stats,
      recent_unpins: recentUnpins
    };
  }

  /**
   * 고정 해제 권장 기억 조회
   */
  async getRecommendedUnpins(context: ToolContext, limit: number = 20): Promise<any[]> {
    this.validateDatabase(context);
    
    return await DatabaseUtils.all(
      context.db!,
      `SELECT id, content, type, importance, created_at, last_accessed,
              (julianday('now') - julianday(created_at)) as days_old
       FROM memory_item 
       WHERE pinned = TRUE 
         AND importance < 0.5
         AND (julianday('now') - julianday(created_at)) > 30
       ORDER BY importance ASC, days_old DESC 
       LIMIT ?`,
      [limit]
    );
  }
}