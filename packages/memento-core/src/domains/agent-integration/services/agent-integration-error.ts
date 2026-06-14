export type AgentIntegrationReasonCode =
  | 'NONE'
  | 'AUTH_FAILED'
  | 'SERVER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'QUEUE_OVERFLOW'
  | 'INVALID_ENVELOPE'
  | 'INVALID_PAYLOAD'
  | 'UNSUPPORTED_CONTRACT_VERSION'
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'SCHEMA_NOT_READY'
  | 'SESSION_NOT_STARTED'
  | 'INVALID_SESSION_STATE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SENSITIVE_PATH'
  | 'BINARY_CONTENT'
  | 'PRIVATE_KEY_MATERIAL'
  | 'PAYLOAD_TOO_LARGE'
  | 'BATCH_TOO_LARGE'
  | 'INTERNAL_ERROR';

export class AgentIntegrationError extends Error {
  constructor(
    message: string,
    readonly reasonCode: AgentIntegrationReasonCode,
    readonly httpStatus: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AgentIntegrationError';
  }
}
