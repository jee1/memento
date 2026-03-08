/**
 * ToolContext 생성 미들웨어
 * Express 요청 객체에 ToolContext를 주입
 * Phase 0: 공통 모듈 설계
 * Phase 5.1과 통합: ToolContext 생성 팩토리
 */

import type { Request, Response, NextFunction } from 'express';
import type { ToolContext } from '@memento/core';
import { createToolContext, type ServerContext } from '../context.js';

/**
 * Express Request에 ToolContext 타입 확장
 */
declare global {
  namespace Express {
    interface Request {
      /** ToolContext (서비스 주입 후 사용 가능) */
      toolContext?: ToolContext;
    }
  }
}

/**
 * ToolContext 생성 미들웨어
 * req.services와 req.db가 설정된 후 사용해야 함
 * 
 * @param req Express 요청 객체
 * @param res Express 응답 객체
 * @param next 다음 미들웨어 함수
 */
export function createToolContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 서비스와 DB가 주입되었는지 확인
  if (!req.services || !req.db) {
    res.status(500).json({
      error: 'Services not initialized',
      message: '서비스가 초기화되지 않았습니다. service-injector 미들웨어를 먼저 적용하세요.'
    });
    return;
  }

  // ServerContext 생성
  const serverContext: ServerContext = {
    db: req.db,
    services: req.services
  };

  // ToolContext 생성 및 주입
  req.toolContext = createToolContext(serverContext);
  next();
}

