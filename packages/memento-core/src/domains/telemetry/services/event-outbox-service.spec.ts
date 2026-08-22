import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { EventOutboxMigration } from '../../../infrastructure/database/sqlite/migration/migrations/039-event-outbox.js';
import { EVENT_OUTBOX_ENABLED_ENV, EventOutboxService } from './event-outbox-service.js';

describe('EventOutboxService', () => {
  let db: Database.Database;
  let originalEnabled: string | undefined;

  beforeEach(async () => {
    originalEnabled = process.env[EVENT_OUTBOX_ENABLED_ENV];
    process.env[EVENT_OUTBOX_ENABLED_ENV] = 'true';
    db = new Database(':memory:');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
    await new EventOutboxMigration().up(db);
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env[EVENT_OUTBOX_ENABLED_ENV];
    else process.env[EVENT_OUTBOX_ENABLED_ENV] = originalEnabled;
    db.close();
  });

  it('enqueues URI-bearing events once per idempotency key', () => {
    const service = new EventOutboxService(db);
    const input = { eventType: 'memory.remembered' as const, targetUri: 'memento://owner/memory/mem_1', idempotencyKey: 'remember:mem_1:v1' };
    expect(service.enqueue(input)).toBe(true);
    expect(service.enqueue(input)).toBe(false);
    expect(service.pending()).toMatchObject([{ eventType: 'memory.remembered', targetUri: input.targetUri, payload: { target_uri: input.targetUri } }]);
  });

  it('does not enqueue while the feature flag is disabled', () => {
    process.env[EVENT_OUTBOX_ENABLED_ENV] = 'false';
    expect(new EventOutboxService(db).enqueue({
      eventType: 'memory.recalled', targetUri: 'memento://owner/memory/mem_1', idempotencyKey: 'recall:1',
    })).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS count FROM event_outbox').get()).toEqual({ count: 0 });
  });

  it('retries failures and marks an event processed only after publication succeeds', async () => {
    const service = new EventOutboxService(db);
    service.enqueue({ eventType: 'memory.forgotten', targetUri: 'memento://owner/memory/mem_1', idempotencyKey: 'forget:mem_1:v1' });
    await expect(service.publishPending({ publish: async () => { throw new Error('offline'); } })).resolves.toEqual({ published: 0, failed: 1 });
    expect(db.prepare('SELECT attempts, processed_at, last_error FROM event_outbox').get()).toEqual({ attempts: 1, processed_at: null, last_error: 'offline' });

    db.prepare("UPDATE event_outbox SET available_at = CURRENT_TIMESTAMP").run();
    const received: string[] = [];
    await expect(service.publishPending({ publish: async event => { received.push(event.id); } })).resolves.toEqual({ published: 1, failed: 0 });
    expect(received).toHaveLength(1);
    expect(db.prepare('SELECT processed_at FROM event_outbox').get()).toMatchObject({ processed_at: expect.any(String) });
  });
});
