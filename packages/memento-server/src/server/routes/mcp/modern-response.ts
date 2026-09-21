import packageJson from '../../../../package.json' with { type: 'json' };
import type { JsonRpcResponse } from './types.js';

const SERVER_INFO = {
  name: 'memento-mcp-server',
  version: packageJson.version,
};

export function wrapModernSuccessResult(result: unknown): Record<string, unknown> {
  const base: Record<string, unknown> =
    result && typeof result === 'object' && !Array.isArray(result)
      ? { ...(result as Record<string, unknown>) }
      : { value: result };

  const rawMeta = base._meta;
  const existingMeta =
    rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
      ? { ...(rawMeta as Record<string, unknown>) }
      : {};

  return {
    ...base,
    resultType: 'complete',
    _meta: {
      ...existingMeta,
      'io.modelcontextprotocol/serverInfo': SERVER_INFO,
    },
  };
}

export function applyModernSuccessEnvelope(response: JsonRpcResponse): JsonRpcResponse {
  if (response.error || response.result === undefined) {
    return response;
  }

  return {
    ...response,
    result: wrapModernSuccessResult(response.result),
  };
}
