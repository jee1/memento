import { CaptureRuntime } from '../runtime.js';
import type { CaptureResult } from '../types.js';
import { normalizeClaudeCodeHook } from './adapter.js';
import type { ClaudeHookRunOptions, ClaudeHookRunResult } from './types.js';

function invalid(reason: CaptureResult['reason']): CaptureResult {
  return { status: 'INVALID', reason };
}

export async function runClaudeCodeHook(
  options: ClaudeHookRunOptions,
): Promise<ClaudeHookRunResult> {
  try {
    const parsed = typeof options.input === 'string'
      ? JSON.parse(options.input) as unknown
      : options.input;
    const event = normalizeClaudeCodeHook(parsed, {
      adapterVersion: options.adapterVersion,
      env: options.env,
      now: options.now,
    });
    const runtime = new CaptureRuntime({
      transport: options.transport,
      timeout_ms: options.timeoutMs,
      max_retries: options.maxRetries,
    });
    const capture = runtime.capture(event);
    const dispatch = capture.status === 'ACCEPTED' || capture.status === 'REDACTED'
      ? await runtime.drain()
      : undefined;
    return {
      exitCode: 0,
      stdout: '',
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
      stderr: 'Memento ignored an invalid Claude Code hook payload.\n',
      capture: invalid('INVALID_PAYLOAD'),
    };
  }
}
