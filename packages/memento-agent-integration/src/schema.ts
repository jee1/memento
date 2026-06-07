import {
  AGENT_EVENT_TYPES,
  type AgentEventEnvelope,
  type AgentEventType,
  type CaptureReason,
} from './types.js';

const TOP_LEVEL_KEYS = new Set([
  'contract_version',
  'event_id',
  'event_type',
  'occurred_at',
  'adapter_name',
  'adapter_version',
  'session_id',
  'sequence_no',
  'scope',
  'payload',
]);
const SCOPE_KEYS = new Set(['owner_id', 'project_id', 'process_id']);
const PAYLOAD_KEYS: Record<AgentEventType, Set<string>> = {
  SESSION_START: new Set([
    'client_version',
    'model',
    'working_directory',
    'initial_context',
    'extensions',
  ]),
  USER_PROMPT: new Set(['content', 'content_format', 'attachments', 'extensions']),
  TOOL_RESULT: new Set([
    'tool_name',
    'outcome',
    'duration_ms',
    'input',
    'output',
    'file_changes',
    'extensions',
  ]),
  PRE_COMPACT: new Set(['context_summary', 'token_budget', 'extensions']),
  STOP: new Set(['outcome', 'summary', 'error', 'extensions']),
};
const ADAPTER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INSTANT_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface ValidationResult {
  valid: boolean;
  reason?: CaptureReason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validIdentifier(value: unknown, maxLength = 255): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maxLength
    && ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
}

function validJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((item) => validJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }
  if (isRecord(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = Object.values(value).every(
      (item) => item !== undefined && validJsonValue(item, seen),
    );
    seen.delete(value);
    return valid;
  }
  return false;
}

function validatePayload(eventType: AgentEventType, payload: unknown): boolean {
  if (!isRecord(payload) || !hasOnlyKeys(payload, PAYLOAD_KEYS[eventType])) {
    return false;
  }
  if (!validJsonValue(payload)) {
    return false;
  }

  switch (eventType) {
    case 'SESSION_START':
      return validIdentifier(payload.client_version);
    case 'USER_PROMPT':
      return typeof payload.content === 'string'
        && validIdentifier(payload.content_format);
    case 'TOOL_RESULT':
      return validIdentifier(payload.tool_name)
        && ['success', 'error', 'cancelled', 'timeout'].includes(String(payload.outcome))
        && (payload.duration_ms === undefined
          || (typeof payload.duration_ms === 'number'
            && Number.isFinite(payload.duration_ms)
            && payload.duration_ms >= 0));
    case 'PRE_COMPACT':
      return typeof payload.context_summary === 'string'
        && Number.isSafeInteger(payload.token_budget)
        && Number(payload.token_budget) >= 1
        && Number(payload.token_budget) <= 32_768;
    case 'STOP':
      return ['completed', 'cancelled', 'failed', 'abandoned'].includes(String(payload.outcome));
  }
}

export function validateAgentEvent(input: unknown): ValidationResult {
  if (!isRecord(input) || !hasOnlyKeys(input, TOP_LEVEL_KEYS)) {
    return { valid: false, reason: 'INVALID_ENVELOPE' };
  }
  if (input.contract_version !== 1) {
    return {
      valid: false,
      reason: typeof input.contract_version === 'number'
        ? 'UNSUPPORTED_CONTRACT_VERSION'
        : 'INVALID_ENVELOPE',
    };
  }
  if (!AGENT_EVENT_TYPES.includes(input.event_type as AgentEventType)) {
    return { valid: false, reason: 'UNSUPPORTED_EVENT_TYPE' };
  }
  if (!validIdentifier(input.event_id)
    || !validIdentifier(input.session_id)
    || !validIdentifier(input.adapter_version)
    || !validIdentifier(input.adapter_name, 64)
    || !ADAPTER_NAME.test(input.adapter_name as string)
    || typeof input.occurred_at !== 'string'
    || !INSTANT_WITH_ZONE.test(input.occurred_at)
    || !Number.isFinite(Date.parse(input.occurred_at))
    || !Number.isSafeInteger(input.sequence_no)
    || Number(input.sequence_no) < 0
    || !isRecord(input.scope)
    || !hasOnlyKeys(input.scope, SCOPE_KEYS)
    || !Object.values(input.scope).every((value) => validIdentifier(value))) {
    return { valid: false, reason: 'INVALID_ENVELOPE' };
  }

  const eventType = input.event_type as AgentEventType;
  if (!validatePayload(eventType, input.payload)) {
    return { valid: false, reason: 'INVALID_PAYLOAD' };
  }
  return { valid: true };
}

const identifierSchema = { type: 'string', minLength: 1, maxLength: 255 };
const commonRequired = [
  'contract_version',
  'event_id',
  'event_type',
  'occurred_at',
  'adapter_name',
  'adapter_version',
  'session_id',
  'sequence_no',
  'scope',
  'payload',
];

function eventSchema(eventType: AgentEventType, payload: Record<string, unknown>) {
  return {
    type: 'object',
    required: commonRequired,
    additionalProperties: false,
    properties: {
      contract_version: { const: 1 },
      event_id: identifierSchema,
      event_type: { const: eventType },
      occurred_at: { type: 'string', format: 'date-time' },
      adapter_name: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      },
      adapter_version: identifierSchema,
      session_id: identifierSchema,
      sequence_no: { type: 'integer', minimum: 0 },
      scope: {
        type: 'object',
        additionalProperties: false,
        properties: {
          owner_id: identifierSchema,
          project_id: identifierSchema,
          process_id: identifierSchema,
        },
      },
      payload,
    },
  };
}

export const AGENT_EVENT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://memento.local/schemas/agent-event-v1.json',
  title: 'Memento Agent Lifecycle Event v1',
  additionalProperties: false,
  oneOf: [
    eventSchema('SESSION_START', {
      type: 'object',
      required: ['client_version'],
      additionalProperties: false,
      properties: {
        client_version: identifierSchema,
        model: { type: 'string' },
        working_directory: { type: 'string' },
        initial_context: {},
        extensions: { type: 'object' },
      },
    }),
    eventSchema('USER_PROMPT', {
      type: 'object',
      required: ['content', 'content_format'],
      additionalProperties: false,
      properties: {
        content: { type: 'string' },
        content_format: identifierSchema,
        attachments: { type: 'array' },
        extensions: { type: 'object' },
      },
    }),
    eventSchema('TOOL_RESULT', {
      type: 'object',
      required: ['tool_name', 'outcome'],
      additionalProperties: false,
      properties: {
        tool_name: identifierSchema,
        outcome: { enum: ['success', 'error', 'cancelled', 'timeout'] },
        duration_ms: { type: 'number', minimum: 0 },
        input: {},
        output: {},
        file_changes: { type: 'array', items: { type: 'string' } },
        extensions: { type: 'object' },
      },
    }),
    eventSchema('PRE_COMPACT', {
      type: 'object',
      required: ['context_summary', 'token_budget'],
      additionalProperties: false,
      properties: {
        context_summary: { type: 'string' },
        token_budget: { type: 'integer', minimum: 1, maximum: 32_768 },
        extensions: { type: 'object' },
      },
    }),
    eventSchema('STOP', {
      type: 'object',
      required: ['outcome'],
      additionalProperties: false,
      properties: {
        outcome: { enum: ['completed', 'cancelled', 'failed', 'abandoned'] },
        summary: { type: 'string' },
        error: {},
        extensions: { type: 'object' },
      },
    }),
  ],
} as const;

export function asAgentEvent(input: unknown): AgentEventEnvelope {
  return input as AgentEventEnvelope;
}
