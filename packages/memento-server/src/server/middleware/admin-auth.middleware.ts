/**
 * Programmatic quality API용 ADMIN_API_KEY 인증 미들웨어.
 * 현재 HTTP trust model에서 이 미들웨어는 /api/v1/quality/* 에만 붙으며
 * 브라우저 세션이 아니라 Authorization / X-API-Key 헤더만 허용한다.
 *
 * fail-closed 동작:
 *   - ADMIN_API_KEY 미설정(absent/empty/whitespace) → 모든 요청에 401 반환
 *   - ADMIN_API_KEY 설정 시: Authorization: Bearer <key> 또는 X-API-Key: <key> 검증
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
        message: 'Quality API is disabled: ADMIN_API_KEY is not configured. Set ADMIN_API_KEY to enable /api/v1/quality access.',
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
      message: 'The programmatic quality API (/api/v1/quality) requires a valid API key via Authorization: Bearer <key> or X-API-Key: <key>.',
      timestamp: new Date().toISOString()
    });
  };
}
