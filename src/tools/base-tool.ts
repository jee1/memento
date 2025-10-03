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
          text: JSON.stringify(data, null, 2),
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
   * 안전한 JSON 파싱
   */
  protected safeJsonParse(jsonString: string, fallback: any = null): any {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.warn(`JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
      return fallback;
    }
  }

  /**
   * 안전한 문자열 검증
   */
  protected validateString(value: any, fieldName: string, maxLength: number = 1000): string {
    if (typeof value !== 'string') {
      throw new Error(`${fieldName}은 문자열이어야 합니다`);
    }
    
    if (value.length === 0) {
      throw new Error(`${fieldName}은 비어있을 수 없습니다`);
    }
    
    if (value.length > maxLength) {
      throw new Error(`${fieldName}은 ${maxLength}자를 초과할 수 없습니다`);
    }
    
    return value.trim();
  }

  /**
   * 안전한 숫자 검증
   */
  protected validateNumber(value: any, fieldName: string, min?: number, max?: number): number {
    const num = Number(value);
    
    if (isNaN(num)) {
      throw new Error(`${fieldName}은 유효한 숫자여야 합니다`);
    }
    
    if (min !== undefined && num < min) {
      throw new Error(`${fieldName}은 ${min} 이상이어야 합니다`);
    }
    
    if (max !== undefined && num > max) {
      throw new Error(`${fieldName}은 ${max} 이하여야 합니다`);
    }
    
    return num;
  }

  /**
   * 안전한 배열 검증
   */
  protected validateArray(value: any, fieldName: string, maxLength: number = 100): any[] {
    if (!Array.isArray(value)) {
      throw new Error(`${fieldName}은 배열이어야 합니다`);
    }
    
    if (value.length > maxLength) {
      throw new Error(`${fieldName}은 ${maxLength}개를 초과할 수 없습니다`);
    }
    
    return value;
  }

  /**
   * 에러 로깅
   */
  protected logError(error: Error, context: string, additionalData?: any): void {
    const errorInfo = {
      tool: this.name,
      context,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      ...additionalData
    };
    
    console.error(`[${this.name}] ${context}:`, errorInfo);
  }

  /**
   * 경고 로깅
   */
  protected logWarning(message: string, additionalData?: any): void {
    const warningInfo = {
      tool: this.name,
      message,
      timestamp: new Date().toISOString(),
      ...additionalData
    };
    
    console.warn(`[${this.name}] ${message}:`, warningInfo);
  }

  /**
   * 정보 로깅
   */
  protected logInfo(message: string, additionalData?: any): void {
    const infoData = {
      tool: this.name,
      message,
      timestamp: new Date().toISOString(),
      ...additionalData
    };
    
    console.log(`[${this.name}] ${message}:`, infoData);
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
