import packageJson from '../../../../package.json' with { type: 'json' };
import type { JsonRpcResponse } from './types.js';

const SERVER_INFO = {
  name: 'memento-mcp-server',
  version: packageJson.version,
};

/**
 * SEP-2549: 2026-07-28 개정판은 cacheable result 에 ttlMs·cacheScope 를 **요구**한다.
 * 이 목록은 닫혀 있다 — 다른 메서드의 result 에는 이 필드를 절대 붙이지 않는다.
 * `@modelcontextprotocol/server@2.0.0` 의 CACHEABLE_RESULT_METHODS 와 같아야 한다.
 *
 * stdio 는 server@2.0.0 의 2026 코덱(encodeResult)이 채워 주지만, HTTP /mcp 는
 * JSON-RPC 응답을 손으로 만들기 때문에(message-processor.ts) 여기서 채운다.
 * 이게 없으면 서버가 server/discover 로 2026-07-28 을 광고해 놓고 그 개정판을
 * 지키지 않게 되고, 클라이언트는 tools/list 를 스키마 위반으로 거절한다 (#1129).
 */
const CACHEABLE_RESULT_METHODS: ReadonlySet<string> = new Set([
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'server/discover',
]);

/** SEP-2549 의 보수적 기본값: 캐시하지 말 것, 요청한 클라이언트 외에는 공유 금지. */
const DEFAULT_TTL_MS = 0;
const DEFAULT_CACHE_SCOPE = 'private';

/** 핸들러가 직접 넣은 값이 이긴다. 단 유효할 때만 — 아니면 보수적 기본값으로 떨어진다. */
function resolveTtlMs(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : DEFAULT_TTL_MS;
}

function resolveCacheScope(value: unknown): 'public' | 'private' {
  return value === 'public' || value === 'private' ? value : DEFAULT_CACHE_SCOPE;
}

export function wrapModernSuccessResult(
  result: unknown,
  method: string | undefined,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    result && typeof result === 'object' && !Array.isArray(result)
      ? { ...(result as Record<string, unknown>) }
      : { value: result };

  const rawMeta = base._meta;
  const existingMeta =
    rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
      ? { ...(rawMeta as Record<string, unknown>) }
      : {};

  const wrapped: Record<string, unknown> = {
    ...base,
    resultType: 'complete',
    _meta: {
      ...existingMeta,
      'io.modelcontextprotocol/serverInfo': SERVER_INFO,
    },
  };

  // method 가 없는 응답은 cacheable result 가 아니다. 목록이 닫혀 있으므로 스탬프하지 않는다.
  if (method !== undefined && CACHEABLE_RESULT_METHODS.has(method)) {
    wrapped.ttlMs = resolveTtlMs(base.ttlMs);
    wrapped.cacheScope = resolveCacheScope(base.cacheScope);
  }

  return wrapped;
}

/** `method` 는 선택 인자가 아니다 — 빠뜨리면 cacheable result 가 조용히 필드 없이 나간다. */
export function applyModernSuccessEnvelope(
  response: JsonRpcResponse,
  method: string | undefined,
): JsonRpcResponse {
  if (response.error || response.result === undefined) {
    return response;
  }

  return {
    ...response,
    result: wrapModernSuccessResult(response.result, method),
  };
}
