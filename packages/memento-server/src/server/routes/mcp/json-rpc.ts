import type { JsonRpcResponse, McpRequestMessage } from './types.js';

export function isJsonRpcNotification(message: McpRequestMessage): boolean {
  return message.id === undefined;
}

export function isInitializeRequest(message: McpRequestMessage): boolean {
  return message.method === 'initialize';
}

export function createJsonRpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

