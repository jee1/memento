/**
 * Forget Tool - 기억 삭제 도구
 * 안전한 기억 삭제 및 복구 기능
 */

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';
import { CommonSchemas } from './types.js';
import { DatabaseUtils } from '../utils/database.js';

const ForgetSchema = z.object({
  id: CommonSchemas.MemoryId.optional(),
  hard: CommonSchemas.HardDelete,
  reason: z.string().optional().describe('삭제 사유'),
  confirm: z.boolean().optional().describe('삭제 확인'),
  batch: z.array(z.string()).optional().describe('배치 삭제할 ID 목록')
}).refine((data) => data.id || data.batch, {
  message: "id 또는 batch 중 하나는 필수입니다"
});

export class ForgetTool extends BaseTool {
  constructor() {
    super(
      'forget',
      '기억을 삭제합니다',
      {
        type: 'object',
        properties: {
          id: { 
            type: 'string', 
            description: '삭제할 기억의 ID (배치 삭제시 무시됨)',
            pattern: '^mem_[a-zA-Z0-9_]+$'
          },
          hard: { 
            type: 'boolean', 
            description: '완전 삭제 여부 (복구 불가능)', 
            default: false 
          },
          reason: {
            type: 'string',
            description: '삭제 사유',
            maxLength: 500
          },
          confirm: {
            type: 'boolean',
            description: '삭제 확인 (하드 삭제시 필수)',
            default: false
          },
          batch: {
            type: 'array',
            items: { 
              type: 'string',
              pattern: '^mem_[a-zA-Z0-9_]+$'
            },
            description: '배치 삭제할 ID 목록',
            maxItems: 100
          }
        },
        required: ['id']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    this.logInfo('Forget 도구 호출됨', { params });
    
    try {
      // 파라미터 검증 및 파싱
      const { id, hard, reason, confirm, batch } = ForgetSchema.parse(params);
      this.logInfo('파라미터 파싱 완료', { id, hard, reason, confirm, batch });
      
      // 입력 검증
      if (batch && batch.length > 0) {
        this.validateArray(batch, '배치 삭제 ID 목록', 100);
        for (const batchId of batch) {
          this.validateString(batchId, '배치 ID', 50);
        }
      } else {
        this.validateString(id, '메모리 ID', 50);
      }
      
      if (reason) {
        this.validateString(reason, '삭제 사유', 500);
      }
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);
      
      // 하드 삭제 확인
      if (hard && !confirm) {
        throw new Error('하드 삭제는 confirm=true로 확인해야 합니다');
      }
      
      // 배치 삭제 처리
      if (batch && batch.length > 0) {
        this.logInfo('배치 삭제 시작', { count: batch.length, hard });
        return await this.handleBatchDelete(batch, hard, reason, context);
      }
      
      // 단일 삭제 처리
      this.logInfo('단일 삭제 시작', { id, hard });
      if (!id) {
        throw new Error('기억 ID가 필요합니다');
      }
      return await this.handleSingleDelete(id, hard, reason, context);
      
    } catch (error) {
      this.logError(error as Error, 'Forget 도구 실행 실패', { params });
      
      // 사용자 친화적인 에러 메시지 반환
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          throw new Error(`입력 검증 실패: ${error.message}`);
        } else if (error.message.includes('database')) {
          throw new Error(`데이터베이스 오류: ${error.message}`);
        } else if (error.message.includes('not found')) {
          throw new Error(`메모리를 찾을 수 없습니다: ${error.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * 단일 기억 삭제
   */
  private async handleSingleDelete(
    id: string, 
    hard: boolean, 
    reason: string | undefined, 
    context: ToolContext
  ): Promise<ToolResult> {
    try {
      // 기억 존재 확인
      const memory = await this.getMemoryById(id, context);
      if (!memory) {
        throw new Error(`Memory with ID ${id} not found`);
      }
      
      // 삭제 권한 확인
      await this.validateDeletePermission(memory, context);
      
      // 삭제 로그 기록
      await this.logDeleteAction(id, hard, reason, context);
      
      // 트랜잭션으로 삭제 실행
      const result = await DatabaseUtils.runTransaction(context.db!, async () => {
        if (hard) {
          // 하드 삭제: 완전 제거
          return await this.performHardDelete(id, context);
        } else {
          // 소프트 삭제: TTL에 의해 나중에 삭제
          return await this.performSoftDelete(id, context);
        }
      });
      
      // 임베딩 삭제 (하드 삭제인 경우)
      if (hard && context.services.embeddingService?.isAvailable()) {
        await this.deleteEmbedding(id, context);
      }
      
      // 관련 데이터 정리
      await this.cleanupRelatedData(id, hard, context);
      
      return this.createSuccessResult({
        memory_id: id,
        deleted_type: hard ? 'hard' : 'soft',
        message: hard 
          ? `기억이 완전히 삭제되었습니다: ${id}` 
          : `기억이 삭제 대상으로 표시되었습니다: ${id}`,
        reason: reason || 'No reason provided',
        deleted_at: new Date().toISOString()
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
   * 배치 삭제 처리
   */
  private async handleBatchDelete(
    ids: string[], 
    hard: boolean, 
    reason: string | undefined, 
    context: ToolContext
  ): Promise<ToolResult> {
    const results = {
      successful: [] as string[],
      failed: [] as Array<{id: string, error: string}>,
      total: ids.length
    };
    
    for (const id of ids) {
      try {
        await this.handleSingleDelete(id, hard, reason, context);
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
      message: `배치 삭제 완료: ${results.successful.length}/${results.total} 성공`,
      deleted_type: hard ? 'hard' : 'soft',
      reason: reason || 'Batch deletion'
    });
  }

  /**
   * 하드 삭제 실행
   */
  private async performHardDelete(id: string, context: ToolContext): Promise<any> {
    // 메인 테이블에서 삭제
    const deleteResult = await DatabaseUtils.run(
      context.db!, 
      'DELETE FROM memory_item WHERE id = ?', 
      [id]
    );
    
    if (deleteResult.changes === 0) {
      throw new Error(`Memory with ID ${id} not found`);
    }
    
    // 관련 테이블에서도 삭제
    await DatabaseUtils.run(
      context.db!, 
      'DELETE FROM memory_tag WHERE memory_id = ?', 
      [id]
    );
    
    await DatabaseUtils.run(
      context.db!, 
      'DELETE FROM memory_link WHERE source_id = ? OR target_id = ?', 
      [id, id]
    );
    
    await DatabaseUtils.run(
      context.db!, 
      'DELETE FROM feedback_event WHERE memory_id = ?', 
      [id]
    );
    
    return { type: 'hard', changes: deleteResult.changes };
  }

  /**
   * 소프트 삭제 실행
   */
  private async performSoftDelete(id: string, context: ToolContext): Promise<any> {
    // pinned 해제하고 삭제 플래그 설정
    const updateResult = await DatabaseUtils.run(
      context.db!, 
      'UPDATE memory_item SET pinned = FALSE, last_accessed = CURRENT_TIMESTAMP WHERE id = ?', 
      [id]
    );
    
    if (updateResult.changes === 0) {
      throw new Error(`Memory with ID ${id} not found`);
    }
    
    return { type: 'soft', changes: updateResult.changes };
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
   * 삭제 권한 확인
   */
  private async validateDeletePermission(memory: any, context: ToolContext): Promise<void> {
    // 핀된 기억은 하드 삭제 전에 확인 필요
    if (memory.pinned) {
      throw new Error('핀된 기억은 먼저 핀을 해제해야 합니다');
    }
    
    // 중요도가 높은 기억은 확인 필요
    if (memory.importance > 0.8) {
      console.warn(`⚠️ 높은 중요도의 기억 삭제: ${memory.id} (중요도: ${memory.importance})`);
    }
  }

  /**
   * 삭제 로그 기록
   */
  private async logDeleteAction(
    id: string, 
    hard: boolean, 
    reason: string | undefined, 
    context: ToolContext
  ): Promise<void> {
    try {
      await DatabaseUtils.run(
        context.db!,
        `INSERT INTO feedback_event (memory_id, event, score, created_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, 'neglected', 0]
      );
    } catch (error) {
      console.warn('삭제 로그 기록 실패:', error);
    }
  }

  /**
   * 임베딩 삭제
   */
  private async deleteEmbedding(id: string, context: ToolContext): Promise<void> {
    try {
      await context.services.embeddingService.deleteEmbedding(context.db, id);
    } catch (error) {
      console.warn(`⚠️ 임베딩 삭제 실패 (${id}):`, error);
    }
  }

  /**
   * 관련 데이터 정리
   */
  private async cleanupRelatedData(id: string, hard: boolean, context: ToolContext): Promise<void> {
    if (!hard) return; // 소프트 삭제는 관련 데이터 유지
    
    try {
      // FTS 테이블에서 삭제
      await DatabaseUtils.run(
        context.db!,
        'DELETE FROM memory_item_fts WHERE rowid = (SELECT rowid FROM memory_item WHERE id = ?)',
        [id]
      );
      
      // VSS 테이블에서 삭제
      await DatabaseUtils.run(
        context.db!,
        'DELETE FROM memory_item_vec WHERE rowid = ?',
        [id]
      );
      
      // 임베딩 테이블에서 삭제
      await DatabaseUtils.run(
        context.db!,
        'DELETE FROM memory_embedding WHERE memory_id = ?',
        [id]
      );
    } catch (error) {
      console.warn(`관련 데이터 정리 실패 (${id}):`, error);
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
   * 삭제 가능한 기억 목록 조회
   */
  async getDeletableMemories(context: ToolContext, limit: number = 50): Promise<any[]> {
    this.validateDatabase(context);
    
    return await DatabaseUtils.all(
      context.db!,
      `SELECT id, content, type, importance, pinned, created_at 
       FROM memory_item 
       WHERE pinned = FALSE 
       ORDER BY importance ASC, created_at ASC 
       LIMIT ?`,
      [limit]
    );
  }

  /**
   * 삭제 통계 조회
   */
  async getDeleteStats(context: ToolContext): Promise<any> {
    this.validateDatabase(context);
    
    const stats = await DatabaseUtils.get(
      context.db!,
      `SELECT 
         COUNT(*) as total_memories,
         COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_count,
         COUNT(CASE WHEN pinned = FALSE THEN 1 END) as deletable_count,
         AVG(importance) as avg_importance
       FROM memory_item`
    );
    
    const recentDeletes = await DatabaseUtils.all(
      context.db!,
      `SELECT memory_id, event, created_at 
       FROM feedback_event 
       WHERE event IN ('soft_deleted', 'hard_deleted') 
       ORDER BY created_at DESC 
       LIMIT 10`
    );
    
    return {
      ...stats,
      recent_deletes: recentDeletes
    };
  }
}