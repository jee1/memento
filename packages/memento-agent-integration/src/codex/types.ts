import type {
  AgentEventEnvelope,
  CaptureResult,
  DispatchResult,
  Transport,
} from '../types.js';

export const CODEX_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PostToolUse',
  'PreCompact',
  'Stop',
] as const;

export type CodexHookEvent = typeof CODEX_HOOK_EVENTS[number];

export interface CodexHookPayload {
  hook_event_name: CodexHookEvent;
  session_id: string;
  cwd: string;
  [key: string]: unknown;
}

export interface CodexScopeOptions {
  env?: NodeJS.ProcessEnv;
  git?: (args: readonly string[], cwd: string) => string | undefined;
}

export interface CodexNormalizeOptions extends CodexScopeOptions {
  adapterVersion?: string;
  now?: () => number;
}

export interface CodexHookRunOptions {
  input: unknown;
  transport: Transport;
  adapterVersion?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface CodexHookRunResult {
  exitCode: 0;
  stdout: '';
  stderr: string;
  capture: CaptureResult;
  dispatch?: DispatchResult;
  event?: AgentEventEnvelope;
}
