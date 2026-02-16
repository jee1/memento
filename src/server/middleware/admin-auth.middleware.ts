/**
 * Admin/API/Quality 라우트용 API 키 인증 미들웨어
 * 하는 일: ADMIN_API_KEY가 설정된 경우 Authorization: Bearer <key> 또는 X-API-Key: <key> 검증
 * 주의: 키 미설정 시 인증 생략(기존 동작 유지). 키 설정 시만 401 반환.
 * 연관: http-server.ts (미들웨어 등록), shared/config (adminApiKey)
 */

import type { Request, Response, NextFunction } from 'express';
import { mementoConfig } from '../../shared/config/index.js';

export function createAdminAuthMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const expectedKey = mementoConfig.adminApiKey;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!expectedKey || expectedKey === '') {
      next();
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
