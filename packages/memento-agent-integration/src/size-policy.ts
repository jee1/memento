import { canonicalize } from './normalize.js';
import type { AgentEventEnvelope } from './types.js';

export const MAX_EVENT_BYTES = 32 * 1024;
export const MAX_BATCH_EVENTS = 50;
export const MAX_BATCH_BYTES = 512 * 1024;

type SizeResult =
  | { action: 'ACCEPTED' | 'REDUCED'; event: AgentEventEnvelope; bytes: number }
  | { action: 'DROPPED'; reason: 'PAYLOAD_TOO_LARGE' };

export function utf8Size(value: unknown): number {
  return canonicalize(value).bytes;
}

function cloneEvent(event: AgentEventEnvelope): AgentEventEnvelope {
  return JSON.parse(JSON.stringify(event)) as AgentEventEnvelope;
}

function removeOptionalFields(event: AgentEventEnvelope): void {
  const payload = event.payload as unknown as Record<string, unknown>;
  delete payload.extensions;
  switch (event.event_type) {
    case 'SESSION_START':
      delete payload.initial_context;
      delete payload.working_directory;
      break;
    case 'USER_PROMPT':
      delete payload.attachments;
      break;
    case 'TOOL_RESULT':
      delete payload.file_changes;
      delete payload.input;
      if (typeof payload.output === 'object' && payload.output !== null) {
        const output = payload.output as Record<string, unknown>;
        payload.output = typeof output.summary === 'string'
          ? { summary: output.summary }
          : undefined;
      }
      break;
    case 'PRE_COMPACT':
      break;
    case 'STOP':
      delete payload.error;
      break;
  }
}

function reducibleText(event: AgentEventEnvelope): {
  get: () => string;
  set: (value: string) => void;
} | undefined {
  const payload = event.payload as unknown as Record<string, unknown>;
  switch (event.event_type) {
    case 'USER_PROMPT':
      return {
        get: () => String(payload.content),
        set: (value) => { payload.content = value; },
      };
    case 'PRE_COMPACT':
      return {
        get: () => String(payload.context_summary),
        set: (value) => { payload.context_summary = value; },
      };
    case 'STOP':
      if (typeof payload.summary !== 'string') return undefined;
      return {
        get: () => String(payload.summary),
        set: (value) => { payload.summary = value; },
      };
    case 'TOOL_RESULT': {
      const output = payload.output;
      if (typeof output !== 'object' || output === null
        || typeof (output as Record<string, unknown>).summary !== 'string') {
        return undefined;
      }
      return {
        get: () => String((payload.output as Record<string, unknown>).summary),
        set: (value) => {
          (payload.output as Record<string, unknown>).summary = value;
        },
      };
    }
    case 'SESSION_START':
      return undefined;
  }
}

function truncateToFit(event: AgentEventEnvelope): boolean {
  const target = reducibleText(event);
  if (!target) return false;
  const original = target.get();
  let low = 0;
  let high = original.length;
  let best = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    target.set(original.slice(0, middle));
    if (utf8Size(event) <= MAX_EVENT_BYTES) {
      best = original.slice(0, middle);
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  target.set(best);
  return utf8Size(event) <= MAX_EVENT_BYTES;
}

export function applySizePolicy(event: AgentEventEnvelope): SizeResult {
  const originalBytes = utf8Size(event);
  if (originalBytes <= MAX_EVENT_BYTES) {
    return { action: 'ACCEPTED', event, bytes: originalBytes };
  }

  const reduced = cloneEvent(event);
  removeOptionalFields(reduced);
  if (utf8Size(reduced) > MAX_EVENT_BYTES && !truncateToFit(reduced)) {
    return { action: 'DROPPED', reason: 'PAYLOAD_TOO_LARGE' };
  }
  const bytes = utf8Size(reduced);
  if (bytes > MAX_EVENT_BYTES) {
    return { action: 'DROPPED', reason: 'PAYLOAD_TOO_LARGE' };
  }
  return { action: 'REDUCED', event: reduced, bytes };
}

export function buildBatch(events: readonly AgentEventEnvelope[]): {
  events: AgentEventEnvelope[];
  remaining: AgentEventEnvelope[];
  bytes: number;
} {
  const selected: AgentEventEnvelope[] = [];
  let bytes = 2;
  let index = 0;
  for (; index < events.length && selected.length < MAX_BATCH_EVENTS; index += 1) {
    const eventBytes = utf8Size(events[index]);
    const nextBytes = bytes + eventBytes + (selected.length === 0 ? 0 : 1);
    if (nextBytes > MAX_BATCH_BYTES) break;
    selected.push(events[index]);
    bytes = nextBytes;
  }
  return {
    events: selected,
    remaining: events.slice(index),
    bytes,
  };
}

export function validateBatch(events: readonly AgentEventEnvelope[]): {
  valid: boolean;
  reason?: 'BATCH_TOO_LARGE';
} {
  if (events.length > MAX_BATCH_EVENTS || utf8Size(events) > MAX_BATCH_BYTES) {
    return { valid: false, reason: 'BATCH_TOO_LARGE' };
  }
  return { valid: true };
}
