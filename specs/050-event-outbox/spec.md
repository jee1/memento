# Feature Specification: Durable Event Outbox

**Feature Branch**: `062-memento-uri`
**Created**: 2026-07-11
**Status**: Implemented
**Parent**: #655, dependent issue #659

## User Scenarios & Testing

### User Story 1 - Retain interoperability events after memory changes (Priority: P1)

When the outbox feature flag is enabled, successful memory write and forget boundaries enqueue a durable, idempotent event that contains the canonical target URI.

**Independent Test**: Persist an event, verify its `target_uri` and idempotency key, then repeat the same key without creating another row.

### User Story 2 - Deliver events at least once (Priority: P2)

An operator-owned publisher worker reads due events. It marks an event processed only after the adapter succeeds; a failed adapter increments the retry count and leaves the event pending.

**Independent Test**: Use a failing publisher followed by a successful publisher and verify the event is delivered twice and then marked processed.

## Requirements

- **FR-001**: SQLite MUST store event type, target URI, JSON payload, unique idempotency key, retry metadata, availability, and processed time.
- **FR-002**: Enqueueing MUST be a no-op unless `MEMENTO_EVENT_OUTBOX_ENABLED=true`.
- **FR-003**: Payloads for memory events MUST contain a `target_uri` produced by the canonical resource URI utility.
- **FR-004**: The polling worker MUST provide at-least-once semantics: mark processed only after successful publication.
- **FR-005**: Redis Streams and webhooks remain adapter interfaces; no external service is required by this change.

## Success Criteria

- Migration and repository tests prove durable schema, retry, idempotency, and processing behavior.
- Feature-flagged memory boundaries enqueue the defined event vocabulary without changing existing MCP results.
- Public reference documents vocabulary, payload schema, flag, and delivery semantics.
