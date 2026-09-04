/**
 * Client-fixable tool input validation failure.
 * Mapped by server `mapToolExecutionErrorToJsonRpc` to JSON-RPC `-32602 Invalid params`.
 */
export class ToolInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputValidationError';
  }
}
