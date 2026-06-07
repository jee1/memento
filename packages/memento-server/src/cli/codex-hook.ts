import type { Readable } from 'node:stream';

import {
  runCodexHook,
  type AgentEventEnvelope,
  type CaptureReason,
  type Transport,
} from '@memento/agent-integration';

import {
  readServerInfo,
  resolveServerInfoConfigDir,
} from '../server/server-info.js';

type Fetcher = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'json'>>;

interface TransportOptions {
  port: number;
  apiKey?: string;
  fetcher?: Fetcher;
}

const REASONS = new Set<CaptureReason>([
  'NONE',
  'AUTH_FAILED',
  'SERVER_UNAVAILABLE',
  'TIMEOUT',
  'QUEUE_OVERFLOW',
  'INVALID_ENVELOPE',
  'INVALID_PAYLOAD',
  'UNSUPPORTED_CONTRACT_VERSION',
  'UNSUPPORTED_EVENT_TYPE',
  'SESSION_NOT_STARTED',
  'INVALID_SESSION_STATE',
  'IDEMPOTENCY_CONFLICT',
  'SENSITIVE_PATH',
  'BINARY_CONTENT',
  'PRIVATE_KEY_MATERIAL',
  'PAYLOAD_TOO_LARGE',
  'BATCH_TOO_LARGE',
  'SCHEMA_NOT_READY',
  'INTERNAL_ERROR',
]);

function route(event: AgentEventEnvelope): { path: string; body: unknown } {
  if (event.event_type === 'SESSION_START') {
    return { path: '/api/v1/agent/sessions', body: event };
  }
  if (event.event_type === 'PRE_COMPACT') {
    return {
      path: `/api/v1/agent/sessions/${encodeURIComponent(event.session_id)}:pre-compact`,
      body: event,
    };
  }
  if (event.event_type === 'STOP') {
    return {
      path: `/api/v1/agent/sessions/${encodeURIComponent(event.session_id)}:stop`,
      body: event,
    };
  }
  return { path: '/api/v1/agent/observations:ingest', body: { events: [event] } };
}

export function createCodexHttpTransport(options: TransportOptions): Transport {
  const fetcher = options.fetcher ?? fetch;
  return async (events, signal) => {
    const event = events[0];
    if (!event) return { ok: true };
    const request = route(event);
    try {
      const response = await fetcher(
        `http://127.0.0.1:${options.port}${request.path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.apiKey
              ? { Authorization: `Bearer ${options.apiKey}` }
              : {}),
          },
          body: JSON.stringify(request.body),
          signal,
        },
      );
      if (response.ok) return { ok: true };
      const payload = await response.json() as { reason_code?: unknown };
      const reason = typeof payload.reason_code === 'string'
        && REASONS.has(payload.reason_code as CaptureReason)
        ? payload.reason_code as CaptureReason
        : 'SERVER_UNAVAILABLE';
      return { ok: false, reason };
    } catch {
      return { ok: false, reason: signal.aborted ? 'TIMEOUT' : 'SERVER_UNAVAILABLE' };
    }
  };
}

async function readStream(stream: Readable): Promise<string> {
  let input = '';
  for await (const chunk of stream) input += String(chunk);
  return input;
}

export async function runCodexHookCommand(
  stream: Readable = process.stdin,
): Promise<number> {
  const input = await readStream(stream);
  const info = await readServerInfo(resolveServerInfoConfigDir());
  const transport: Transport = info
    ? createCodexHttpTransport({
        port: info.port,
        apiKey: process.env.ADMIN_API_KEY?.trim(),
      })
    : async () => ({ ok: false, reason: 'SERVER_UNAVAILABLE' });
  const result = await runCodexHook({
    input,
    transport,
    timeoutMs: 1_000,
    maxRetries: 0,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}
