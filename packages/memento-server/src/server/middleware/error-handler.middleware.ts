/**
 * 공통 에러 핸들러 미들웨어
 * 하는 일: 공유 에러 계약(code/category/severity) 우선 사용, 메시지 파싱 fallback 최소화.
 * 연관: shared/types/error-types.ts (AppErrorContract), shared/interfaces/error-logging.interface.ts
 */

import type { AppErrorContract,IErrorLoggingService } from '@memento/core';
import { ErrorCategory,ErrorSeverity,logger } from '@memento/core';
import type { NextFunction,Request,Response } from 'express';

/**
 * 에러 응답 인터페이스
 */
interface ErrorResponse {
  error: string;
  message: string;
  details?: string;
  timestamp: string;
}

function isAppErrorContract(e: unknown): e is AppErrorContract & { message: string } {
  return typeof e === 'object' && e !== null && 'message' in e && typeof (e as AppErrorContract).message === 'string';
}

/** 에러 객체에서 severity/category 추출 (공유 계약 우선) */
function resolveSeverityAndCategory(
  error: unknown,
  req: Request
): { severity: ErrorSeverity; category: ErrorCategory } {
  let severity = ErrorSeverity.MEDIUM;
  let category = ErrorCategory.UNKNOWN;

  if (isAppErrorContract(error)) {
    if (error.severity != null) severity = error.severity as ErrorSeverity;
    if (error.category != null) {
      const cat = error.category;
      category = typeof cat === 'string' && Object.values(ErrorCategory).includes(cat as ErrorCategory)
        ? (cat as ErrorCategory)
        : ErrorCategory.UNKNOWN;
    }
  }
  const errObj = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  const code = errObj?.code as string | undefined;
  const cat = errObj?.category as string | undefined;
  if (code || cat) {
    const codeUpper = (code ?? '').toUpperCase();
    if (codeUpper.includes('DATABASE') || cat === ErrorCategory.DATABASE) {
      severity = ErrorSeverity.HIGH;
      category = ErrorCategory.DATABASE;
    } else if (codeUpper.includes('VALIDATION') || cat === ErrorCategory.VALIDATION) {
      severity = ErrorSeverity.LOW;
      category = ErrorCategory.VALIDATION;
    } else if (cat === ErrorCategory.TOOL_EXECUTION || req.path?.startsWith('/tools/')) {
      category = ErrorCategory.TOOL_EXECUTION;
    }
  }
  if (category === ErrorCategory.UNKNOWN && req.path?.startsWith('/tools/')) {
    category = ErrorCategory.TOOL_EXECUTION;
  }
  return { severity, category };
}

/** 공유 계약 또는 statusCode 필드로 HTTP 상태 코드 결정 */
function resolveStatusCode(error: unknown, req: Request): number {
  const err = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  if (err?.statusCode != null && typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600) {
    return err.statusCode;
  }
  if (isAppErrorContract(error)) {
    if (error.statusCode != null && error.statusCode >= 400 && error.statusCode < 600) return error.statusCode;
  }
  const { category } = resolveSeverityAndCategory(error, req);
  if (category === ErrorCategory.VALIDATION) return 400;
  if (category === ErrorCategory.AUTHENTICATION) return 401;
  if (category === ErrorCategory.UNKNOWN && err?.message) {
    const msg = String((err as { message?: string }).message ?? '');
    if (/not found|Not Found/i.test(msg)) return 404;
    if (/unauthorized|Unauthorized/i.test(msg)) return 401;
    if (/forbidden|Forbidden/i.test(msg)) return 403;
  }
  return 500;
}

export function errorHandler(
  error: Error | unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  if (req.services?.errorLoggingService) {
    const errorLoggingService: IErrorLoggingService = req.services.errorLoggingService;
    const { severity, category } = resolveSeverityAndCategory(error, req);
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
    logger.error('Request error', {
      method: req.method,
      path: req.path,
      error: errorMessage,
      stack: errorStack
    });
  }

  const errorResponse: ErrorResponse = {
    error: 'Internal Server Error',
    message: errorMessage,
    timestamp: new Date().toISOString()
  };
  if (process.env.NODE_ENV === 'development' && errorStack) {
    errorResponse.details = errorStack;
  }

  const statusCode = resolveStatusCode(error, req);
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

