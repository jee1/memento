import type { Response } from 'express';

export interface SSETransport {
  res: Response;
  sessionId: string;
  keepAliveInterval: NodeJS.Timeout;
}

export type McpRequestMessage = {
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

