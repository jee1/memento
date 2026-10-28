import { CaptureRuntime } from '../runtime.js';
import type { CaptureResult } from '../types.js';
import { runDirectives } from '../claude-code/directives/engine.js';
import { normalizeCodexHook } from './adapter.js';
import type { CodexHookRunOptions, CodexHookRunResult } from './types.js';

function invalid(reason: CaptureResult['reason']): CaptureResult {
  return { status: 'INVALID', reason };
}

function isCaptureEnabled(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: boolean,
): boolean {
  if (typeof explicit === 'boolean') return explicit;
  const flag = env.MEMENTO_CAPTURE?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
    return false;
  }
  return true;
}

export async function runCodexHook(
  options: CodexHookRunOptions,
): Promise<CodexHookRunResult> {
  try {
    const input = typeof options.input === 'string'
      ? JSON.parse(options.input) as unknown
      : options.input;
    const env = options.env ?? process.env;
    const event = normalizeCodexHook(input, {
      adapterVersion: options.adapterVersion,
      env,
      now: options.now,
    });
    const hook = (input ?? {}) as { cwd?: unknown; prompt?: unknown };
    const captureEnabled = isCaptureEnabled(env, options.captureEnabled);

    if (!captureEnabled) {
      const stdout = options.directives
        ? await runDirectives({
            eventType: event.event_type,
            sessionId: event.session_id,
            cwd: typeof hook.cwd === 'string' ? hook.cwd : '',
            prompt: typeof hook.prompt === 'string' ? hook.prompt : '',
          }, options.directives)
        : '';
      return {
        exitCode: 0,
        stdout,
        stderr: '',
        event,
      };
    }

    const runtime = new CaptureRuntime({
      transport: options.transport,
      timeout_ms: options.timeoutMs,
      max_retries: options.maxRetries,
    });
    const capture = runtime.capture(event);
    const [dispatch, stdout] = await Promise.all([
      capture.status === 'ACCEPTED' || capture.status === 'REDACTED'
        ? runtime.drain()
        : undefined,
      options.directives
        ? runDirectives({
            eventType: event.event_type,
            sessionId: event.session_id,
            cwd: typeof hook.cwd === 'string' ? hook.cwd : '',
            prompt: typeof hook.prompt === 'string' ? hook.prompt : '',
          }, options.directives)
        : '',
    ]);
    return {
      exitCode: 0,
      stdout,
      stderr: dispatch?.status === 'DEGRADED'
        ? `Memento capture degraded: ${dispatch.reason}\n`
        : '',
      capture,
      dispatch,
      event,
    };
  } catch {
    return {
      exitCode: 0,
      stdout: '',
      stderr: 'Memento ignored an invalid Codex hook payload.\n',
      capture: invalid('INVALID_PAYLOAD'),
    };
  }
}
