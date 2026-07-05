/**
 * Programmatic quality API용 scoped token 인증 미들웨어.
 * 현재 HTTP trust model에서 이 미들웨어는 /api/v1/quality/* 에만 붙으며
 * 브라우저 세션이 아니라 Authorization / X-API-Key 헤더만 허용한다.
 *
 * fail-closed 동작:
 *   - API 토큰 미설정 → 모든 요청에 401 반환
 *   - 유효 토큰이 admin:destructive 스코프 없음 → 403
 */

import { mementoConfig } from '@memento/core';

import { createApiTokenRegistry, type ApiTokenRegistry } from '../auth/api-token-registry.js';
import { createProgrammaticAuthMiddleware } from './programmatic-auth.middleware.js';

export function createAdminAuthMiddleware(registry?: ApiTokenRegistry) {
  const tokenRegistry = registry ?? createApiTokenRegistry(mementoConfig.apiTokens);
  return createProgrammaticAuthMiddleware({
    registry: tokenRegistry,
    requiredScope: 'admin:destructive',
  });
}