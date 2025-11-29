/**
 * 공통 에러 핸들러 미들웨어
 * Express 에러 처리 통일
 * Phase 0: 공통 모듈 설계
 * Phase 5.2와 통합: 공통 에러 핸들러
 */

import type { Request, Response, NextFunction } from 'express';
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from '../../services/error-logging-service.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * 에러 응답 인터페이스
 */
interface ErrorResponse {
  error: string;
  message: string;
  details?: string;
  timestamp: string;
}

/**
 * 공통 에러 핸들러 미들웨어
 * 
 * @param error 에러 객체
 * @param req Express 요청 객체
 * @param res Express 응답 객체
 * @param next 다음 미들웨어 함수
 */
export function errorHandler(
  error: Error | unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 에러 정보 추출
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // 에러 로깅 (ErrorLoggingService가 주입된 경우)
  if (req.services?.errorLoggingService) {
    const errorLoggingService: ErrorLoggingService = req.services.errorLoggingService;
    
    // 에러 심각도 결정
    let severity = ErrorSeverity.MEDIUM;
    if (errorMessage.includes('database') || errorMessage.includes('Database')) {
      severity = ErrorSeverity.HIGH;
    } else if (errorMessage.includes('validation') || errorMessage.includes('Validation')) {
      severity = ErrorSeverity.LOW;
    }

    // 에러 카테고리 결정
    let category = ErrorCategory.UNKNOWN;
    if (errorMessage.includes('database') || errorMessage.includes('Database')) {
      category = ErrorCategory.DATABASE;
    } else if (errorMessage.includes('validation') || errorMessage.includes('Validation')) {
      category = ErrorCategory.VALIDATION;
    } else if (req.path?.startsWith('/tools/')) {
      category = ErrorCategory.TOOL_EXECUTION;
    }

    // 에러 로깅
    errorLoggingService.logError(
      error instanceof Error ? error : new Error(errorMessage),
      severity,
      category,
      {
        operation: req.method + ' ' + req.path,
        params: req.params,
        query: req.query
      }
    );
  } else {
    // ErrorLoggingService가 없는 경우 logger 사용
    logger.error('Request error', {
      method: req.method,
      path: req.path,
      error: errorMessage,
      stack: errorStack
    });
  }

  // 에러 응답 생성
  const errorResponse: ErrorResponse = {
    error: 'Internal Server Error',
    message: errorMessage,
    timestamp: new Date().toISOString()
  };

  // 개발 환경에서는 스택 트레이스 포함
  if (process.env.NODE_ENV === 'development' && errorStack) {
    errorResponse.details = errorStack;
  }

  // HTTP 상태 코드 결정
  let statusCode = 500;
  if (errorMessage.includes('not found') || errorMessage.includes('Not Found')) {
    statusCode = 404;
  } else if (errorMessage.includes('validation') || errorMessage.includes('Validation')) {
    statusCode = 400;
  } else if (errorMessage.includes('unauthorized') || errorMessage.includes('Unauthorized')) {
    statusCode = 401;
  } else if (errorMessage.includes('forbidden') || errorMessage.includes('Forbidden')) {
    statusCode = 403;
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * 비동기 에러 핸들러 래퍼
 * 비동기 라우트 핸들러에서 발생한 에러를 자동으로 catch
 * 
 * @param fn 비동기 라우트 핸들러 함수
 * @returns Express 라우트 핸들러
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

