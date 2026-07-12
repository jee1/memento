# Event Outbox

`event_outbox` is Memento's durable hand-off point for external automation. It is disabled by default; set `MEMENTO_EVENT_OUTBOX_ENABLED=true` to enqueue events after successful memory boundaries.

## Vocabulary

| Event | Existing telemetry relationship | Payload focus |
| --- | --- | --- |
| `memory.remembered` | `memory.write.completed` | `memory_id`, `memory_type`, `content_hash`, `target_uri` |
| `procedure.updated` | `memory.write.completed` | procedural memory update and `target_uri` |
| `memory.recalled` | `memory.search.selected` | selected `memory_id`, `query_hash`, `target_uri` |
| `memory.forgotten` | new external event | deletion type, reason, `target_uri` |
| `relation.added` | new external event | relation source, target, and `target_uri` |

Every row has a canonical `target_uri` such as `memento://owner-a/memory/mem_123`, a JSON payload containing the same `target_uri`, and a caller-provided idempotency key.

## Delivery Contract

`EventOutboxService.publishPending()` polls rows due for delivery through an `EventOutboxPublisher` adapter. It marks `processed_at` only after `publish()` resolves. Failures increment `attempts`, retain `last_error`, and delay the next attempt with bounded exponential backoff, so delivery is at-least-once.

The core does not configure a network destination. Redis Streams and webhook publishers belong behind the adapter interface and can be deployed independently. The outbox table is SQLite state, so include it in normal database backups.
