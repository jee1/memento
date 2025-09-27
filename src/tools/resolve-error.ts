/**
 * 에러 해결 도구
 * 특정 에러를 해결된 상태로 표시하는 MCP 도구
 */

import { z } from 'zod';
import type { ToolContext } from './types.js';

export const resolveErrorTool = {
  name: 'resolve_error',
  description: '특정 에러를 해결된 상태로 표시합니다',
  inputSchema: z.object({
    errorId: z.string().describe('해결할 에러 ID'),
    resolvedBy: z.string().default('system').describe('해결 처리자'),
    reason: z.string().optional().describe('해결 사유')
  })
};

export async function executeResolveError(args: any, context: ToolContext) {
  const { errorId, resolvedBy, reason } = args;
  
  try {
    if (!context.services.errorLoggingService) {
      return {
        success: false,
        error: 'Error logging service not available'
      };
    }

    const success = context.services.errorLoggingService.resolveError(errorId, resolvedBy);
    
    if (!success) {
      return {
        success: false,
        error: 'Error not found or already resolved',
        errorId
      };
    }

    return {
      success: true,
      message: `Error ${errorId} has been resolved by ${resolvedBy}`,
      errorId,
      resolvedBy,
      reason,
      resolvedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorId
    };
  }
}
