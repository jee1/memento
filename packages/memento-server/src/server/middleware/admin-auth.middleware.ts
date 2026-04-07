/**
 * Admin/API/Quality 라우트용 API 키 인증 미들웨어
 * 하는 일: ADMIN_API_KEY 검증 — fail-closed 동작
 *   - ADMIN_API_KEY 미설정(absent/empty/whitespace) → 모든 요청에 401 반환
 *   - ADMIN_API_KEY 설정 시: Authorization: Bearer <key> 또는 X-API-Key: <key> 검증
 * 연관: http-server.ts (미들웨어 등록), shared/config (adminApiKey)
 */

import type { Request, Response, NextFunction } from 'express';
import { mementoConfig } from '@memento/core';

export function createAdminAuthMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const expectedKey = mementoConfig.adminApiKey;

  return (req: Request, res: Response, next: NextFunction): void => {
    // fail-closed: ADMIN_API_KEY 미설정(absent/empty/whitespace) → 401
    if (!expectedKey || expectedKey.trim() === '') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Admin API is disabled: ADMIN_API_KEY is not configured. Set ADMIN_API_KEY environment variable to enable admin access.',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const provided = bearer ?? apiKeyHeader?.trim();

    if (provided === expectedKey) {
      next();
      return;
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin/API/Quality routes require a valid API key (Authorization: Bearer <key> or X-API-Key: <key>).',
      timestamp: new Date().toISOString()
    });
  };
}
