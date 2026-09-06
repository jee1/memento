/**
 * 기본 도구 클래스
 * 모든 MCP 도구의 기본 구조를 제공
 */

import type { ToolDefinition, ToolContext, ToolResult } from './types.js';
import type { FailureDetector } from '../domains/monitoring/services/failure-detector.js';
import type { IReflexionWorker } from '../shared/interfaces/reflexion-worker.interface.js';
import { ToolInputValidationError } from '../shared/errors/tool-input-validation-error.js';
import { logger } from '../shared/utils/logger.js';

import type { z } from 'zod';

function isToolInputValidationError(error: unknown): boolean {
  return (
    error instanceof ToolInputValidationError ||
    (error instanceof Error && error.name === 'ToolInputValidationError')
  );
}

export abstract class BaseTool {
  protected name: string;
  protected description: string;
  // 하위 호환성을 위해 JSON Schema 형식도 허용
  // 향후 모든 도구를 Zod 스키마로 마이그레이션 예정
  protected inputSchema: z.ZodTypeAny | Record<string, unknown>;

  constructor(name: string, description: string, inputSchema: z.ZodTypeAny | Record<string, unknown>) {
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
  abstract handle(params: unknown, context: ToolContext): Promise<ToolResult>;

  /**
   * 성공 결과 생성
   */
  protected createSuccessResult(data: unknown): ToolResult {
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
   * ToolResult 인터페이스를 준수하면서 기존 ToolError 형식도 지원
   */
  protected createErrorResult(error: string, message?: string, details?: string): ToolResult & { error: string; message?: string; details?: string } {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error,
            ...(message && { message }),
            ...(details && { details }),
          }, null, 2),
        },
      ],
      error,
      ...(message && { message }),
      ...(details && { details }),
    };
  }

  /**
   * 안전한 JSON 파싱
   */
  protected safeJsonParse(jsonString: string, fallback: unknown = null): unknown {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      logger.warn(`JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
      return fallback;
    }
  }

  /**
   * 안전한 문자열 검증
   */
  protected validateString(value: unknown, fieldName: string, maxLength: number = 1000): string {
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
  protected validateNumber(value: unknown, fieldName: string, min?: number, max?: number): number {
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
  protected validateArray(value: unknown, fieldName: string, maxLength: number = 100): unknown[] {
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
  protected logError(error: Error, context: string, additionalData?: Record<string, unknown>): void {
    const errorInfo: Record<string, unknown> = {
      tool: this.name,
      context,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      ...(additionalData || {})
    };
    
    logger.error(`[${this.name}] ${context}:`, errorInfo);
  }

  /**
   * 경고 로깅
   */
  protected logWarning(message: string, additionalData?: Record<string, unknown>): void {
    const warningInfo: Record<string, unknown> = {
      tool: this.name,
      message,
      timestamp: new Date().toISOString(),
      ...(additionalData || {})
    };
    
    logger.warn(`[${this.name}] ${message}:`, warningInfo);
  }

  /**
   * 정보 로깅
   */
  protected logInfo(message: string, additionalData?: Record<string, unknown>): void {
    const infoData: Record<string, unknown> = {
      tool: this.name,
      message,
      timestamp: new Date().toISOString(),
      ...(additionalData || {})
    };
    
    logger.info(`[${this.name}] ${message}:`, infoData);
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
   * 서비스 확인 (타입 가드)
   */
  protected validateService<T>(service: T | undefined, serviceName: string): asserts service is T {
    if (!service) {
      throw new Error(`${serviceName}이 초기화되지 않았습니다`);
    }
  }

  /**
   * 실패 감지 훅 (Phase 2)
   * Tool 실행 중 에러 발생 시 FailureDetector를 통해 실패 이벤트를 감지하고 큐에 추가
   */
  protected async handleFailure(
    error: Error,
    params: unknown,
    context: ToolContext,
    executionTimeMs?: number
  ): Promise<void> {
    try {
      // Client input validation is not a Reflexion / procedural-learning signal (#856)
      if (isToolInputValidationError(error)) {
        this.logInfo('Reflexion 스킵 (입력 검증 실패)', {
          tool: this.name,
          reason: 'input_validation',
          error_message: error.message.substring(0, 100)
        });
        return;
      }

      const failureDetector: FailureDetector | undefined = context.services?.failureDetector;
      
      if (!failureDetector) {
        // FailureDetector가 없으면 로그만 기록
        this.logError(error, '실패 감지 (FailureDetector 미초기화)', { params });
        return;
      }

      // Tool 에러 감지
      const detectionResult = failureDetector.detectToolError(
        this.name,
        error,
        params,
        executionTimeMs
      );

      if (detectionResult.detected && detectionResult.event) {
        // Reflexion Worker가 있으면 직접 큐에 추가
        const reflexionWorker: IReflexionWorker | undefined = context.services?.reflexionWorker;
        
        if (reflexionWorker) {
          // Reflexion Worker의 queueFailureEvent 사용 (큐 크기 제한 포함)
          await reflexionWorker.queueFailureEvent(detectionResult.event);
        } else {
          // Reflexion Worker가 없으면 FailureDetector의 기본 큐 사용
          await failureDetector.queueFailureEvent(
            detectionResult.event,
            async (event) => {
              // 기본 핸들러: 로그만 기록
              this.logInfo('실패 이벤트 큐에 추가됨 (Reflexion Worker 미초기화)', {
                event_id: event.id,
                tool: event.tool_name,
                error_type: event.error_type
              });
            }
          );
        }
      }
    } catch (hookError) {
      // 실패 감지 훅 자체에서 에러가 발생해도 원본 에러는 그대로 전파
      this.logError(
        hookError instanceof Error ? hookError : new Error(String(hookError)),
        '실패 감지 훅 실행 중 오류',
        { original_error: error.message }
      );
    }
  }
}
