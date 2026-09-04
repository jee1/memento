import { ToolInputValidationError } from '@memento/core';
import { z } from 'zod';

export type JsonRpcErrorPayload = {
  code: number;
  message: string;
  data: unknown;
};

function isToolInputValidationError(error: unknown): error is Error {
  return (
    error instanceof ToolInputValidationError ||
    (error instanceof Error && error.name === 'ToolInputValidationError')
  );
}

/**
 * Maps tool execution errors to JSON-RPC client error payloads.
 * Returns null when the error should propagate to the outer handler.
 */
export function mapToolExecutionErrorToJsonRpc(error: unknown): JsonRpcErrorPayload | null {
  if (error instanceof z.ZodError) {
    return {
      code: -32602,
      message: 'Invalid params',
      data: error.flatten()
    };
  }

  if (isToolInputValidationError(error)) {
    return {
      code: -32602,
      message: 'Invalid params',
      data: error.message
    };
  }

  if (error instanceof Error && error.message.startsWith('Unknown tool:')) {
    return {
      code: -32601,
      message: 'Method not found',
      data: error.message
    };
  }

  return null;
}
