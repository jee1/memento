import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

export const EVENT_OUTBOX_ENABLED_ENV = 'MEMENTO_EVENT_OUTBOX_ENABLED';

export type EventOutboxEventType =
  | 'memory.remembered'
  | 'memory.recalled'
  | 'memory.forgotten'
  | 'relation.added'
  | 'procedure.updated'
  | 'consolidation.completed';

export interface EventOutboxEvent {
  id: string;
  eventType: EventOutboxEventType;
  targetUri: string;
  ownerId: string | null;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  attempts: number;
  availableAt: string;
  processedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface EnqueueEventOutboxInput {
  eventType: EventOutboxEventType;
  targetUri: string;
  ownerId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface EventOutboxPublisher {
  publish(event: EventOutboxEvent): Promise<void>;
}

export function isEventOutboxEnabled(): boolean {
  return process.env[EVENT_OUTBOX_ENABLED_ENV] === 'true';
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(payloadJson);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

function toEvent(row: Record<string, unknown>): EventOutboxEvent {
  return {
    id: row.id as string,
    eventType: row.event_type as EventOutboxEventType,
    targetUri: row.target_uri as string,
    ownerId: row.owner_id as string | null,
    payload: parsePayload(row.payload_json as string),
    idempotencyKey: row.idempotency_key as string,
    attempts: row.attempts as number,
    availableAt: row.available_at as string,
    processedAt: row.processed_at as string | null,
    lastError: row.last_error as string | null,
    createdAt: row.created_at as string,
  };
}

export class EventOutboxService {
  constructor(private readonly db: Database.Database) {}

  enqueue(input: EnqueueEventOutboxInput): boolean {
    if (!isEventOutboxEnabled()) return false;
    const result = this.db.prepare(`
      INSERT INTO event_outbox (id, event_type, target_uri, owner_id, payload_json, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(
      randomUUID(), input.eventType, input.targetUri, input.ownerId ?? null,
      JSON.stringify({ target_uri: input.targetUri, ...input.payload }), input.idempotencyKey,
    );
    return result.changes === 1;
  }

  pending(limit = 100): EventOutboxEvent[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('limit must be an integer between 1 and 1000');
    const rows = this.db.prepare(`
      SELECT * FROM event_outbox
      WHERE processed_at IS NULL AND available_at <= CURRENT_TIMESTAMP
      ORDER BY created_at, id LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map(toEvent);
  }

  async publishPending(publisher: EventOutboxPublisher, limit = 100): Promise<{ published: number; failed: number }> {
    let published = 0;
    let failed = 0;
    for (const event of this.pending(limit)) {
      try {
        await publisher.publish(event);
        this.db.prepare(`
          UPDATE event_outbox SET processed_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ? AND processed_at IS NULL
        `).run(event.id);
        published++;
      } catch (error) {
        const attempts = event.attempts + 1;
        const retrySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
        const message = error instanceof Error ? error.message : 'Unknown publish failure';
        this.db.prepare(`
          UPDATE event_outbox
          SET attempts = ?, last_error = ?, available_at = datetime('now', ?)
          WHERE id = ? AND processed_at IS NULL
        `).run(attempts, message, `+${retrySeconds} seconds`, event.id);
        failed++;
      }
    }
    return { published, failed };
  }
}
