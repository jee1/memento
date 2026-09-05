import { ToolInputValidationError } from '@memento/core';
import { z } from 'zod';

export type JsonRpcErrorPayload = {
  code: number;
  message: string;
  data: unknown;
};

/** JSON-RPC message 는 한 줄짜리 짧은 설명이어야 하므로 길이를 제한한다. */
const MAX_REASON_LENGTH = 300;

/**
 * 이유를 JSON-RPC `message` 에 담는다 (#861).
 *
 * 대부분의 MCP 클라이언트(Claude Code 포함)는 error.message 만 사용자에게 보여주고
 * error.data 는 버린다. 이유를 data 에만 담으면 호출자는 "Invalid params" 한 줄만 보고
 * 무엇이 잘못됐는지 알 수 없다.
 */
function invalidParams(reason: string, data: unknown): JsonRpcErrorPayload {
  const oneLine = reason.replace(/\s+/g, ' ').trim();
  const clipped =
    oneLine.length > MAX_REASON_LENGTH ? `${oneLine.slice(0, MAX_REASON_LENGTH)}…` : oneLine;
  return {
    code: -32602,
    message: clipped ? `Invalid params: ${clipped}` : 'Invalid params',
    data
  };
}

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
    const reason = error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return invalidParams(reason, error.flatten());
  }

  if (isToolInputValidationError(error)) {
    return invalidParams(error.message, error.message);
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
