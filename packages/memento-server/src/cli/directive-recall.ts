import type { RecallPort } from '@memento/agent-integration';

interface ToolCallResponse {
  readonly error?: { readonly message?: unknown };
  readonly result?: {
    readonly isError?: boolean;
    readonly content?: ReadonlyArray<{ readonly text?: unknown }>;
  };
}

/**
 * `/mcp` 에 `tools/call` JSON-RPC 한 번을 보내 `recall` 을 부른다. initialize 없이 단발로 응답을 받는다.
 * 실패(비 2xx, JSON-RPC error, 모양 불일치, abort)는 던지고, 엔진이 폴백 줄을 남긴다.
 */
export function createDirectiveRecallPort(options: {
  readonly port: number;
  readonly apiKey?: string;
}): RecallPort {
  return async (request, signal) => {
    const response = await fetch(`http://127.0.0.1:${options.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'recall', arguments: request },
      }),
      signal,
    });
    if (!response.ok) throw new Error(`recall HTTP ${response.status}`);
    const body = await response.json() as ToolCallResponse;
    if (body.error) throw new Error(`recall JSON-RPC error: ${String(body.error.message)}`);
    const text = body.result?.content?.[0]?.text;
    if (body.result?.isError || typeof text !== 'string') throw new Error('recall returned no text content');
    return JSON.parse(text) as unknown;
  };
}
