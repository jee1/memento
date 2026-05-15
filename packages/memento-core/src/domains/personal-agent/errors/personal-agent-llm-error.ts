export type PersonalAgentLlmErrorCode =
  | 'provider_disabled'
  | 'provider_misconfigured'
  | 'provider_runtime_failed';

export type PersonalAgentLlmErrorOptions = {
  code: PersonalAgentLlmErrorCode;
  message: string;
  cause?: unknown;
};

export class PersonalAgentLlmError extends Error {
  readonly code: PersonalAgentLlmErrorCode;

  constructor(options: PersonalAgentLlmErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PersonalAgentLlmError';
    this.code = options.code;
  }
}

export function isPersonalAgentLlmError(value: unknown): value is PersonalAgentLlmError {
  return value instanceof PersonalAgentLlmError;
}
