import { CaptureRuntime } from '../runtime.js';
import type { CaptureResult } from '../types.js';
import { normalizeCodexHook } from './adapter.js';
import type { CodexHookRunOptions, CodexHookRunResult } from './types.js';

export async function runCodexHook(
  options: CodexHookRunOptions,
): Promise<CodexHookRunResult> {
  try {
    const input = typeof options.input === 'string'
      ? JSON.parse(options.input) as unknown
      : options.input;
    const event = normalizeCodexHook(input, options);
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
    const capture: CaptureResult = {
      status: 'INVALID',
      reason: 'INVALID_PAYLOAD',
    };
    return {
      exitCode: 0,
      stdout: '',
      stderr: 'Memento ignored an invalid Codex hook payload.\n',
      capture,
    };
  }
}
