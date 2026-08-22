/**
 * Recall 도구 추출 모듈용 호스트 어댑터 (recall-tool.ts에서 분리, #445).
 */

import type { ToolResult } from '../../../tools/types.js';

/** recall-tool-*.ts 추출 모듈이 RecallTool 인스턴스 기능에 접근할 때 사용 */
export interface RecallToolHost {
  logInfo(message: string, additionalData?: Record<string, unknown>): void;
  logWarning(message: string, additionalData?: Record<string, unknown>): void;
  logError(error: Error, context: string, additionalData?: Record<string, unknown>): void;
  validateService<T>(service: T | undefined, serviceName: string): asserts service is T;
  createSuccessResult(data: unknown): ToolResult;
}
