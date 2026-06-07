import { normalizeAgentEvent } from './normalize.js';
import { PriorityEventQueue } from './priority-queue.js';
import { redactAgentEvent } from './redaction.js';
import { asAgentEvent, validateAgentEvent } from './schema.js';
import { applySizePolicy, buildBatch, MAX_BATCH_EVENTS } from './size-policy.js';
import type {
  AgentEventEnvelope,
  CaptureReason,
  CaptureResult,
  CaptureTelemetry,
  DispatchResult,
  Transport,
  TransportResponse,
} from './types.js';

export interface CaptureRuntimeOptions {
  transport: Transport;
  telemetry?: (event: CaptureTelemetry) => void;
  queue_capacity?: number;
  timeout_ms?: number;
  max_retries?: number;
  retry_delay_ms?: number;
  random?: () => number;
  now?: () => number;
}

const NON_RETRYABLE = new Set<CaptureReason>([
  'AUTH_FAILED',
  'INVALID_ENVELOPE',
  'INVALID_PAYLOAD',
  'UNSUPPORTED_CONTRACT_VERSION',
  'UNSUPPORTED_EVENT_TYPE',
  'IDEMPOTENCY_CONFLICT',
  'SCHEMA_NOT_READY',
]);

class TimeoutError extends Error {}

export class CaptureRuntime {
  private readonly queue: PriorityEventQueue;
  private readonly telemetry?: (event: CaptureTelemetry) => void;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly options: CaptureRuntimeOptions) {
    this.queue = new PriorityEventQueue(options.queue_capacity ?? 1_000);
    this.telemetry = options.telemetry;
    this.timeoutMs = Math.min(Math.max(options.timeout_ms ?? 1_000, 1), 5_000);
    this.maxRetries = Math.min(Math.max(options.max_retries ?? 2, 0), 2);
    this.retryDelayMs = Math.max(options.retry_delay_ms ?? 50, 0);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  capture(input: unknown): CaptureResult {
    const startedAt = this.now();
    try {
      const normalized = normalizeAgentEvent(asAgentEvent(input));
      const validation = validateAgentEvent(normalized);
      if (!validation.valid) {
        return this.captureResult(
          { status: 'INVALID', reason: validation.reason ?? 'INVALID_ENVELOPE' },
          startedAt,
        );
      }

      const redaction = redactAgentEvent(normalized);
      if (redaction.action === 'DROPPED') {
        return this.captureResult({
          status: 'DROPPED',
          reason: redaction.reason,
          event_id: normalized.event_id,
          redactions: redaction.metadata,
        }, startedAt, normalized);
      }

      const sized = applySizePolicy(redaction.event);
      if (sized.action === 'DROPPED') {
        return this.captureResult({
          status: 'DROPPED',
          reason: sized.reason,
          event_id: normalized.event_id,
          redactions: redaction.metadata,
        }, startedAt, normalized);
      }

      const queued = this.queue.enqueue(sized.event);
      if (!queued.accepted) {
        return this.captureResult({
          status: 'DROPPED',
          reason: 'QUEUE_OVERFLOW',
          event_id: normalized.event_id,
          redactions: redaction.metadata,
        }, startedAt, normalized);
      }
      if (queued.dropped_event_id) {
        this.emit({
          phase: 'capture',
          status: 'DROPPED',
          reason: 'QUEUE_OVERFLOW',
          latency_ms: Math.max(0, this.now() - startedAt),
          event_type: queued.dropped_event_type,
          queue_size: this.queue.size,
        });
      }

      return this.captureResult({
        status: redaction.action === 'REDACTED' ? 'REDACTED' : 'ACCEPTED',
        reason: 'NONE',
        event_id: normalized.event_id,
        ...(redaction.metadata.length > 0 ? { redactions: redaction.metadata } : {}),
      }, startedAt, sized.event);
    } catch {
      const validation = validateAgentEvent(input);
      return this.captureResult(
        { status: 'INVALID', reason: validation.reason ?? 'INVALID_PAYLOAD' },
        startedAt,
      );
    }
  }

  async drain(): Promise<DispatchResult> {
    const startedAt = this.now();
    const candidates = this.queue.take(MAX_BATCH_EVENTS);
    const batch = buildBatch(candidates);
    for (const remaining of batch.remaining) this.queue.enqueue(remaining);
    if (batch.events.length === 0) {
      return { status: 'ACCEPTED', reason: 'NONE', attempts: 0, event_count: 0 };
    }

    let attempts = 0;
    let lastReason: CaptureReason = 'SERVER_UNAVAILABLE';
    while (attempts <= this.maxRetries) {
      attempts += 1;
      try {
        const response = await this.sendWithTimeout(batch.events);
        if (response.ok) {
          const result: DispatchResult = {
            status: 'ACCEPTED',
            reason: 'NONE',
            attempts,
            event_count: batch.events.length,
          };
          this.dispatchTelemetry(result, startedAt);
          return result;
        }
        lastReason = response.reason ?? 'SERVER_UNAVAILABLE';
        if (NON_RETRYABLE.has(lastReason)) break;
      } catch (error) {
        lastReason = error instanceof TimeoutError ? 'TIMEOUT' : 'SERVER_UNAVAILABLE';
      }
      if (attempts <= this.maxRetries) await this.delay(attempts);
    }

    const result: DispatchResult = {
      status: 'DEGRADED',
      reason: lastReason,
      attempts,
      event_count: batch.events.length,
    };
    for (const event of batch.events) this.queue.enqueue(event);
    this.dispatchTelemetry(result, startedAt);
    return result;
  }

  private captureResult(
    result: CaptureResult,
    startedAt: number,
    event?: AgentEventEnvelope,
  ): CaptureResult {
    this.emit({
      phase: 'capture',
      status: result.status,
      reason: result.reason,
      latency_ms: Math.max(0, this.now() - startedAt),
      event_type: event?.event_type,
      queue_size: this.queue.size,
    });
    return result;
  }

  private dispatchTelemetry(result: DispatchResult, startedAt: number): void {
    this.emit({
      phase: 'dispatch',
      status: result.status,
      reason: result.reason,
      latency_ms: Math.max(0, this.now() - startedAt),
      event_count: result.event_count,
      attempts: result.attempts,
      queue_size: this.queue.size,
    });
  }

  private emit(event: CaptureTelemetry): void {
    try {
      this.telemetry?.(event);
    } catch {
      // Telemetry must never affect the hook-facing path.
    }
  }

  private async sendWithTimeout(
    events: readonly AgentEventEnvelope[],
  ): Promise<TransportResponse> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError('TIMEOUT'));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => this.options.transport(events, controller.signal)),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async delay(attempt: number): Promise<void> {
    const bounded = Math.min(this.retryDelayMs * (2 ** (attempt - 1)), 1_000);
    const jittered = Math.floor(bounded * (0.5 + this.random() * 0.5));
    if (jittered === 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, jittered));
  }
}
