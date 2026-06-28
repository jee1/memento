/**
 * Remember 도구 추출 모듈용 호스트 어댑터 (remember-tool.ts에서 분리, #582).
 */

import type { ToolResult } from '../../../tools/types.js';

/** remember-tool-*.ts 추출 모듈이 RememberTool 인스턴스 기능에 접근할 때 사용 */
export interface RememberToolHost {
  logInfo(message: string, additionalData?: Record<string, unknown>): void;
  logWarning(message: string, additionalData?: Record<string, unknown>): void;
  logError(error: Error, context: string, additionalData?: Record<string, unknown>): void;
  createSuccessResult(data: unknown): ToolResult;
}
