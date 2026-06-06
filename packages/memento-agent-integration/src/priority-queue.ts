import type { AgentEventEnvelope, ToolResultPayload } from './types.js';

interface QueueEntry {
  event: AgentEventEnvelope;
  priority: number;
  ordinal: number;
  terminal: boolean;
}

function eventPriority(event: AgentEventEnvelope): number {
  if (event.event_type === 'STOP') return 0;
  if (event.event_type === 'TOOL_RESULT') {
    return (event.payload as ToolResultPayload).outcome === 'success' ? 3 : 0;
  }
  if (event.event_type === 'PRE_COMPACT' || event.event_type === 'SESSION_START') return 1;
  return 2;
}

export class PriorityEventQueue {
  private readonly entries: QueueEntry[] = [];
  private ordinal = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Queue capacity must be a positive safe integer');
    }
  }

  get size(): number {
    return this.entries.length;
  }

  enqueue(event: AgentEventEnvelope): {
    accepted: boolean;
    dropped_event_id?: string;
    dropped_event_type?: AgentEventEnvelope['event_type'];
    reason?: 'QUEUE_OVERFLOW';
  } {
    const incoming: QueueEntry = {
      event,
      priority: eventPriority(event),
      ordinal: this.ordinal++,
      terminal: event.event_type === 'STOP',
    };
    if (this.entries.length < this.capacity) {
      this.entries.push(incoming);
      return { accepted: true };
    }

    const candidates = this.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !entry.terminal)
      .sort((left, right) =>
        right.entry.priority - left.entry.priority
        || left.entry.ordinal - right.entry.ordinal);
    const candidate = candidates[0];
    if (!candidate || (incoming.priority > candidate.entry.priority && !incoming.terminal)) {
      return {
        accepted: false,
        dropped_event_id: event.event_id,
        reason: 'QUEUE_OVERFLOW',
      };
    }

    const [dropped] = this.entries.splice(candidate.index, 1, incoming);
    return {
      accepted: true,
      dropped_event_id: dropped.event.event_id,
      dropped_event_type: dropped.event.event_type,
      reason: 'QUEUE_OVERFLOW',
    };
  }

  take(limit: number): AgentEventEnvelope[] {
    const ordered = this.entries
      .sort((left, right) =>
        left.priority - right.priority || left.ordinal - right.ordinal);
    const taken = ordered.splice(0, Math.max(0, limit));
    return taken.map(({ event }) => event);
  }
}
