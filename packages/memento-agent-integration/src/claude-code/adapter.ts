import { createHash } from 'node:crypto';

import type {
  AgentEventEnvelope,
  AgentEventPayloadMap,
  AgentEventType,
  StopOutcome,
  ToolOutcome,
} from '../types.js';
import { detectClaudeCodeScope } from './scope.js';
import {
  CLAUDE_CODE_HOOK_EVENTS,
  type ClaudeCodeHookEvent,
  type ClaudeCodeHookPayload,
  type ClaudeNormalizeOptions,
} from './types.js';

const DEFAULT_ADAPTER_VERSION = '0.1.0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  input: Record<string, unknown>,
  key: string,
): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Claude Code hook requires ${key}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function eventId(input: ClaudeCodeHookPayload): string {
  const digest = createHash('sha256')
    .update(canonicalJson(input))
    .digest('hex')
    .slice(0, 32);
  return `claude-${input.hook_event_name.toLowerCase()}-${digest}`;
}

function fileChanges(input: unknown): string[] | undefined {
  if (!isRecord(input)) return undefined;
  const candidates = [
    input.file_path,
    input.path,
    ...(Array.isArray(input.file_paths) ? input.file_paths : []),
  ].filter((value): value is string => typeof value === 'string' && value !== '');
  return candidates.length > 0 ? [...new Set(candidates)] : undefined;
}

function toolOutcome(response: unknown): ToolOutcome {
  if (!isRecord(response)) return 'success';
  if (response.cancelled === true) return 'cancelled';
  if (response.timeout === true) return 'timeout';
  if (response.success === false || response.error !== undefined) return 'error';
  return 'success';
}

function stopOutcome(input: unknown): StopOutcome {
  return input === 'cancelled' || input === 'failed' || input === 'abandoned'
    ? input
    : 'completed';
}

function mapPayload(
  input: ClaudeCodeHookPayload,
): { eventType: AgentEventType; payload: AgentEventPayloadMap[AgentEventType] } {
  switch (input.hook_event_name) {
    case 'SessionStart':
      return {
        eventType: 'SESSION_START',
        payload: {
          client_version: optionalString(input.client_version) ?? '2.1.153',
          ...(optionalString(input.model) ? { model: optionalString(input.model) } : {}),
          working_directory: input.cwd,
          extensions: {
            ...(optionalString(input.source) ? { source: optionalString(input.source) } : {}),
            ...(optionalString(input.permission_mode)
              ? { permission_mode: optionalString(input.permission_mode) }
              : {}),
          },
        },
      };
    case 'UserPromptSubmit':
      return {
        eventType: 'USER_PROMPT',
        payload: {
          content: requiredString(input, 'prompt'),
          content_format: 'text/plain',
        },
      };
    case 'PostToolUse': {
      const toolInput = input.tool_input;
      const response = input.tool_response;
      return {
        eventType: 'TOOL_RESULT',
        payload: {
          tool_name: requiredString(input, 'tool_name'),
          outcome: toolOutcome(response),
          input: toolInput,
          output: response,
          ...(fileChanges(toolInput) ? { file_changes: fileChanges(toolInput) } : {}),
          extensions: {
            ...(optionalString(input.tool_use_id)
              ? { tool_use_id: optionalString(input.tool_use_id) }
              : {}),
          },
        },
      };
    }
    case 'PreCompact': {
      const summary = optionalString(input.custom_instructions)
        ?? `Claude Code ${optionalString(input.trigger) ?? 'unknown'} compaction`;
      return {
        eventType: 'PRE_COMPACT',
        payload: {
          context_summary: summary,
          token_budget: 4_096,
          extensions: {
            ...(optionalString(input.trigger) ? { trigger: optionalString(input.trigger) } : {}),
          },
        },
      };
    }
    case 'Stop':
      return {
        eventType: 'STOP',
        payload: {
          outcome: stopOutcome(input.outcome),
          ...(optionalString(input.last_assistant_message)
            ? { summary: optionalString(input.last_assistant_message) }
            : {}),
          ...(input.error !== undefined ? { error: input.error } : {}),
          extensions: {
            stop_hook_active: input.stop_hook_active === true,
            ...(Array.isArray(input.background_tasks)
              ? { background_tasks: input.background_tasks }
              : {}),
            ...(Array.isArray(input.session_crons)
              ? { session_crons: input.session_crons }
              : {}),
          },
        },
      };
  }
}

function parsePayload(input: unknown): ClaudeCodeHookPayload {
  if (!isRecord(input)) throw new Error('Claude Code hook payload must be an object');
  const hookEvent = requiredString(input, 'hook_event_name');
  if (!CLAUDE_CODE_HOOK_EVENTS.includes(hookEvent as ClaudeCodeHookEvent)) {
    throw new Error(`Unsupported Claude Code hook: ${hookEvent}`);
  }
  requiredString(input, 'session_id');
  requiredString(input, 'cwd');
  return input as ClaudeCodeHookPayload;
}

export function normalizeClaudeCodeHook(
  rawInput: unknown,
  options: ClaudeNormalizeOptions = {},
): AgentEventEnvelope {
  const input = parsePayload(rawInput);
  const now = options.now?.() ?? Date.now();
  const mapped = mapPayload(input);
  return {
    contract_version: 1,
    event_id: eventId(input),
    event_type: mapped.eventType,
    occurred_at: new Date(now).toISOString(),
    adapter_name: 'claude-code',
    adapter_version: options.adapterVersion ?? DEFAULT_ADAPTER_VERSION,
    session_id: input.session_id,
    sequence_no: Math.max(0, Math.min(Math.trunc(now), Number.MAX_SAFE_INTEGER)),
    scope: detectClaudeCodeScope(input.cwd, options),
    payload: mapped.payload,
  };
}
