import { describe, expect, it, vi } from 'vitest';
import {
  CaptureRuntime,
  PriorityEventQueue,
  type CaptureTelemetry,
  type Transport,
} from './index.js';
import { eventFixture } from './test-fixtures.js';

describe('priority bounded queue', () => {
  it('drains terminal and failed events before ordinary events', () => {
    const queue = new PriorityEventQueue(10);
    queue.enqueue(eventFixture('TOOL_RESULT', {
      event_id: 'success',
      payload: { tool_name: 'test', outcome: 'success' },
    }));
    queue.enqueue(eventFixture('USER_PROMPT', { event_id: 'prompt' }));
    queue.enqueue(eventFixture('SESSION_START', { event_id: 'start' }));
    queue.enqueue(eventFixture('TOOL_RESULT', {
      event_id: 'failure',
      payload: { tool_name: 'test', outcome: 'error' },
    }));
    queue.enqueue(eventFixture('STOP', { event_id: 'stop' }));

    expect(queue.take(10).map((event) => event.event_id)).toEqual([
      'failure',
      'stop',
      'start',
      'prompt',
      'success',
    ]);
  });

  it('drops the oldest lowest-priority non-terminal event on overflow', () => {
    const queue = new PriorityEventQueue(3);
    queue.enqueue(eventFixture('TOOL_RESULT', {
      event_id: 'success-oldest',
      payload: { tool_name: 'test', outcome: 'success' },
    }));
    queue.enqueue(eventFixture('USER_PROMPT', { event_id: 'prompt' }));
    queue.enqueue(eventFixture('SESSION_START', { event_id: 'start' }));

    const result = queue.enqueue(eventFixture('STOP', { event_id: 'stop' }));

    expect(result).toEqual({
      accepted: true,
      dropped_event_id: 'success-oldest',
      dropped_event_type: 'TOOL_RESULT',
      reason: 'QUEUE_OVERFLOW',
    });
    expect(queue.take(10).map((event) => event.event_id)).toEqual([
      'stop',
      'start',
      'prompt',
    ]);
  });
});

describe('non-throwing capture runtime', () => {
  it('returns INVALID instead of throwing for invalid input', () => {
    const runtime = new CaptureRuntime({ transport: vi.fn() });

    expect(runtime.capture({ invalid: true })).toEqual({
      status: 'INVALID',
      reason: 'INVALID_ENVELOPE',
    });
  });

  it('returns REDACTED after safe enqueue and telemetry never contains payload data', () => {
    const telemetry: CaptureTelemetry[] = [];
    const runtime = new CaptureRuntime({
      transport: vi.fn(),
      telemetry: (event) => telemetry.push(event),
    });
    const rawSecret = 'person@example.com';

    const result = runtime.capture(eventFixture('USER_PROMPT', {
      payload: { content: rawSecret, content_format: 'text' },
    }));

    expect(result).toEqual({
      status: 'REDACTED',
      reason: 'NONE',
      event_id: 'evt-user_prompt',
      redactions: [{ rule: 'EMAIL', count: 1 }],
    });
    expect(JSON.stringify(telemetry)).not.toContain(rawSecret);
    expect(telemetry[0]).toMatchObject({
      phase: 'capture',
      status: 'REDACTED',
      reason: 'NONE',
      event_type: 'USER_PROMPT',
    });
  });

  it('emits drop telemetry when a higher-priority event evicts queued work', () => {
    const telemetry: CaptureTelemetry[] = [];
    const runtime = new CaptureRuntime({
      transport: vi.fn(),
      queue_capacity: 1,
      telemetry: event => telemetry.push(event),
    });
    runtime.capture(eventFixture('TOOL_RESULT', {
      event_id: 'success',
      payload: { tool_name: 'test', outcome: 'success' },
    }));

    expect(runtime.capture(eventFixture('STOP', { event_id: 'stop' }))).toMatchObject({
      status: 'ACCEPTED',
    });
    expect(telemetry).toContainEqual(expect.objectContaining({
      status: 'DROPPED',
      reason: 'QUEUE_OVERFLOW',
      event_type: 'TOOL_RESULT',
    }));
  });

  it('retries transient failures twice and returns DEGRADED without throwing', async () => {
    const transport = vi.fn<Parameters<Transport>, ReturnType<Transport>>()
      .mockRejectedValueOnce(new Error('server raw failure'))
      .mockRejectedValueOnce(new Error('server raw failure'))
      .mockResolvedValue({ ok: true });
    const runtime = new CaptureRuntime({
      transport,
      retry_delay_ms: 0,
      random: () => 0,
    });
    runtime.capture(eventFixture('SESSION_START'));

    await expect(runtime.drain()).resolves.toEqual({
      status: 'ACCEPTED',
      reason: 'NONE',
      attempts: 3,
      event_count: 1,
    });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('does not retry auth failures', async () => {
    const transport = vi.fn<Parameters<Transport>, ReturnType<Transport>>().mockResolvedValue({
      ok: false,
      reason: 'AUTH_FAILED',
    });
    const runtime = new CaptureRuntime({ transport, retry_delay_ms: 0 });
    runtime.capture(eventFixture('SESSION_START'));

    await expect(runtime.drain()).resolves.toEqual({
      status: 'DEGRADED',
      reason: 'AUTH_FAILED',
      attempts: 1,
      event_count: 1,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('requeues a failed dispatch batch for a later drain', async () => {
    const transport = vi.fn<Parameters<Transport>, ReturnType<Transport>>()
      .mockResolvedValueOnce({ ok: false, reason: 'SERVER_UNAVAILABLE' })
      .mockResolvedValueOnce({ ok: true });
    const runtime = new CaptureRuntime({
      transport,
      max_retries: 0,
    });
    runtime.capture(eventFixture('SESSION_START'));

    await expect(runtime.drain()).resolves.toMatchObject({
      status: 'DEGRADED',
      event_count: 1,
    });
    await expect(runtime.drain()).resolves.toMatchObject({
      status: 'ACCEPTED',
      event_count: 1,
    });
  });

  it('bounds transport timeout and reports only stable telemetry reason codes', async () => {
    vi.useFakeTimers();
    const telemetry: CaptureTelemetry[] = [];
    const transport: Transport = (_events, signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('contains secret output')));
    });
    const runtime = new CaptureRuntime({
      transport,
      timeout_ms: 10,
      max_retries: 0,
      telemetry: (event) => telemetry.push(event),
    });
    runtime.capture(eventFixture('SESSION_START'));

    const pending = runtime.drain();
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toEqual({
      status: 'DEGRADED',
      reason: 'TIMEOUT',
      attempts: 1,
      event_count: 1,
    });
    expect(JSON.stringify(telemetry)).not.toContain('contains secret output');
    expect(telemetry.at(-1)).toMatchObject({
      phase: 'dispatch',
      status: 'DEGRADED',
      reason: 'TIMEOUT',
    });
    vi.useRealTimers();
  });
});
