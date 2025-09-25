/**
 * 기본 도구 클래스
 * 모든 MCP 도구의 기본 구조를 제공
 */

import type { ToolDefinition, ToolHandler, ToolContext, ToolResult, ToolError } from './types.js';

export abstract class BaseTool {
  protected name: string;
  protected description: string;
  protected inputSchema: any;

  constructor(name: string, description: string, inputSchema: any) {
    this.name = name;
    this.description = description;
    this.inputSchema = inputSchema;
  }

  /**
   * 도구 정의 반환
   */
  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      handler: this.handle.bind(this),
    };
  }

  /**
   * 도구 실행 (추상 메서드)
   */
  abstract handle(params: any, context: ToolContext): Promise<ToolResult>;

  /**
   * 성공 결과 생성
   */
  protected createSuccessResult(data: any): ToolResult {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data),
        },
      ],
    };
  }

  /**
   * 에러 결과 생성
   */
  protected createErrorResult(error: string, message?: string, details?: string): ToolError {
    return {
      error,
      ...(message && { message }),
      ...(details && { details }),
    };
  }

  /**
   * 데이터베이스 연결 확인
   */
  protected validateDatabase(context: ToolContext): void {
    if (!context.db) {
      throw new Error('데이터베이스가 초기화되지 않았습니다');
    }
  }

  /**
   * 서비스 확인
   */
  protected validateService(service: any, serviceName: string): void {
    if (!service) {
      throw new Error(`${serviceName}이 초기화되지 않았습니다`);
    }
  }
}
