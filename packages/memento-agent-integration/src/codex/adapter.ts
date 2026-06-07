import { createHash } from 'node:crypto';

import type {
  AgentEventEnvelope,
  AgentEventPayloadMap,
  AgentEventType,
  StopOutcome,
  ToolOutcome,
} from '../types.js';
import { detectCodexScope } from './scope.js';
import {
  CODEX_HOOK_EVENTS,
  type CodexHookEvent,
  type CodexHookPayload,
  type CodexNormalizeOptions,
} from './types.js';

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function required(input: Record<string, unknown>, key: string): string {
  const result = input[key];
  if (typeof result !== 'string' || result.trim() === '') {
    throw new Error(`Codex hook requires ${key}`);
  }
  return result;
}

function text(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input : undefined;
}

function canonical(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`;
  if (record(input)) {
    return `{${Object.keys(input).sort().map(key =>
      `${JSON.stringify(key)}:${canonical(input[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(input) ?? 'null';
}

function eventId(input: CodexHookPayload): string {
  const hash = createHash('sha256').update(canonical(input)).digest('hex').slice(0, 32);
  return `codex-${input.hook_event_name.toLowerCase()}-${hash}`;
}

function toolOutcome(response: unknown): ToolOutcome {
  if (!record(response)) return 'success';
  if (response.cancelled === true) return 'cancelled';
  if (response.timeout === true) return 'timeout';
  if (response.success === false || response.error !== undefined) return 'error';
  if (typeof response.exit_code === 'number' && response.exit_code !== 0) return 'error';
  return 'success';
}

function stopOutcome(input: unknown): StopOutcome {
  return input === 'cancelled' || input === 'failed' || input === 'abandoned'
    ? input
    : 'completed';
}

function mapPayload(
  input: CodexHookPayload,
): { eventType: AgentEventType; payload: AgentEventPayloadMap[AgentEventType] } {
  switch (input.hook_event_name) {
    case 'SessionStart':
      return {
        eventType: 'SESSION_START',
        payload: {
          client_version: text(input.client_version) ?? '0.137.0',
          ...(text(input.model) ? { model: text(input.model) } : {}),
          working_directory: input.cwd,
          extensions: {
            ...(text(input.source) ? { source: text(input.source) } : {}),
          },
        },
      };
    case 'UserPromptSubmit':
      return {
        eventType: 'USER_PROMPT',
        payload: {
          content: required(input, 'prompt'),
          content_format: 'text/plain',
        },
      };
    case 'PostToolUse':
      return {
        eventType: 'TOOL_RESULT',
        payload: {
          tool_name: required(input, 'tool_name'),
          outcome: toolOutcome(input.tool_response),
          input: input.tool_input,
          output: input.tool_response,
          ...(typeof input.duration_ms === 'number'
            ? { duration_ms: Math.max(0, input.duration_ms) }
            : {}),
          ...(Array.isArray(input.file_changes)
            ? { file_changes: input.file_changes.filter((item): item is string =>
                typeof item === 'string') }
            : {}),
        },
      };
    case 'PreCompact':
      return {
        eventType: 'PRE_COMPACT',
        payload: {
          context_summary: text(input.context_summary)
            ?? `Codex ${text(input.trigger) ?? 'unknown'} compaction`,
          token_budget: typeof input.token_budget === 'number'
            ? Math.max(1, Math.trunc(input.token_budget))
            : 4_096,
          extensions: {
            ...(text(input.trigger) ? { trigger: text(input.trigger) } : {}),
          },
        },
      };
    case 'Stop':
      return {
        eventType: 'STOP',
        payload: {
          outcome: stopOutcome(input.outcome),
          ...(text(input.summary) ?? text(input.last_assistant_message)
            ? { summary: text(input.summary) ?? text(input.last_assistant_message) }
            : {}),
          ...(input.error !== undefined ? { error: input.error } : {}),
        },
      };
  }
}

function parse(input: unknown): CodexHookPayload {
  if (!record(input)) throw new Error('Codex hook payload must be an object');
  const event = required(input, 'hook_event_name');
  if (!CODEX_HOOK_EVENTS.includes(event as CodexHookEvent)) {
    throw new Error(`Unsupported Codex hook: ${event}`);
  }
  required(input, 'session_id');
  required(input, 'cwd');
  return input as CodexHookPayload;
}

export function normalizeCodexHook(
  rawInput: unknown,
  options: CodexNormalizeOptions = {},
): AgentEventEnvelope {
  const input = parse(rawInput);
  const now = options.now?.() ?? Date.now();
  const mapped = mapPayload(input);
  return {
    contract_version: 1,
    event_id: eventId(input),
    event_type: mapped.eventType,
    occurred_at: new Date(now).toISOString(),
    adapter_name: 'codex',
    adapter_version: options.adapterVersion ?? '0.1.0',
    session_id: input.session_id,
    sequence_no: Math.max(0, Math.min(Math.trunc(now), Number.MAX_SAFE_INTEGER)),
    scope: detectCodexScope(input.cwd, options),
    payload: mapped.payload,
  };
}
