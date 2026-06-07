import type { AgentEventEnvelope, CaptureResult, DispatchResult, Transport } from '../types.js';

export const CLAUDE_CODE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PostToolUse',
  'PreCompact',
  'Stop',
] as const;

export type ClaudeCodeHookEvent = typeof CLAUDE_CODE_HOOK_EVENTS[number];

export interface ClaudeCodeHookPayload {
  session_id: string;
  transcript_path?: string;
  cwd: string;
  permission_mode?: string;
  hook_event_name: ClaudeCodeHookEvent;
  [key: string]: unknown;
}

export interface ClaudeScopeOptions {
  env?: NodeJS.ProcessEnv;
  git?: (args: readonly string[], cwd: string) => string | undefined;
}

export interface ClaudeNormalizeOptions extends ClaudeScopeOptions {
  adapterVersion?: string;
  now?: () => number;
}

export interface ClaudeHookRunOptions {
  input: unknown;
  transport: Transport;
  adapterVersion?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ClaudeHookRunResult {
  exitCode: 0;
  stdout: '';
  stderr: string;
  capture: CaptureResult;
  dispatch?: DispatchResult;
  event?: AgentEventEnvelope;
}
