/**
 * MCP/SSE 등 Express cors() 밖에서 수동으로 붙이는 Access-Control 헤더용.
 * CORS_ALLOWED_ORIGINS와 동일 정책: 목록이 비어 있으면 ACAO를 붙이지 않음(브라우저 크로스 오리진 차단).
 */

export function resolveCorsAllowOrigin(
  requestOrigin: string | undefined,
  allowedOrigins: readonly string[]
): string | undefined {
  if (!requestOrigin || allowedOrigins.length === 0) {
    return undefined;
  }
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : undefined;
}

/**
 * MCP 엔드포인트용 공통 CORS 헤더(ACA-Origin 은 허용 시에만 포함).
 *
 * 허용 목록이 비어 있지 않으면 응답이 `Origin` 요청 헤더에 따라 달라질 수 있으므로
 * 공유 캐시·리버스 프록시가 한 오리진용 응답을 다른 오리진에 재사용하지 않도록 `Vary: Origin`을 둔다.
 */
export function buildMcpManualCorsHeaders(
  requestOrigin: string | undefined,
  allowedOrigins: readonly string[]
): Record<string, string> {
  const allow = resolveCorsAllowOrigin(requestOrigin, allowedOrigins);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
  if (allowedOrigins.length > 0) {
    headers.Vary = 'Origin';
  }
  if (allow) {
    headers['Access-Control-Allow-Origin'] = allow;
  }
  return headers;
}
