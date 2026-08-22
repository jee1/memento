/**
 * Procedural Rollback Tool - 이전 버전 내용으로 새 procedural 메모리 생성 (Issue #57 Phase 2)
 */

import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { rollbackToVersion } from './procedural-rollback-service.js';

export class ProceduralRollbackTool extends BaseTool {
  constructor() {
    super(
      'procedural_rollback',
      '지정한 이전 버전의 내용으로 새 procedural 메모리 버전을 생성합니다. 기존 버전은 수정하지 않습니다.',
      {
        type: 'object',
        properties: {
          current_id: {
            type: 'string',
            description: '현재 기준 메모리 ID (같은 시리즈 내)',
          },
          target_version_id: {
            type: 'string',
            description: '되돌릴 버전의 메모리 ID',
          },
        },
        required: ['current_id', 'target_version_id'],
      }
    );
  }

  /**
   * Given: current_id, target_version_id, context(db).
   * When: handle 호출.
   * Then: 새 메모리 id 반환. 대상 없거나 다른 시리즈면 400 에러.
   */
  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    const { current_id, target_version_id } = params as { current_id?: string; target_version_id?: string };
    if (!current_id || !target_version_id) {
      return this.createErrorResult('invalid_params', 'current_id와 target_version_id는 필수입니다.');
    }
    if (!context.db) {
      return this.createErrorResult('database_unavailable', '데이터베이스를 사용할 수 없습니다.');
    }

    try {
      const newId = rollbackToVersion(context.db, current_id, target_version_id);
      return this.createSuccessResult({ memory_id: newId, message: '이전 버전 내용으로 새 버전이 생성되었습니다.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.createErrorResult('rollback_failed', message);
    }
  }
}
