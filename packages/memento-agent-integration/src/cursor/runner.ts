import { runDirectives } from '../claude-code/directives/engine.js';
import { toCursorHookStdout } from '../claude-code/directives/select.js';
import type { DirectiveDeps } from '../claude-code/directives/types.js';

export interface CursorHookRunOptions {
  input: unknown;
  directives?: DirectiveDeps;
}

export interface CursorHookRunResult {
  exitCode: 0;
  stdout: string;
  stderr: string;
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sessionIdOf(hook: Record<string, unknown>): string {
  return text(hook.conversation_id)
    || text(hook.session_id)
    || text(hook.generation_id)
    || 'cursor';
}

function cwdOf(hook: Record<string, unknown>): string {
  if (typeof hook.cwd === 'string') return hook.cwd;
  const roots = hook.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === 'string') return roots[0];
  return '';
}

function promptOf(hook: Record<string, unknown>): string {
  return text(hook.prompt) || text(hook.user_prompt) || text(hook.content);
}

/**
 * Cursor `beforeSubmitPrompt` 전용. lifecycle capture 없이 case 지침만 주입한다.
 * stdout 은 `additional_context` / `continue` 스키마다.
 */
export async function runCursorHook(
  options: CursorHookRunOptions,
): Promise<CursorHookRunResult> {
  try {
    const parsed = typeof options.input === 'string'
      ? JSON.parse(options.input) as unknown
      : options.input;
    const hook = asRecord(parsed);
    if (!options.directives) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    const stdout = await runDirectives({
      eventType: 'USER_PROMPT',
      sessionId: sessionIdOf(hook),
      cwd: cwdOf(hook),
      prompt: promptOf(hook),
    }, {
      ...options.directives,
      formatStdout: options.directives.formatStdout ?? toCursorHookStdout,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch {
    return {
      exitCode: 0,
      stdout: '',
      stderr: 'Memento ignored an invalid Cursor hook payload.\n',
    };
  }
}
